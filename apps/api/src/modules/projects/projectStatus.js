// 프로젝트 모집 날짜(KST date, D-41·D-58)와 상태(D-03) 규칙.
// 날짜는 API·서비스에서 'YYYY-MM-DD' 문자열로 다루고, DB(date)와 주고받을 때만 UTC 자정 Date로 바꾼다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 모집 단계에서 수정·삭제가 가능한 상태(D-07, D-55). 거래 단계(CONTRACTING 이후)와 취소는 막는다. */
export const EDITABLE_STATUSES = new Set(['SCHEDULED', 'RECRUITING', 'CLOSED']);
export const DELETABLE_STATUSES = new Set(['SCHEDULED', 'RECRUITING', 'CLOSED']);
/** 모집이 아직 열려 있어 날짜에 따라 상태가 바뀌는 상태. */
export const OPEN_STATUSES = new Set(['SCHEDULED', 'RECRUITING']);

/** 한국 시간 기준 오늘 날짜('YYYY-MM-DD'). */
export function todayKst(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'를 DB date 컬럼에 넣을 Date(UTC 자정)로 바꾼다. */
export function toDbDate(day) {
  return day === null ? null : new Date(`${day}T00:00:00.000Z`);
}

/** DB date 컬럼 값(UTC 자정 Date)을 'YYYY-MM-DD'로 바꾼다. */
export function fromDbDate(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** 등록·시작일 변경 시 상태(A-24): 시작일이 없거나 오늘 이전이면 모집 중, 미래면 모집 예정. */
export function initialRecruitStatus(recruitStartDate, today) {
  return recruitStartDate === null || recruitStartDate <= today ? 'RECRUITING' : 'SCHEDULED';
}

/** 외부 노출 상태(A-26). 거래 단계·취소는 모두 '모집 마감'으로 보인다. */
export function toPublicStatus(status) {
  return OPEN_STATUSES.has(status) ? status : 'CLOSED';
}

/**
 * 저장된 상태에 날짜 경과를 반영한 지금의 상태(D-83). 조회는 DB를 바꾸지 않고 이 값을 보여 준다.
 * 저장 시 동기화(projectClosure.js syncLockedProject)의 결과와 같아야 하고, 검색 조건(publicStatusWhere)과도 같아야 한다.
 */
export function effectiveStatus(project, today) {
  if (!OPEN_STATUSES.has(project.status)) return project.status;
  if (fromDbDate(project.recruitEndDate) < today) return 'CLOSED';
  const start = fromDbDate(project.recruitStartDate);
  if (project.status === 'SCHEDULED' && start !== null && start <= today) return 'RECRUITING';
  return project.status;
}

/** 외부 목록에 나오는 프로젝트: 삭제·취소 제외(A-26, PRJ-02와 같은 공개 범위). */
export const PUBLIC_PROJECT_WHERE = Object.freeze({
  deletedAt: null,
  status: { not: 'CANCELLED' },
});

/**
 * effectiveStatus 결과의 공개 상태가 publicStatus인 행만 고르는 Prisma 조건.
 * @param {'SCHEDULED'|'RECRUITING'|'CLOSED'} publicStatus
 * @param {Date} today KST 오늘(toDbDate 값)
 */
export function publicStatusWhere(publicStatus, today) {
  const stillOpen = { status: { in: [...OPEN_STATUSES] }, recruitEndDate: { gte: today } };
  if (publicStatus === 'SCHEDULED') {
    return {
      ...stillOpen,
      status: 'SCHEDULED',
      OR: [{ recruitStartDate: null }, { recruitStartDate: { gt: today } }],
    };
  }
  if (publicStatus === 'RECRUITING') {
    return {
      ...stillOpen,
      OR: [{ status: 'RECRUITING' }, { recruitStartDate: { lte: today } }],
    };
  }
  return {
    OR: [
      { status: { notIn: [...OPEN_STATUSES, 'CANCELLED'] } },
      { status: { in: [...OPEN_STATUSES] }, recruitEndDate: { lt: today } },
    ],
  };
}

/** 마감일이 오늘 이후라 아직 모집 예정·모집 중인 행(마감임박순 앞 구간). */
export function stillOpenWhere(today) {
  return { status: { in: [...OPEN_STATUSES] }, recruitEndDate: { gte: today } };
}
