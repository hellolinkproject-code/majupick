import { HttpError } from '../../utils/httpError.js';
import { BIGINT_MAX, parseAmount } from '../profiles/profile.validation.js';

/**
 * OFFER-01 합의 금액 제안 본문. 금액만 받으며 BigInt로 보관한다(D-51).
 * @returns {{ fields: Record<string, string>, offerAmount: bigint | null }}
 */
export function parseOfferAmountBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (key !== 'offerAmount') fields[key] = '이 값은 보낼 수 없습니다.';
  }
  const offerAmount = parseAmount(input.offerAmount);
  if (offerAmount === null || offerAmount <= 0n) {
    fields.offerAmount = '합의 금액은 1원 이상의 정수로 입력해 주세요.';
  } else if (offerAmount > BIGINT_MAX) {
    fields.offerAmount = '저장할 수 있는 최대 금액을 넘었습니다.';
  }
  return { fields, offerAmount: fields.offerAmount ? null : offerAmount };
}

/** 경로의 계약 ID. 형식이 틀리면 404. */
export function parseContractId(value) {
  const id = /^\d{1,9}$/.test(value) ? Number(value) : 0;
  if (id > 0) return id;
  throw new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
}

export const CONTRACT_LIST_PAGE_SIZE = 10;
export const CONTRACT_STATUSES = Object.freeze([
  'SIGNATURE_PENDING',
  'SIGNED',
  'IN_PROGRESS',
  'DELIVERY_REQUESTED',
  'COMPLETED',
  'CANCELLED',
]);

/**
 * CTR-05 서명 본문. `{ agreed: true }`만 허용. 서명 시각·사용자 ID는 받지 않는다.
 * @returns {{ fields: Record<string, string>, agreed: boolean }}
 */
export function parseSignBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (key !== 'agreed') fields[key] = '이 값은 보낼 수 없습니다.';
  }
  if (input.agreed !== true) {
    fields.agreed = '계약 내용에 동의한 뒤에만 전자서명할 수 있습니다.';
  }
  return { fields, agreed: input.agreed === true && Object.keys(fields).length === 0 };
}

/** CTR-03 목록 쿼리. */
export function parseContractListQuery(query) {
  const pageRaw = query?.page;
  let page = 1;
  if (pageRaw !== undefined && pageRaw !== '') {
    const n = Number(pageRaw);
    if (!Number.isInteger(n) || n < 1) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
        fields: { page: '페이지는 1 이상의 정수여야 합니다.' },
      });
    }
    page = n;
  }
  if (query?.status === undefined || query.status === '') return { page, status: null };
  if (CONTRACT_STATUSES.includes(query.status)) return { page, status: query.status };
  throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { status: '계약 상태 값이 올바르지 않습니다.' },
  });
}
