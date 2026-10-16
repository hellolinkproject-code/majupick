import { HttpError } from '../../utils/httpError.js';

export const PAYMENT_LIST_PAGE_SIZE = 10;

/** Toss·JS 안전 정수 범위 안의 원화 금액만 number로 보낸다. */
export function toTossAmount(amountBigInt) {
  if (typeof amountBigInt !== 'bigint' || amountBigInt <= 0n) {
    throw new HttpError(409, 'INVALID_STATE_TRANSITION', '결제 금액이 유효하지 않습니다.');
  }
  if (amountBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(
      409,
      'INVALID_STATE_TRANSITION',
      '결제 금액이 PG가 처리할 수 있는 범위를 넘습니다.',
    );
  }
  return Number(amountBigInt);
}

export function parsePaymentId(value) {
  const id = /^\d{1,9}$/.test(value) ? Number(value) : 0;
  if (id > 0) return id;
  throw new HttpError(404, 'NOT_FOUND', '결제 내역을 찾을 수 없습니다.');
}

/**
 * PAY-02 본문. amount는 문자열 또는 안전한 정수. 클라이언트가 보낸 값은 DB와 대조만 한다.
 */
export function parseConfirmBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (!['paymentKey', 'orderId', 'amount'].includes(key)) {
      fields[key] = '이 값은 보낼 수 없습니다.';
    }
  }
  const paymentKey =
    typeof input.paymentKey === 'string' && input.paymentKey.trim() !== ''
      ? input.paymentKey.trim()
      : null;
  const orderId =
    typeof input.orderId === 'string' && input.orderId.trim() !== '' ? input.orderId.trim() : null;
  if (!paymentKey) fields.paymentKey = '결제 키가 필요합니다.';
  if (!orderId) fields.orderId = '주문 번호가 필요합니다.';
  if (paymentKey && paymentKey.length > 200) fields.paymentKey = '결제 키가 너무 깁니다.';
  if (orderId && orderId.length > 64) fields.orderId = '주문 번호가 너무 깁니다.';

  let amountBigInt = null;
  if (input.amount === undefined || input.amount === null || input.amount === '') {
    fields.amount = '결제 금액이 필요합니다.';
  } else if (typeof input.amount === 'number') {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      fields.amount = '결제 금액은 1원 이상의 안전한 정수여야 합니다.';
    } else amountBigInt = BigInt(input.amount);
  } else if (typeof input.amount === 'string' && /^\d{1,16}$/.test(input.amount)) {
    amountBigInt = BigInt(input.amount);
    if (amountBigInt <= 0n) fields.amount = '결제 금액은 1원 이상이어야 합니다.';
  } else {
    fields.amount = '결제 금액 형식이 올바르지 않습니다.';
  }

  return {
    fields,
    paymentKey,
    orderId,
    amountBigInt: Object.keys(fields).length ? null : amountBigInt,
  };
}

export function parseFailBody(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (!['orderId', 'code', 'message'].includes(key)) {
      fields[key] = '이 값은 보낼 수 없습니다.';
    }
  }
  const orderId =
    typeof input.orderId === 'string' && input.orderId.trim() !== '' ? input.orderId.trim() : null;
  if (!orderId) fields.orderId = '주문 번호가 필요합니다.';
  const code =
    typeof input.code === 'string' && input.code.trim() !== ''
      ? input.code.trim().slice(0, 80)
      : 'PAY_PROCESS_CANCELED';
  const message =
    typeof input.message === 'string' && input.message.trim() !== ''
      ? input.message.trim().slice(0, 500)
      : '결제가 취소되거나 실패했습니다.';
  return { fields, orderId, code, message };
}

export function parsePaymentListQuery(query) {
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
  return { page };
}
