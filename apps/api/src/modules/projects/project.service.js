import { HttpError } from '../../utils/httpError.js';
import { DATE_MESSAGES, MY_PROJECTS_PAGE_SIZE } from './project.validation.js';
import { buildSearchWhere, SEARCH_PAGE_SIZE, searchSegments } from './projectSearch.js';
import {
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  effectiveStatus,
  fromDbDate,
  initialRecruitStatus,
  PUBLIC_PROJECT_WHERE,
  syncRecruitStatuses,
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

const projectInclude = Object.freeze({
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
    // 지원(applications)은 아직 테이블이 없어 항상 0이다. 지원 단계에서 실제 개수로 바꾼다.
    applicantCount: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** 소유자에게만 7개 상태와 지금 할 수 있는 동작을 알려 FE가 버튼을 직접 계산하지 않게 한다. */
function ownerFields(project) {
  const availableActions = [];
  if (EDITABLE_STATUSES.has(project.status)) availableActions.push('EDIT');
  if (DELETABLE_STATUSES.has(project.status)) availableActions.push('DELETE');
  return {
    status: project.status,
    availableActions,
    lockedFields: project.status === 'CLOSED' ? CLOSED_LOCKED_FIELDS : [],
  };
}

export function toProjectDetail(project, viewerId = null) {
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
    ...(isOwner && ownerFields(project)),
  };
}

function toMyProject(project) {
  return { ...toSummary(project), ...ownerFields(project) };
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
});

const pagination = (page, pageSize, totalCount) => ({
  page,
  pageSize,
  totalCount,
  totalPages: Math.ceil(totalCount / pageSize),
});

const now = () => new Date();

/**
 * PRJ-01~05. 권한(로그인·역할·프로필)은 라우터 미들웨어가 먼저 확인하고,
 * 소유자·상태 확인은 프로젝트 행을 잠근 트랜잭션 안에서 한다.
 */
export function createProjectService({ prisma }) {
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

  /** 프로젝트 행을 잠그고 날짜 보정 후 다시 읽는다. 없거나 삭제됐으면 404, 남의 것이면 403. */
  async function lockOwnedProject(tx, projectId, userId, action) {
    const [row] = await tx.$queryRaw`
      SELECT client_id AS "clientId", deleted_at AS "deletedAt"
      FROM projects WHERE id = ${projectId} FOR UPDATE`;
    if (!row || row.deletedAt) throw notFound();
    if (row.clientId !== userId) throw notOwner(action);
    await syncRecruitStatuses(tx, { id: projectId }, now());
    return tx.project.findUnique({ where: { id: projectId } });
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

    /** PRJ-02. 삭제된 프로젝트는 누구에게나 404, 취소된 프로젝트는 소유자만 본다. DB는 바꾸지 않는다. */
    async getProject(projectId, viewerId = null) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        include: projectInclude,
      });
      if (!project) throw notFound();
      if (project.status === 'CANCELLED' && project.clientId !== viewerId) throw notFound();
      return toProjectDetail(withCurrentStatus(project, todayKst(now())), viewerId);
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

        return tx.project.update({ where: { id: projectId }, data, include: projectInclude });
      });
      return toProjectDetail(updated, userId);
    },

    /** PRJ-04 소프트 삭제(D-53). 행은 남기고 deleted_at만 기록한다. 모집 단계에서만 가능(D-07). */
    async deleteProject(userId, projectId) {
      await prisma.$transaction(async (tx) => {
        const project = await lockOwnedProject(tx, projectId, userId, '삭제');
        if (!DELETABLE_STATUSES.has(project.status)) throw lockedByStatus(project, '삭제');
        await tx.project.update({ where: { id: projectId }, data: { deletedAt: now() } });
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
      return {
        data: projects.map((project) => toMyProject(withCurrentStatus(project, today))),
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
