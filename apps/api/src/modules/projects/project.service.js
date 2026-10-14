import { HttpError } from '../../utils/httpError.js';
import { ACTIVE_APPLICATION_STATUSES } from '../applications/application.service.js';
import { CLOSE_REASONS } from '../notifications/notificationEvents.js';
import { DATE_MESSAGES, MY_PROJECTS_PAGE_SIZE } from './project.validation.js';
import { closeLockedProject, syncLockedProject } from './projectClosure.js';
import { buildSearchWhere, SEARCH_PAGE_SIZE, searchSegments } from './projectSearch.js';
import {
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  effectiveStatus,
  fromDbDate,
  initialRecruitStatus,
  PUBLIC_PROJECT_WHERE,
  toDbDate,
  todayKst,
  toPublicStatus,
} from './projectStatus.js';

const DESCRIPTION_PREVIEW_LENGTH = 120;

const notFound = () => new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
const notOwner = (action) =>
  new HttpError(403, 'FORBIDDEN', `본인이 등록한 프로젝트만 ${action}할 수 있습니다.`);
const unknownTechStacks = () =>
  new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { techStackIds: '존재하지 않는 기술 스택이 포함되어 있습니다.' },
  });

/** 모집이 마감되면 재모집을 지원하지 않으므로(D-09) 모집 기간은 바꿀 수 없다. */
const CLOSED_LOCKED_FIELDS = ['recruitStartDate', 'recruitEndDate'];
/** 대기·수락 지원이 있으면 지원 조건이 바뀌지 않게 예산·마감일을 막는다(A-16, D-06). */
const APPLICANT_LOCKED_FIELDS = ['budget', 'recruitEndDate'];

const applicationCount = Object.freeze({ select: { applications: true } });

const projectInclude = Object.freeze({
  _count: applicationCount,
  client: {
    select: {
      id: true,
      name: true,
      profileImageUrl: true,
      clientProfile: { select: { companyName: true } },
    },
  },
  techStacks: { select: { techStack: { select: { id: true, name: true } } } },
});

function toTechStacks(links) {
  return links
    .map(({ techStack }) => ({ id: techStack.id, name: techStack.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** API_SPEC_v1 §1.5 ProjectSummary 공통 필드. 금액은 문자열(D-51), 날짜는 'YYYY-MM-DD'. */
function toSummary(project) {
  return {
    id: project.id,
    title: project.title,
    category: project.category,
    budget: project.budget.toString(),
    recruitStartDate: fromDbDate(project.recruitStartDate),
    recruitEndDate: fromDbDate(project.recruitEndDate),
    publicStatus: toPublicStatus(project.status),
    techStacks: toTechStacks(project.techStacks),
    // 지금까지 지원한 사람 수(결과와 무관). 지원자 개인정보는 싣지 않는다.
    applicantCount: project._count?.applications ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function lockedFieldsOf(status, activeApplicantCount) {
  const fields = new Set(status === 'CLOSED' ? CLOSED_LOCKED_FIELDS : []);
  if (activeApplicantCount > 0) APPLICANT_LOCKED_FIELDS.forEach((field) => fields.add(field));
  return [...fields];
}

/**
 * 소유자에게만 7개 상태와 지금 할 수 있는 동작을 알려 FE가 버튼을 직접 계산하지 않게 한다.
 * CLOSE(STAT-01)는 실제 상태가 모집 중일 때만 준다. 조회 응답은 withCurrentStatus를 거친 값이 들어온다.
 */
function ownerFields(project, activeApplicantCount = 0) {
  const availableActions = [];
  if (EDITABLE_STATUSES.has(project.status)) availableActions.push('EDIT');
  if (DELETABLE_STATUSES.has(project.status)) availableActions.push('DELETE');
  if (project.status === 'RECRUITING') availableActions.push('CLOSE');
  return {
    status: project.status,
    availableActions,
    lockedFields: lockedFieldsOf(project.status, activeApplicantCount),
  };
}

/** 프리랜서 본인의 지원 상태(PRJ-02 myApplication). 지원하지 않았으면 null. */
function toMyApplication(application) {
  if (!application) return null;
  const { id, status, rejectReason, createdAt } = application;
  return { id, status, rejectReason, createdAt };
}

/**
 * @param {object} viewer activeApplicantCount: 소유자 화면의 잠금 계산용,
 *   myApplication: 로그인한 프리랜서에게만 넣는다(undefined면 키 자체를 넣지 않는다)
 */
export function toProjectDetail(project, viewerId = null, viewer = {}) {
  const isOwner = viewerId !== null && viewerId === project.clientId;
  const { client } = project;
  return {
    ...toSummary(project),
    description: project.description,
    client: {
      id: client.id,
      name: client.name,
      profileImageUrl: client.profileImageUrl,
      companyName: client.clientProfile?.companyName ?? null,
    },
    isOwner,
    ...(isOwner && ownerFields(project, viewer.activeApplicantCount)),
    ...(viewer.myApplication !== undefined && {
      myApplication: toMyApplication(viewer.myApplication),
    }),
  };
}

function toMyProject(project, activeApplicantCount) {
  return { ...toSummary(project), ...ownerFields(project, activeApplicantCount) };
}

/** 프로젝트별 대기·수락 지원 수(D-06 잠금 계산). */
async function countActiveApplications(db, projectIds) {
  if (projectIds.length === 0) return new Map();
  const rows = await db.application.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds }, status: { in: ACTIVE_APPLICATION_STATUSES } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.projectId, row._count._all]));
}

/** 조회 응답용: 마감일·시작일이 지난 상태를 DB에 쓰지 않고 반영한다(D-83). */
function withCurrentStatus(project, today) {
  return { ...project, status: effectiveStatus(project, today) };
}

/** 검색 목록 카드. 공개 요약 + 설명 앞부분. 의뢰인 정보·소유자 전용 필드는 넣지 않는다. */
function toSearchItem(project) {
  const text = project.description.replace(/\s+/g, ' ').trim();
  return {
    ...toSummary(project),
    descriptionPreview:
      text.length > DESCRIPTION_PREVIEW_LENGTH
        ? `${text.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`
        : text,
  };
}

const searchSelect = Object.freeze({
  id: true,
  title: true,
  description: true,
  category: true,
  budget: true,
  recruitStartDate: true,
  recruitEndDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  techStacks: projectInclude.techStacks,
  _count: applicationCount,
});

const pagination = (page, pageSize, totalCount) => ({
  page,
  pageSize,
  totalCount,
  totalPages: Math.ceil(totalCount / pageSize),
});

const now = () => new Date();

const CLOSE_BLOCKED_MESSAGES = Object.freeze({
  SCHEDULED: '모집이 시작되지 않은 프로젝트는 마감할 수 없습니다.',
  CLOSED: '이미 모집이 마감된 프로젝트입니다.',
  CANCELLED: '취소된 프로젝트는 마감할 수 없습니다.',
});

/** STAT-01을 할 수 없는 상태. 소유자에게 보내는 오류라 내부 상태를 알려 준다. */
const notClosable = (status) =>
  new HttpError(
    409,
    'INVALID_STATE_TRANSITION',
    CLOSE_BLOCKED_MESSAGES[status] ?? '이미 지원자를 선정한 프로젝트는 모집을 마감할 수 없습니다.',
    { currentStatus: status },
  );

/**
 * PRJ-01~05, STAT-01. 권한(로그인·역할·프로필)은 라우터 미들웨어가 먼저 확인하고,
 * 소유자·상태 확인은 프로젝트 행을 잠근 트랜잭션 안에서 한다.
 * afterClose: 마감 트랜잭션 안에서 알림 ⑤를 만드는 함수(기본 notifyProjectClosed). 실패하면 마감 전체가 롤백된다.
 */
export function createProjectService({ prisma, afterClose }) {
  async function assertTechStacksExist(db, ids) {
    const found = await db.techStack.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw unknownTechStacks();
  }

  function findByKey(clientId, idempotencyKey) {
    return prisma.project.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
      include: projectInclude,
    });
  }

  /** 같은 키로 이미 등록된 프로젝트를 돌려준다. 그 사이 삭제됐다면 다시 만들지 않고 409. */
  function replayed(project, clientId) {
    if (project.deletedAt) {
      throw new HttpError(409, 'CONFLICT', '이미 처리된 등록 요청입니다. 새로 등록해 주세요.');
    }
    return { project: toProjectDetail(project, clientId), created: false };
  }

  /**
   * 프로젝트 행을 잠그고 날짜 보정(시작·자동 마감 + 대기 지원 거절 + 알림 ⑤) 후 다시 읽는다.
   * 없거나 삭제됐으면 404, 남의 것이면 403. 이후 요청이 실패하면 보정도 함께 롤백된다.
   */
  async function lockOwnedProject(tx, projectId, userId, action, at = now()) {
    const [row] = await tx.$queryRaw`
      SELECT client_id AS "clientId", deleted_at AS "deletedAt"
      FROM projects WHERE id = ${projectId} FOR UPDATE`;
    if (!row || row.deletedAt) throw notFound();
    if (row.clientId !== userId) throw notOwner(action);
    const { project } = await syncLockedProject(tx, projectId, { now: at, afterClose });
    return project;
  }

  function lockedByStatus(project, action) {
    if (project.status === 'CANCELLED') {
      return new HttpError(
        409,
        'INVALID_STATE_TRANSITION',
        `취소된 프로젝트는 ${action}할 수 없습니다.`,
        { currentStatus: project.status },
      );
    }
    return new HttpError(
      409,
      action === '수정' ? 'FIELD_LOCKED' : 'INVALID_STATE_TRANSITION',
      `계약 단계에 들어간 프로젝트는 ${action}할 수 없습니다.`,
      { currentStatus: project.status },
    );
  }

  return {
    /** PRJ-01. 같은 의뢰인 + 같은 Idempotency-Key면 기존 프로젝트를 돌려준다(created: false). */
    async createProject(clientId, input, idempotencyKey) {
      const existing = await findByKey(clientId, idempotencyKey);
      if (existing) return replayed(existing, clientId);

      const today = todayKst(now());
      try {
        const project = await prisma.$transaction(async (tx) => {
          await assertTechStacksExist(tx, input.techStackIds);
          return tx.project.create({
            data: {
              clientId,
              title: input.title,
              description: input.description,
              category: input.category,
              recruitStartDate: toDbDate(input.recruitStartDate),
              recruitEndDate: toDbDate(input.recruitEndDate),
              budget: input.budget,
              status: initialRecruitStatus(input.recruitStartDate, today),
              idempotencyKey,
              techStacks: {
                createMany: { data: input.techStackIds.map((techStackId) => ({ techStackId })) },
              },
            },
            include: projectInclude,
          });
        });
        return { project: toProjectDetail(project, clientId), created: true };
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        const raced = await findByKey(clientId, idempotencyKey);
        if (!raced) throw error;
        return replayed(raced, clientId);
      }
    },

    /**
     * PRJ-02. 삭제된 프로젝트는 누구에게나 404, 취소된 프로젝트는 소유자·지원자만 본다. DB는 바꾸지 않는다.
     * 로그인한 프리랜서에게는 본인 지원 상태(myApplication), 소유자에게는 지원자에 따른 잠금 항목을 준다.
     */
    async getProject(projectId, viewerId = null) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        include: projectInclude,
      });
      if (!project) throw notFound();
      const isOwner = viewerId !== null && project.clientId === viewerId;

      const viewer = {};
      if (isOwner) {
        const counts = await countActiveApplications(prisma, [projectId]);
        viewer.activeApplicantCount = counts.get(projectId) ?? 0;
      } else if (viewerId !== null) {
        const user = await prisma.user.findUnique({
          where: { id: viewerId },
          select: {
            role: true,
            applications: {
              where: { projectId },
              select: { id: true, status: true, rejectReason: true, createdAt: true },
            },
          },
        });
        if (user?.role === 'FREELANCER') viewer.myApplication = user.applications[0] ?? null;
      }
      if (project.status === 'CANCELLED' && !isOwner && !viewer.myApplication) throw notFound();
      return toProjectDetail(withCurrentStatus(project, todayKst(now())), viewerId, viewer);
    },

    /**
     * PRJ-03 부분 수정. 거래 단계 이후 수정 불가(D-55), 모집 마감 후 모집 기간 변경 불가(D-09).
     * 시작일을 바꾸면 모집 예정/모집 중을 다시 계산한다. 기술 스택 연결은 요청 목록으로 바꾼다.
     */
    async updateProject(userId, projectId, changes) {
      const updated = await prisma.$transaction(async (tx) => {
        const project = await lockOwnedProject(tx, projectId, userId, '수정');
        if (!EDITABLE_STATUSES.has(project.status)) throw lockedByStatus(project, '수정');

        const today = todayKst(now());
        const current = {
          start: fromDbDate(project.recruitStartDate),
          end: fromDbDate(project.recruitEndDate),
        };
        const startChanged =
          'recruitStartDate' in changes && changes.recruitStartDate !== current.start;
        const endChanged = 'recruitEndDate' in changes && changes.recruitEndDate !== current.end;

        if (project.status === 'CLOSED' && (startChanged || endChanged)) {
          throw new HttpError(
            409,
            'FIELD_LOCKED',
            '모집이 마감된 프로젝트는 모집 기간을 바꿀 수 없습니다.',
            { currentStatus: project.status, lockedFields: CLOSED_LOCKED_FIELDS },
          );
        }

        const budgetChanged = 'budget' in changes && changes.budget !== project.budget;
        const activeApplicantCount =
          (await countActiveApplications(tx, [projectId])).get(projectId) ?? 0;
        if (activeApplicantCount > 0 && (budgetChanged || endChanged)) {
          throw new HttpError(
            409,
            'FIELD_LOCKED',
            '지원자가 있는 프로젝트는 예산과 모집 마감일을 바꿀 수 없습니다.',
            {
              currentStatus: project.status,
              lockedFields: lockedFieldsOf(project.status, activeApplicantCount),
            },
          );
        }

        const nextStart = startChanged ? changes.recruitStartDate : current.start;
        const nextEnd = endChanged ? changes.recruitEndDate : current.end;
        const fields = {};
        if (startChanged && nextStart !== null && nextStart < today) {
          fields.recruitStartDate = DATE_MESSAGES.startPast;
        }
        if (endChanged && nextEnd < today) fields.recruitEndDate = DATE_MESSAGES.endPast;
        else if ((startChanged || endChanged) && nextStart !== null && nextEnd < nextStart) {
          fields.recruitEndDate = DATE_MESSAGES.endBeforeStart;
        }
        if (Object.keys(fields).length > 0) {
          throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
        }

        const data = {};
        for (const key of ['title', 'description', 'category', 'budget']) {
          if (key in changes) data[key] = changes[key];
        }
        if (startChanged) {
          data.recruitStartDate = toDbDate(nextStart);
          data.status = initialRecruitStatus(nextStart, today);
        }
        if (endChanged) data.recruitEndDate = toDbDate(nextEnd);

        if (changes.techStackIds) {
          await assertTechStacksExist(tx, changes.techStackIds);
          await tx.projectTechStack.deleteMany({ where: { projectId } });
          await tx.projectTechStack.createMany({
            data: changes.techStackIds.map((techStackId) => ({ projectId, techStackId })),
          });
        }

        const saved = await tx.project.update({
          where: { id: projectId },
          data,
          include: projectInclude,
        });
        return { saved, activeApplicantCount };
      });
      return toProjectDetail(updated.saved, userId, {
        activeApplicantCount: updated.activeApplicantCount,
      });
    },

    /**
     * PRJ-04 소프트 삭제(D-53). 행은 남기고 deleted_at만 기록한다. 모집 단계에서만 가능(D-07).
     * 같은 트랜잭션에서 대기 지원을 REJECTED(PROJECT_DELETED)로 바꿔 지원자 화면에 결과가 남게 한다(D-07, A-35).
     */
    async deleteProject(userId, projectId) {
      await prisma.$transaction(async (tx) => {
        const project = await lockOwnedProject(tx, projectId, userId, '삭제');
        if (!DELETABLE_STATUSES.has(project.status)) throw lockedByStatus(project, '삭제');
        const deletedAt = now();
        await tx.application.updateMany({
          where: { projectId, status: 'PENDING' },
          data: { status: 'REJECTED', rejectReason: 'PROJECT_DELETED', decidedAt: deletedAt },
        });
        await tx.project.update({ where: { id: projectId }, data: { deletedAt } });
      });
    },

    /**
     * STAT-01 수동 모집 마감(A-24). 실제 상태가 모집 중일 때만 가능하다. 한 트랜잭션에서
     * 프로젝트 행 잠금 → 소유자·상태 확인 → CLOSED + closed_at → PENDING 지원 REJECTED(PROJECT_CLOSED)
     * → 지원자 전원 알림 ⑤. 이미 마감·계약 단계·취소·모집 예정이면 409이고 아무것도 바꾸지 않는다.
     * 같은 요청을 다시 보내면 두 번째는 '이미 마감' 409라 알림이 중복되지 않는다.
     */
    async closeProject(userId, projectId) {
      return prisma.$transaction(async (tx) => {
        const at = now();
        const project = await lockOwnedProject(tx, projectId, userId, '마감', at);
        const status = effectiveStatus(project, todayKst(at));
        if (status !== 'RECRUITING') throw notClosable(project.status);
        const result = await closeLockedProject(tx, project, {
          now: at,
          reason: CLOSE_REASONS.MANUAL,
          afterClose,
        });
        const saved = await tx.project.findUnique({
          where: { id: projectId },
          include: projectInclude,
        });
        const counts = await countActiveApplications(tx, [projectId]);
        return {
          project: toProjectDetail(saved, userId, {
            activeApplicantCount: counts.get(projectId) ?? 0,
          }),
          ...result,
        };
      });
    },

    /** PRJ-05 내 프로젝트(최신 등록순, 페이지당 10개). DB는 바꾸지 않는다. */
    async listMyProjects(clientId, page) {
      const today = todayKst(now());
      const where = { clientId, deletedAt: null };
      const [totalCount, projects] = await prisma.$transaction(
        [
          prisma.project.count({ where }),
          prisma.project.findMany({
            where,
            include: projectInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * MY_PROJECTS_PAGE_SIZE,
            take: MY_PROJECTS_PAGE_SIZE,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      const activeCounts = await countActiveApplications(
        prisma,
        projects.map((project) => project.id),
      );
      return {
        data: projects.map((project) =>
          toMyProject(withCurrentStatus(project, today), activeCounts.get(project.id) ?? 0),
        ),
        pagination: pagination(page, MY_PROJECTS_PAGE_SIZE, totalCount),
      };
    },

    /**
     * SRCH-01 공개 검색. 삭제·취소 제외, 상태는 날짜로 계산(D-83), 페이지당 10개.
     * 개수와 목록을 같은 스냅샷(REPEATABLE READ)에서 읽어 서로 어긋나지 않게 한다.
     * 마감임박순처럼 구간이 둘이면 앞 구간 개수로 어느 구간의 몇 번째부터 읽을지 정한다.
     */
    async searchProjects(criteria) {
      const today = todayKst(now());
      const todayDate = toDbDate(today);
      const base = [PUBLIC_PROJECT_WHERE, ...buildSearchWhere(criteria, todayDate)];
      const segments = searchSegments(criteria.sort, todayDate).map((segment) => ({
        ...segment,
        where: { AND: segment.where ? [...base, segment.where] : base },
      }));

      const { totalCount, projects } = await prisma.$transaction(
        async (tx) => {
          const counts = [];
          for (const segment of segments)
            counts.push(await tx.project.count({ where: segment.where }));

          let skip = (criteria.page - 1) * SEARCH_PAGE_SIZE;
          const rows = [];
          for (const [index, segment] of segments.entries()) {
            const take = SEARCH_PAGE_SIZE - rows.length;
            if (take === 0) break;
            if (skip >= counts[index]) {
              skip -= counts[index];
              continue;
            }
            rows.push(
              ...(await tx.project.findMany({
                where: segment.where,
                select: searchSelect,
                orderBy: segment.orderBy,
                skip,
                take,
              })),
            );
            skip = 0;
          }
          return { totalCount: counts.reduce((sum, count) => sum + count, 0), projects: rows };
        },
        { isolationLevel: 'RepeatableRead' },
      );

      return {
        data: projects.map((project) => toSearchItem(withCurrentStatus(project, today))),
        pagination: pagination(criteria.page, SEARCH_PAGE_SIZE, totalCount),
      };
    },
  };
}
