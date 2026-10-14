import { HttpError } from '../../utils/httpError.js';
import { BIGINT_MAX, parseAmount } from '../profiles/profile.validation.js';
import { parsePage } from '../projects/project.validation.js';

export const COVER_LETTER_MAX_LENGTH = 2000;
export const DURATION_DAYS_MAX = 3650;
export const MY_APPLICATIONS_PAGE_SIZE = 10;
export const PROJECT_APPLICATIONS_PAGE_SIZE = 10;
export const APPLICATION_STATUSES = Object.freeze(['PENDING', 'ACCEPTED', 'REJECTED']);

/** 요청 본문으로 받지 않는 값. 지원자는 토큰에서, 상태는 서버만 정한다(D-52). */
const SERVER_ONLY_KEYS = ['freelancerId', 'projectId', 'status', 'rejectReason', 'decidedAt'];

const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key);

/**
 * APP-01 입력(A-29: 자기소개·예상 단가·예상 기간). 오류를 던지지 않고 항목별 메시지를 모아 돌려준다.
 * 권한·프로젝트 상태·중복 확인이 먼저이므로 서비스가 그 뒤에 fields를 보고 400을 낸다.
 */
export function parseApplicationInput(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of SERVER_ONLY_KEYS) {
    if (has(input, key)) fields[key] = '이 값은 직접 보낼 수 없습니다.';
  }

  const coverLetter = typeof input.coverLetter === 'string' ? input.coverLetter.trim() : '';
  if (!coverLetter) fields.coverLetter = '자기소개를 입력해 주세요.';
  else if (coverLetter.length > COVER_LETTER_MAX_LENGTH) {
    fields.coverLetter = `자기소개는 ${COVER_LETTER_MAX_LENGTH.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
  }

  const proposedAmount = parseAmount(input.proposedAmount);
  if (proposedAmount === null || proposedAmount <= 0n) {
    fields.proposedAmount = '예상 단가는 1원 이상의 정수로 입력해 주세요.';
  } else if (proposedAmount > BIGINT_MAX) {
    fields.proposedAmount = '저장할 수 있는 최대 금액을 넘었습니다.';
  }

  const days = input.proposedDurationDays;
  const durationOk = Number.isSafeInteger(days) && days >= 1 && days <= DURATION_DAYS_MAX;
  if (!durationOk) {
    fields.proposedDurationDays = `예상 기간은 1~${DURATION_DAYS_MAX.toLocaleString('ko-KR')}일 사이의 정수로 입력해 주세요.`;
  }

  return {
    fields,
    input: { coverLetter, proposedAmount, proposedDurationDays: durationOk ? days : null },
  };
}

/** 경로의 지원 ID. 형식이 틀리면 없는 지원과 같이 404(존재를 숨김, API_SPEC §1.3). */
export function parseApplicationId(value) {
  const id = /^\d{1,9}$/.test(value) ? Number(value) : 0;
  if (id > 0) return id;
  throw new HttpError(404, 'NOT_FOUND', '지원 내역을 찾을 수 없습니다.');
}

/** APP-02·APP-04 목록 쿼리: page(기본 1), status(선택, 3개 값). */
export function parseApplicationListQuery(query) {
  const page = parsePage(query.page);
  if (query.status === undefined) return { page, status: null };
  if (APPLICATION_STATUSES.includes(query.status)) return { page, status: query.status };
  throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { status: '지원 상태 값이 올바르지 않습니다.' },
  });
}

/**
 * DEC-01·02 본문. 선정·거절은 본문 없이 보낸다. 합의 금액(offerAmount, D-11)은 계약 단계에서 다루므로
 * 지금 보내면 조용히 무시하지 않고 400으로 알린다(지원서의 예상 단가는 계약 금액이 아니다).
 * @returns {Record<string, string>} 항목별 오류(없으면 빈 객체)
 */
export function parseDecisionBody(body) {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return { body: '본문 없이 요청해 주세요.' };
  const fields = {};
  for (const key of Object.keys(body)) {
    fields[key] =
      key === 'offerAmount'
        ? '합의 금액 제시는 계약 단계에서 제공합니다.'
        : '이 값은 보낼 수 없습니다.';
  }
  return fields;
}
