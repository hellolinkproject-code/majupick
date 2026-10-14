// 서버 규칙(apps/api/src/modules/applications/application.validation.js)과 같은 기준. 최종 판단은 서버가 한다.
const BIGINT_MAX = 9223372036854775807n;

export const APPLICATION_LIMITS = Object.freeze({ coverLetter: 2000, durationDays: 3650 });

/** 지원 결과(RFP 3.2.4)의 화면 이름. */
export const APPLICATION_STATUS_LABELS = Object.freeze({
  PENDING: '검토 대기',
  ACCEPTED: '선정됨',
  REJECTED: '거절됨',
});

/** 지원자 본인에게 보이는 거절 사유(D-49 제안). 직접 거절과 자동 거절을 구분한다. */
export const REJECT_REASON_LABELS = Object.freeze({
  MANUAL: '의뢰인이 거절했습니다.',
  OTHER_ACCEPTED: '다른 지원자가 선정되어 자동으로 거절되었습니다.',
  PROJECT_CLOSED: '모집이 마감되어 자동으로 거절되었습니다.',
  NEGOTIATION_FAILED: '금액 합의가 이루어지지 않았습니다.',
  PROJECT_CANCELLED: '프로젝트가 취소되어 자동으로 거절되었습니다.',
  PROJECT_DELETED: '프로젝트가 삭제되어 자동으로 거절되었습니다.',
});

/** 의뢰인(소유자) 화면의 거절 구분. */
export const OWNER_REJECT_REASON_LABELS = Object.freeze({
  MANUAL: '직접 거절',
  OTHER_ACCEPTED: '자동 거절 · 다른 지원자 선정',
  PROJECT_CLOSED: '자동 거절 · 모집 마감',
  NEGOTIATION_FAILED: '금액 합의 결렬',
  PROJECT_CANCELLED: '자동 거절 · 프로젝트 취소',
  PROJECT_DELETED: '자동 거절 · 프로젝트 삭제',
});

export const emptyApplicationForm = () => ({
  coverLetter: '',
  proposedAmount: '',
  proposedDurationDays: '',
});

/** A-29의 세 항목은 모두 필수다. */
export function validateApplicationForm(form) {
  const errors = {};
  const coverLetter = form.coverLetter.trim();
  if (!coverLetter) errors.coverLetter = '자기소개를 입력해 주세요.';
  else if (coverLetter.length > APPLICATION_LIMITS.coverLetter) {
    errors.coverLetter = `자기소개는 ${APPLICATION_LIMITS.coverLetter.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
  }

  const amount = form.proposedAmount.trim();
  if (!/^\d{1,30}$/.test(amount) || BigInt(amount) <= 0n) {
    errors.proposedAmount = '예상 단가는 1원 이상의 정수로 입력해 주세요.';
  } else if (BigInt(amount) > BIGINT_MAX) {
    errors.proposedAmount = '저장할 수 있는 최대 금액을 넘었습니다.';
  }

  const days = form.proposedDurationDays.trim();
  if (
    !/^\d{1,4}$/.test(days) ||
    Number(days) < 1 ||
    Number(days) > APPLICATION_LIMITS.durationDays
  ) {
    errors.proposedDurationDays = `예상 기간은 1~${APPLICATION_LIMITS.durationDays.toLocaleString('ko-KR')}일 사이의 정수로 입력해 주세요.`;
  }
  return errors;
}

/** 서버로 보낼 값. 금액은 Number로 바꾸지 않는다(D-51). */
export function toApplicationPayload(form) {
  return {
    coverLetter: form.coverLetter.trim(),
    proposedAmount: form.proposedAmount.trim().replace(/^0+(?=\d)/, ''),
    proposedDurationDays: Number(form.proposedDurationDays.trim()),
  };
}
