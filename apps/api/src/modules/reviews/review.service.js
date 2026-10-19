import { HttpError } from '../../utils/httpError.js';
import { pagination } from '../projects/project.service.js';
import { averageRating } from './reviewMath.js';
import {
  REVIEW_LIST_PAGE_SIZE,
  parseReviewBody,
  parseReviewListQuery,
} from './review.validation.js';

export { averageRating } from './reviewMath.js';

const notFoundContract = () => new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
const notFoundUser = () => new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
const invalid = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);
const alreadyReviewed = () =>
  new HttpError(409, 'ALREADY_REVIEWED', '이미 이 거래에 대한 리뷰를 작성했습니다.');

const TX_OPTIONS = Object.freeze({ maxWait: 15_000, timeout: 30_000 });

export function toReviewDto(review, extras = {}) {
  return {
    id: review.id,
    contractId: review.contractId,
    projectId: extras.projectId ?? review.contract?.projectId ?? null,
    projectTitle: extras.projectTitle ?? review.contract?.projectTitle ?? null,
    reviewerId: review.reviewerId,
    revieweeId: review.revieweeId,
    reviewerName: extras.reviewerName ?? review.reviewer?.name ?? null,
    rating: review.rating,
    content: review.content,
    tags: [...(review.tags ?? [])],
    createdAt: review.createdAt,
  };
}

export function createReviewService({ prisma }) {
  async function assertReviewableParty(tx, contractId, userId) {
    const head = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, projectId: true },
    });
    if (!head) throw notFoundContract();
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${head.projectId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;

    const project = await tx.project.findUnique({ where: { id: head.projectId } });
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!project || project.deletedAt || !contract) throw notFoundContract();
    if (contract.clientId !== userId && contract.freelancerId !== userId) {
      throw notFoundContract();
    }

    if (project.status !== 'COMPLETED') {
      throw invalid('완료된 프로젝트에서만 리뷰를 작성할 수 있습니다.', {
        projectStatus: project.status,
      });
    }
    if (contract.status !== 'COMPLETED') {
      throw invalid('완료된 계약에서만 리뷰를 작성할 수 있습니다.', {
        contractStatus: contract.status,
      });
    }

    const payment = await tx.payment.findFirst({
      where: { contractId: contract.id, status: 'PAID', escrowStatus: 'RELEASED' },
    });
    if (!payment) {
      throw invalid('모의 정산(RELEASED)이 끝난 계약에서만 리뷰를 작성할 수 있습니다.');
    }

    const existing = await tx.review.findUnique({
      where: {
        contractId_reviewerId: { contractId: contract.id, reviewerId: userId },
      },
      select: { id: true },
    });
    if (existing) throw alreadyReviewed();

    const revieweeId = contract.clientId === userId ? contract.freelancerId : contract.clientId;
    return { project, contract, revieweeId };
  }

  /** REV-01 */
  async function createReview(userId, role, contractId, body) {
    if (role !== 'CLIENT' && role !== 'FREELANCER') {
      throw new HttpError(403, 'FORBIDDEN', '리뷰를 작성할 수 있는 역할이 아닙니다.');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // 당사자·완료 여부를 먼저 확인해, 제3자에게 검증 오류로 계약 존재를 암시하지 않는다.
        const { contract, revieweeId } = await assertReviewableParty(tx, contractId, userId);
        if (
          (role === 'CLIENT' && contract.clientId !== userId) ||
          (role === 'FREELANCER' && contract.freelancerId !== userId)
        ) {
          throw notFoundContract();
        }

        const { fields, rating, content, tags } = parseReviewBody(body, role);
        if (Object.keys(fields).length > 0 || rating == null || content == null || tags == null) {
          throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
        }

        const created = await tx.review.create({
          data: {
            contractId: contract.id,
            reviewerId: userId,
            revieweeId,
            rating,
            content,
            tags,
          },
          include: {
            reviewer: { select: { name: true } },
            contract: { select: { projectId: true, projectTitle: true } },
          },
        });
        return toReviewDto(created);
      }, TX_OPTIONS);
    } catch (error) {
      if (error?.code === 'P2002') throw alreadyReviewed();
      throw error;
    }
  }

  /** REV-02 */
  async function getContractReviews(userId, contractId) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        clientId: true,
        freelancerId: true,
        projectId: true,
        projectTitle: true,
      },
    });
    if (!contract) throw notFoundContract();
    if (contract.clientId !== userId && contract.freelancerId !== userId) {
      throw notFoundContract();
    }

    const rows = await prisma.review.findMany({
      where: { contractId: contract.id },
      include: { reviewer: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const myReview = rows.find((r) => r.reviewerId === userId) ?? null;
    const counterpartReview = rows.find((r) => r.reviewerId !== userId) ?? null;
    const extras = {
      projectId: contract.projectId,
      projectTitle: contract.projectTitle,
    };
    return {
      myReview: myReview
        ? toReviewDto(myReview, {
            ...extras,
            reviewerName: myReview.reviewer.name,
          })
        : null,
      counterpartReview: counterpartReview
        ? toReviewDto(counterpartReview, {
            ...extras,
            reviewerName: counterpartReview.reviewer.name,
          })
        : null,
    };
  }

  /** REV-03 + B-19 summary. 공개. */
  async function listUserReviews(userIdParam, query) {
    const { page } = parseReviewListQuery(query);
    const user = await prisma.user.findUnique({
      where: { id: userIdParam },
      select: { id: true, role: true },
    });
    if (!user?.role) throw notFoundUser();

    const where = { revieweeId: user.id };
    const [totalCount, agg, rows] = await prisma.$transaction(
      [
        prisma.review.count({ where }),
        prisma.review.aggregate({ where, _avg: { rating: true }, _sum: { rating: true } }),
        prisma.review.findMany({
          where,
          include: {
            reviewer: { select: { name: true } },
            contract: { select: { projectId: true, projectTitle: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * REVIEW_LIST_PAGE_SIZE,
          take: REVIEW_LIST_PAGE_SIZE,
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );

    const sum = agg._sum.rating ?? 0;
    const average = averageRating(sum, totalCount);

    return {
      data: rows.map((row) =>
        toReviewDto(row, {
          projectId: row.contract.projectId,
          projectTitle: row.contract.projectTitle,
          reviewerName: row.reviewer.name,
        }),
      ),
      pagination: pagination(page, REVIEW_LIST_PAGE_SIZE, totalCount),
      summary: {
        average,
        count: totalCount,
      },
    };
  }

  /** 공개 프로필용 요약만(추가 쿼리 1회). */
  async function getRatingSummary(userId) {
    const agg = await prisma.review.aggregate({
      where: { revieweeId: userId },
      _avg: { rating: true },
      _count: { _all: true },
      _sum: { rating: true },
    });
    const count = agg._count._all;
    return {
      average: averageRating(agg._sum.rating ?? 0, count),
      count,
    };
  }

  return {
    createReview,
    getContractReviews,
    listUserReviews,
    getRatingSummary,
  };
}
