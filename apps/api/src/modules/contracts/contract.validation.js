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
