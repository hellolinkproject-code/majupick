import { HttpError } from '../../utils/httpError.js';
import {
  effectiveStatus,
  fromDbDate,
  todayKst,
  toPublicStatus,
} from '../projects/projectStatus.js';
import { MY_APPLICATIONS_PAGE_SIZE, parseApplicationInput } from './application.validation.js';

/** 대기·수락 지원. 이 상태의 지원이 있으면 예산·마감일을 바꿀 수 없다(D-06). */
export const ACTIVE_APPLICATION_STATUSES = Object.freeze(['PENDING', 'ACCEPTED']);

const projectNotFound = () => new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
const applicationNotFound = () => new HttpError(404, 'NOT_FOUND', '지원 내역을 찾을 수 없습니다.');

const NOT_RECRUITING_MESSAGES = Object.freeze({
  SCHEDULED: '아직 모집이 시작되지 않은 프로젝트입니다.',
  CLOSED: '모집이 마감된 프로젝트입니다.',
});

function alreadyApplied(applicationId) {
  return new HttpError(409, 'ALREADY_APPLIED', '이미 지원한 프로젝트입니다.', { applicationId });
}

/** 지원 내역에 싣는 프로젝트 공개 요약. 의뢰인 정보는 넣지 않는다. */
const applicationProjectSelect = Object.freeze({
  id: true,
  title: true,
  category: true,
  budget: true,
  recruitStartDate: true,
  recruitEndDate: true,
  status: true,
  deletedAt: true,
});

const applicationInclude = Object.freeze({ project: { select: applicationProjectSelect } });

/**
 * API_SPEC_v1 §1.5 Application(작성자 본인용). freelancer는 본인이라 싣지 않는다.
 * offerAmount·offerStatus·contractId는 수락·계약 단계에서 추가한다.
 */
export function toApplication(application, today) {
  const { project } = application;
  const isDeleted = project.deletedAt !== null;
  return {
    id: application.id,
    projectId: application.projectId,
    project: {
      id: project.id,
      title: project.title,
      category: project.category,
      budget: project.budget.toString(),
      recruitStartDate: fromDbDate(project.recruitStartDate),
      recruitEndDate: fromDbDate(project.recruitEndDate),
      // 삭제된 프로젝트는 더 이상 모집하지 않으므로 저장 상태와 관계없이 마감으로 보여 준다.
      publicStatus: isDeleted ? 'CLOSED' : toPublicStatus(effectiveStatus(project, today)),
      isDeleted,
    },
    coverLetter: application.coverLetter,
    proposedAmount: application.proposedAmount.toString(),
    proposedDurationDays: application.proposedDurationDays,
    status: application.status,
    rejectReason: application.rejectReason,
    decidedAt: application.decidedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

/**
 * 지원할 수 있는지(D-34 + D-83): 저장된 상태가 아니라 오늘(KST) 기준 실제 상태가 모집 중이어야 한다.
 * 마감일 당일은 모집 중, 다음 날 0시(KST)부터 마감이다. 취소된 프로젝트는 상세(PRJ-02)처럼 숨긴다.
 */
export function assertRecruiting(project, today) {
  if (!project || project.deletedAt || project.status === 'CANCELLED') throw projectNotFound();
  const status = effectiveStatus(project, today);
  if (status === 'RECRUITING') return;
  const publicStatus = toPublicStatus(status);
  throw new HttpError(409, 'INVALID_STATE_TRANSITION', NOT_RECRUITING_MESSAGES[publicStatus], {
    currentStatus: publicStatus,
  });
}

/**
 * APP-01·03·04. 로그인·역할·프리랜서·프로필 확인은 라우터 미들웨어가 먼저 한다.
 * @param {{ prisma: object, clock?: () => Date }} deps clock은 날짜 경계 테스트용
 */
export function createApplicationService({ prisma, clock = () => new Date() }) {
  return {
    /**
     * APP-01. 프로젝트 행을 공유 잠금(FOR SHARE)한 트랜잭션 안에서 상태 → 중복 → 입력 순으로 확인하고 만든다.
     * 수정·삭제(FOR UPDATE)와 동시에 들어오면 한쪽이 끝날 때까지 기다리므로, 삭제·마감과 엇갈려
     * 지원이 남지 않는다. 같은 프리랜서의 동시 지원은 UNIQUE(project_id, freelancer_id)가 한 건만 남긴다.
     */
    async apply(freelancerId, projectId, body) {
      const { fields, input } = parseApplicationInput(body);
      try {
        const created = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR SHARE`;
          const project = await tx.project.findUnique({ where: { id: projectId } });
          const today = todayKst(clock());
          assertRecruiting(project, today);
          if (project.clientId === freelancerId) {
            throw new HttpError(403, 'FORBIDDEN', '본인이 등록한 프로젝트에는 지원할 수 없습니다.');
          }

          const existing = await tx.application.findUnique({
            where: { projectId_freelancerId: { projectId, freelancerId } },
            select: { id: true },
          });
          if (existing) throw alreadyApplied(existing.id);
          if (Object.keys(fields).length > 0) {
            throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
          }

          // STEP 06-C: 의뢰인 알림 ①(A-36)을 이 트랜잭션 안에서 함께 만든다.
          const application = await tx.application.create({
            data: { projectId, freelancerId, ...input },
            include: applicationInclude,
          });
          return { application, today };
        });
        return toApplication(created.application, created.today);
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        const raced = await prisma.application.findUnique({
          where: { projectId_freelancerId: { projectId, freelancerId } },
          select: { id: true },
        });
        if (!raced) throw error;
        throw alreadyApplied(raced.id);
      }
    },

    /** APP-03(작성자 본인). 남의 지원·없는 지원은 구분 없이 404. DB는 바꾸지 않는다. */
    async getMine(freelancerId, applicationId) {
      const application = await prisma.application.findFirst({
        where: { id: applicationId, freelancerId },
        include: applicationInclude,
      });
      if (!application) throw applicationNotFound();
      return toApplication(application, todayKst(clock()));
    },

    /** APP-04 내 지원 현황(최신 지원순, 페이지당 10개). 삭제된 프로젝트의 지원도 남는다(A-35). */
    async listMine(freelancerId, { page, status }) {
      const today = todayKst(clock());
      const where = { freelancerId, ...(status && { status }) };
      const [totalCount, applications] = await prisma.$transaction(
        [
          prisma.application.count({ where }),
          prisma.application.findMany({
            where,
            include: applicationInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * MY_APPLICATIONS_PAGE_SIZE,
            take: MY_APPLICATIONS_PAGE_SIZE,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        data: applications.map((application) => toApplication(application, today)),
        pagination: {
          page,
          pageSize: MY_APPLICATIONS_PAGE_SIZE,
          totalCount,
          totalPages: Math.ceil(totalCount / MY_APPLICATIONS_PAGE_SIZE),
        },
      };
    },
  };
}
