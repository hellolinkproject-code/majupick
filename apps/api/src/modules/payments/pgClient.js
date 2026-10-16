/**
 * PG 클라이언트. mock은 Fake, toss+enableTestCalls면 토스 승인 API.
 * 시크릿 키는 Basic 인증에만 쓰고 로그·응답에 넣지 않는다.
 */

import { HttpError } from '../../utils/httpError.js';

/**
 * @typedef {{
 *   status: string,
 *   totalAmount: number,
 *   orderId: string,
 *   paymentKey: string,
 *   method: string | null,
 *   currency: string,
 *   approvedAt?: string | null,
 * }} PgPaymentResult
 */

export function createFakePgClient({ behavior = 'success' } = {}) {
  /** @type {Map<string, PgPaymentResult>} */
  const approved = new Map();

  return {
    kind: 'fake',
    /**
     * @param {{ paymentKey: string, orderId: string, amount: number }} input
     * @returns {Promise<PgPaymentResult>}
     */
    async confirm({ paymentKey, orderId, amount }) {
      if (behavior === 'network_error') {
        throw new HttpError(502, 'PG_ERROR', 'PG 승인 서버와 통신하지 못했습니다.');
      }
      if (behavior === 'reject') {
        const err = new HttpError(502, 'PG_ERROR', 'PG가 결제를 승인하지 않았습니다.');
        err.pgCode = 'REJECT_CARD_COMPANY';
        throw err;
      }
      if (behavior === 'wrong_amount') {
        return {
          status: 'DONE',
          totalAmount: amount + 1,
          orderId,
          paymentKey,
          method: '카드',
          currency: 'KRW',
          approvedAt: new Date().toISOString(),
        };
      }
      if (behavior === 'not_done') {
        return {
          status: 'WAITING_FOR_DEPOSIT',
          totalAmount: amount,
          orderId,
          paymentKey,
          method: '가상계좌',
          currency: 'KRW',
          approvedAt: null,
        };
      }
      const existing = approved.get(paymentKey);
      if (existing) return existing;
      const result = {
        status: 'DONE',
        totalAmount: amount,
        orderId,
        paymentKey,
        method: '카드',
        currency: 'KRW',
        approvedAt: new Date().toISOString(),
      };
      approved.set(paymentKey, result);
      return result;
    },
    async retrieve(paymentKey) {
      const hit = approved.get(paymentKey);
      if (!hit) {
        throw new HttpError(502, 'PG_ERROR', 'PG에서 결제 정보를 찾지 못했습니다.');
      }
      return hit;
    },
    /** 테스트용: 승인만 기록하고 DB는 건드리지 않은 상태를 흉내 낸다 */
    seedApproved(result) {
      approved.set(result.paymentKey, result);
    },
  };
}

/**
 * @param {ReturnType<import('../../config/pg.js').loadPgConfig>} pgConfig
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export function createTossPgClient(pgConfig, { fetchImpl = fetch } = {}) {
  const authHeader = `Basic ${Buffer.from(`${pgConfig.secretKey}:`, 'utf8').toString('base64')}`;

  async function callJson(url, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), pgConfig.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof json.message === 'string' ? json.message : 'PG 승인 요청이 실패했습니다.';
        const err = new HttpError(502, 'PG_ERROR', message);
        err.pgCode = typeof json.code === 'string' ? json.code : null;
        throw err;
      }
      return json;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'PG_ERROR', 'PG 승인 서버와 통신하지 못했습니다.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'toss',
    async confirm({ paymentKey, orderId, amount }) {
      const json = await callJson(pgConfig.confirmUrl, {
        method: 'POST',
        body: { paymentKey, orderId, amount },
      });
      return normalizeTossPayment(json);
    },
    async retrieve(paymentKey) {
      const json = await callJson(`${pgConfig.retrieveUrlBase}/${encodeURIComponent(paymentKey)}`);
      return normalizeTossPayment(json);
    },
  };
}

function normalizeTossPayment(json) {
  return {
    status: String(json.status ?? ''),
    totalAmount: Number(json.totalAmount),
    orderId: String(json.orderId ?? ''),
    paymentKey: String(json.paymentKey ?? ''),
    method: json.method != null ? String(json.method) : null,
    currency: String(json.currency ?? 'KRW'),
    approvedAt: json.approvedAt != null ? String(json.approvedAt) : null,
  };
}

/**
 * @param {ReturnType<import('../../config/pg.js').loadPgConfig>} pgConfig
 * @param {{ fakeBehavior?: string, fetchImpl?: typeof fetch }} [opts]
 */
export function createPgClient(pgConfig, opts = {}) {
  if (pgConfig.usesLiveConfirm) {
    return createTossPgClient(pgConfig, opts);
  }
  return createFakePgClient({ behavior: opts.fakeBehavior ?? 'success' });
}
