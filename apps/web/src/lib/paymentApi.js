import { apiClient } from './apiClient.js';

/** PAY-01 결제 준비. 금액은 서버가 계약 합의 금액으로 정한다. */
export async function preparePayment(contractId) {
  const res = await apiClient.post(`/contracts/${contractId}/payments`);
  return res.data.data;
}

/** PAY-02 승인 검증. amount는 문자열로 보낸다(D-51). */
export async function confirmPayment({ paymentKey, orderId, amount }) {
  const res = await apiClient.post('/payments/confirm', {
    paymentKey,
    orderId,
    amount: String(amount),
  });
  return res.data.data;
}

/** PAY-03 결제 실패·취소 기록. */
export async function failPayment({ orderId, code, message }) {
  const res = await apiClient.post('/payments/fail', { orderId, code, message });
  return res.data.data;
}

/** PAY-04 내 결제 내역. */
export async function fetchMyPayments(page = 1) {
  const res = await apiClient.get('/me/payments', { params: { page } });
  return res.data;
}

/** PAY-05 결제 단건. */
export async function fetchPayment(paymentId) {
  const res = await apiClient.get(`/payments/${paymentId}`);
  return res.data.data;
}

/**
 * Fake PG: 토스 창 없이 successUrl로 이동해 승인 API를 검증한다.
 * 실제 샌드박스 SDK가 아닐 때만 사용한다.
 */
export function startFakeCheckout({ orderId, amount, successUrl }) {
  const key = `fake_pk_${orderId}`;
  const url = new URL(successUrl, window.location.origin);
  url.searchParams.set('paymentKey', key);
  url.searchParams.set('orderId', orderId);
  url.searchParams.set('amount', String(amount));
  window.location.assign(url.toString());
}

/**
 * 토스페이먼츠 SDK v2 결제창(카드). 클라이언트 키는 서버 prepare 응답 또는 VITE_TOSS_CLIENT_KEY.
 * @see https://docs.tosspayments.com/guides/v2/payment-window/integration
 */
export async function startTossCheckout({
  clientKey,
  orderId,
  orderName,
  amount,
  customerName,
  successUrl,
  failUrl,
}) {
  const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
  const toss = await loadTossPayments(clientKey);
  const payment = toss.payment({ customerKey: `wb_customer_${orderId}` });
  const amountNumber = Number(amount);
  if (!Number.isSafeInteger(amountNumber) || amountNumber <= 0) {
    throw new Error('결제 금액이 올바르지 않습니다.');
  }
  await payment.requestPayment({
    method: 'CARD',
    amount: { currency: 'KRW', value: amountNumber },
    orderId,
    orderName,
    successUrl,
    failUrl,
    customerName,
  });
}
