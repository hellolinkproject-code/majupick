import { HttpError } from '../../utils/httpError.js';
import { notifyApplicationSubmitted, notifyDecision } from '../notifications/notificationEvents.js';
import { publicUserSelect, toPublicUser } from '../users/publicUser.js';
import {
  effectiveStatus,
  fromDbDate,
  todayKst,
  toPublicStatus,
} from '../projects/projectStatus.js';
import {
  APPLICATION_STATUSES,
  MY_APPLICATIONS_PAGE_SIZE,
  parseApplicationInput,
  parseDecisionBody,
  PROJECT_APPLICATIONS_PAGE_SIZE,
} from './application.validation.js';

/** 대기·수락 지원. 이 상태의 지원이 있으면 예산·마감일을 바꿀 수 없다(D-06). */
export const ACTIVE_APPLICATION_STATUSES = Object.freeze(['PENDING', 'ACCEPTED']);

const projectNotFound = () => new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
const applicationNotFound = () => new HttpError(404, 'NOT_FOUND', '지원 내역을 찾을 수 없습니다.');

const NOT_RECRUITING_MESSAGES = Object.freeze({
  SCHEDULED: '아직 모집이 시작되지 않은 프로젝트입니다.',
  CLOSED: '모집이 마감된 프로젝트입니다.',
});

/** 거래 단계(D-03). 이미 한 명을 선정했으므로 다시 선정·거절할 수 없다. */
const CONTRACT_STAGE_STATUSES = new Set(['CONTRACTING', 'IN_PROGRESS', 'COMPLETED']);

function alreadyApplied(applicationId) {
  return new HttpError(409, 'ALREADY_APPLIED', '이미 지원한 프로젝트입니다.', { applicationId });
}

const invalidTransition = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);

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

/** 소유자 화면용: 지원자 공개 프로필(PROF-05와 같은 범위, 이메일·희망 단가 없음, D-87). */
const ownerApplicationInclude = Object.freeze({
  project: { select: applicationProjectSelect },
  freelancer: { select: publicUserSelect },
});

/**
 * API_SPEC_v1 §1.5 Application(작성자 본인용). freelancer는 본인이라 싣지 않는다.
 * offerAmount·offerStatus·contractId는 계약 단계에서 추가한다.
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
      // 취소도 공개 상태로는 '모집 마감'이라, 지원자가 마감과 취소를 구분하도록 따로 알려 준다.
      isCancelled: project.status === 'CANCELLED',
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

/** 지금 이 프로젝트의 지원을 선정·거절할 수 있는지(D-34 RFP안: 실제 모집 중에만). */
function isDecisionOpen(project, today) {
  return (
    project.deletedAt === null &&
    project.status !== 'CANCELLED' &&
    effectiveStatus(project, today) === 'RECRUITING'
  );
}

/**
 * 프로젝트 소유자용 Application. 작성자용 필드 + 지원자 공개 프로필 + 지금 할 수 있는 동작.
 * 화면은 availableActions만 보고 버튼을 그리며, 실제 가능 여부는 DEC-01·02가 다시 판단한다.
 */
export function toOwnerApplication(application, today) {
  const decidable = application.status === 'PENDING' && isDecisionOpen(application.project, today);
  return {
    ...toApplication(application, today),
    freelancer: toPublicUser(application.freelancer),
    availableActions: decidable ? ['ACCEPT', 'REJECT'] : [],
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
 * 선정·거절 전 프로젝트 상태 확인(D-95). 소유자 본인에게 보내는 오류라 내부 상태를 그대로 알려 준다.
 * @param {'선정'|'거절'} action
 */
export function assertDecisionOpen(project, today, action) {
  if (project.status === 'CANCELLED') {
    throw invalidTransition(`취소된 프로젝트의 지원은 ${action}할 수 없습니다.`, {
      projectStatus: project.status,
    });
  }
  if (CONTRACT_STAGE_STATUSES.has(project.status)) {
    throw invalidTransition(
      `이미 지원자를 선정한 프로젝트입니다. 더 이상 ${action}할 수 없습니다.`,
      { projectStatus: project.status },
    );
  }
  const status = effectiveStatus(project, today);
  if (status === 'RECRUITING') return;
  throw invalidTransition(
    status === 'SCHEDULED'
      ? `모집이 시작되지 않은 프로젝트의 지원은 ${action}할 수 없습니다.`
      : `모집 기간이 끝난 프로젝트의 지원은 ${action}할 수 없습니다.`,
    { projectStatus: status },
  );
}

/** 대상 지원이 아직 대기 중인지. 이미 처리된 지원은 다시 바꾸지 않는다. */
export function assertPending(application, action) {
  if (application.status === 'PENDING') return;
  let message = '이미 거절된 지원입니다.';
  if (application.status === 'ACCEPTED') {
    message =
      action === '거절' ? '선정한 지원은 거절로 바꿀 수 없습니다.' : '이미 선정한 지원입니다.';
  }
  throw invalidTransition(message, { applicationStatus: application.status });
}

/** 알림 문구·수신자 계산에 쓰는 프로젝트 요약(잠근 뒤 읽은 값). */
const projectSummary = (project) => ({
  id: project.id,
  title: project.title,
  clientId: project.clientId,
});

const pagination = (page, pageSize, totalCount) => ({
  page,
  pageSize,
  totalCount,
  totalPages: Math.ceil(totalCount / pageSize),
});

/**
 * APP-01~04, DEC-01·02. 로그인·역할·프리랜서/의뢰인·프로필 확인은 라우터 미들웨어가 먼저 한다.
 * 프로젝트의 지원 상태를 바꾸는 요청은 모두 프로젝트 행을 먼저 잠그고(지원 FOR SHARE, 선정·거절·수정·삭제
 * FOR UPDATE) 그다음 지원 행을 바꾼다. 잠금 순서가 같아 교착 없이 한 줄로 처리된다.
 * @param {{
 *   prisma: object,
 *   clock?: () => Date,
 *   afterApply?: (tx: object, event: object) => Promise<unknown>,
 *   afterDecision?: (tx: object, event: object) => Promise<unknown>,
 * }} deps clock은 날짜 경계 테스트용. afterApply(알림 ①)·afterDecision(알림 ②③④)은 상태 변경과 같은
 *   트랜잭션 안에서 호출된다. 여기서 오류가 나면 지원·선정·자동 거절·프로젝트 상태가 모두 롤백된다.
 */
export function createApplicationService({
  prisma,
  clock = () => new Date(),
  afterApply = notifyApplicationSubmitted,
  afterDecision = notifyDecision,
}) {
  /**
   * 선정·거절 공통 확인(D-95 순서). 로그인·역할·의뢰인은 라우터가 확인했다.
   * ③ 소유자 → ④ 프로젝트 유효 → ⑤ 선정 가능 상태 → ⑥ 프로젝트 소속 → ⑦ PENDING → 본문.
   * 지원 ID로 프로젝트를 찾은 뒤 그 프로젝트 행을 FOR UPDATE로 잠그고 잠금 뒤의 값으로 판단한다.
   */
  async function lockForDecision(tx, clientId, applicationId, action, body) {
    const target = await tx.application.findUnique({
      where: { id: applicationId },
      select: { projectId: true },
    });
    if (!target) throw applicationNotFound();
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${target.projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: target.projectId } });
    // 남의 프로젝트 지원은 존재 자체를 알리지 않는다(APP-03과 같은 404).
    if (!project || project.clientId !== clientId) throw applicationNotFound();
    if (project.deletedAt) throw projectNotFound();
    const today = todayKst(clock());
    assertDecisionOpen(project, today, action);

    const application = await tx.application.findFirst({
      where: { id: applicationId, projectId: project.id },
    });
    if (!application) throw applicationNotFound();
    assertPending(application, action);

    const fields = parseDecisionBody(body);
    if (Object.keys(fields).length > 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
    }
    return { project, application, today };
  }

  const findOwnerView = (tx, id) =>
    tx.application.findUnique({ where: { id }, include: ownerApplicationInclude });

  return {
    /**
     * APP-01. 프로젝트 행을 공유 잠금(FOR SHARE)한 트랜잭션 안에서 상태 → 중복 → 입력 순으로 확인하고 만든다.
     * 수정·삭제·선정(FOR UPDATE)과 동시에 들어오면 한쪽이 끝날 때까지 기다리므로, 삭제·마감·선정과 엇갈려
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

          const application = await tx.application.create({
            data: { projectId, freelancerId, ...input },
            include: applicationInclude,
          });
          await afterApply(tx, {
            project: projectSummary(project),
            application: { id: application.id, freelancerId },
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

    /**
     * APP-03. 작성자에게는 본인용, 프로젝트 소유자에게는 지원자 프로필이 붙은 소유자용 응답을 준다.
     * 그 밖의 사용자·없는 지원·삭제된 프로젝트의 지원(소유자)은 구분 없이 404. DB는 바꾸지 않는다.
     */
    async getForViewer(userId, applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          ...ownerApplicationInclude,
          project: { select: { ...applicationProjectSelect, clientId: true } },
        },
      });
      const today = todayKst(clock());
      if (application?.freelancerId === userId) return toApplication(application, today);
      const { project } = application ?? {};
      if (project?.clientId === userId && project.deletedAt === null) {
        return toOwnerApplication(application, today);
      }
      throw applicationNotFound();
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
        pagination: pagination(page, MY_APPLICATIONS_PAGE_SIZE, totalCount),
      };
    },

    /**
     * APP-02 지원자 목록(소유자 전용, 최신 지원순 + id, 페이지당 10개). 삭제된 프로젝트는 404,
     * 남의 프로젝트는 403(취소돼 공개되지 않은 프로젝트는 404). 취소된 내 프로젝트는 읽기만 가능.
     * 개수·상태별 개수·목록을 같은 스냅샷(REPEATABLE READ)에서 읽는다. DB는 바꾸지 않는다.
     */
    async listForOwner(clientId, projectId, { page, status }) {
      const today = todayKst(clock());
      return prisma.$transaction(
        async (tx) => {
          const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { clientId: true, deletedAt: true, status: true },
          });
          if (!project || project.deletedAt) throw projectNotFound();
          if (project.clientId !== clientId) {
            if (project.status === 'CANCELLED') throw projectNotFound();
            throw new HttpError(
              403,
              'FORBIDDEN',
              '본인이 등록한 프로젝트의 지원자만 볼 수 있습니다.',
            );
          }

          const where = { projectId, ...(status && { status }) };
          const grouped = await tx.application.groupBy({
            by: ['status'],
            where: { projectId },
            _count: { _all: true },
          });
          const counts = Object.fromEntries(APPLICATION_STATUSES.map((value) => [value, 0]));
          for (const row of grouped) counts[row.status] = row._count._all;
          const total = APPLICATION_STATUSES.reduce((sum, value) => sum + counts[value], 0);
          const totalCount = status ? counts[status] : total;

          const applications = await tx.application.findMany({
            where,
            include: ownerApplicationInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * PROJECT_APPLICATIONS_PAGE_SIZE,
            take: PROJECT_APPLICATIONS_PAGE_SIZE,
          });
          return {
            data: applications.map((application) => toOwnerApplication(application, today)),
            pagination: pagination(page, PROJECT_APPLICATIONS_PAGE_SIZE, totalCount),
            counts: { total, ...counts },
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },

    /**
     * DEC-01 선정(D-54 한 트랜잭션). 프로젝트 행 FOR UPDATE → 확인 → 대상 PENDING→ACCEPTED →
     * 나머지 PENDING→REJECTED(OTHER_ACCEPTED) → 프로젝트 CONTRACTING + closed_at → afterDecision.
     * 이미 거절된 지원은 조건(status = 'PENDING')에 걸리지 않아 사유·시각이 그대로 남는다.
     * 동시에 두 지원을 선정하면 늦은 요청은 잠금을 기다린 뒤 CONTRACTING을 보고 409로 끝난다.
     * 잠금을 거치지 않는 쓰기가 생겨도 부분 UNIQUE(프로젝트당 ACCEPTED 1건)가 막는다(P2002 → 409).
     * 지원서의 예상 단가는 계약 금액이 아니며, 합의 금액·계약·결제는 다음 단계다.
     */
    async accept(clientId, applicationId, body) {
      try {
        return await prisma.$transaction(async (tx) => {
          const { project, application, today } = await lockForDecision(
            tx,
            clientId,
            applicationId,
            '선정',
            body,
          );
          const accepted = await tx.application.findFirst({
            where: { projectId: project.id, status: 'ACCEPTED' },
            select: { id: true },
          });
          if (accepted) {
            throw invalidTransition('이미 선정한 지원자가 있습니다.', {
              acceptedApplicationId: accepted.id,
            });
          }

          const decidedAt = clock();
          const changed = await tx.application.updateMany({
            where: { id: application.id, status: 'PENDING' },
            data: { status: 'ACCEPTED', decidedAt },
          });
          if (changed.count !== 1) throw invalidTransition('이미 처리된 지원입니다.');
          const autoRejected = await tx.application.updateManyAndReturn({
            where: { projectId: project.id, status: 'PENDING' },
            data: { status: 'REJECTED', rejectReason: 'OTHER_ACCEPTED', decidedAt },
            select: { id: true, freelancerId: true },
          });
          await tx.project.update({
            where: { id: project.id },
            data: { status: 'CONTRACTING', closedAt: decidedAt },
          });

          await afterDecision(tx, {
            type: 'ACCEPTED',
            projectId: project.id,
            project: projectSummary(project),
            application: { id: application.id, freelancerId: application.freelancerId },
            autoRejected,
            decidedAt,
          });

          return {
            application: toOwnerApplication(await findOwnerView(tx, application.id), today),
            autoRejectedCount: autoRejected.length,
          };
        });
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        throw invalidTransition('이미 선정한 지원자가 있습니다.');
      }
    },

    /**
     * DEC-02 직접 거절. PENDING → REJECTED(MANUAL)만 한다. 사유 입력은 받지 않는다(D-49).
     * 다른 지원은 건드리지 않고 프로젝트 상태도 바꾸지 않는다. 선정된 지원은 거절로 바꿀 수 없다.
     */
    async reject(clientId, applicationId, body) {
      return prisma.$transaction(async (tx) => {
        const { project, application, today } = await lockForDecision(
          tx,
          clientId,
          applicationId,
          '거절',
          body,
        );
        const decidedAt = clock();
        const changed = await tx.application.updateMany({
          where: { id: application.id, status: 'PENDING' },
          data: { status: 'REJECTED', rejectReason: 'MANUAL', decidedAt },
        });
        if (changed.count !== 1) throw invalidTransition('이미 처리된 지원입니다.');

        await afterDecision(tx, {
          type: 'REJECTED',
          projectId: project.id,
          project: projectSummary(project),
          application: { id: application.id, freelancerId: application.freelancerId },
          autoRejected: [],
          decidedAt,
        });

        return toOwnerApplication(await findOwnerView(tx, application.id), today);
      });
    },
  };
}
