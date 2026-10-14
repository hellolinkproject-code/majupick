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
 * 날짜가 지난 프로젝트의 상태를 보정한다(D-08 조회 시 보정). 시작일이 된 모집 예정 → 모집 중,
 * 마감일이 지난 모집 예정·모집 중 → 모집 마감. 조건부 UPDATE라 여러 번 실행해도 결과가 같다.
 * applications 테이블을 추가하면 자동 마감 때 대기 지원 일괄 거절(A-34)을 이 함수에서 함께 처리해야 한다.
 * @param {object} db Prisma 클라이언트 또는 트랜잭션
 * @param {object} scope 대상 조건(예: { id }, { clientId })
 */
export async function syncRecruitStatuses(db, scope, now = new Date()) {
  const today = toDbDate(todayKst(now));
  const active = { ...scope, deletedAt: null };
  await db.project.updateMany({
    where: { ...active, status: 'SCHEDULED', recruitStartDate: { lte: today } },
    data: { status: 'RECRUITING' },
  });
  await db.project.updateMany({
    where: { ...active, status: { in: [...OPEN_STATUSES] }, recruitEndDate: { lt: today } },
    data: { status: 'CLOSED', closedAt: now },
  });
}
