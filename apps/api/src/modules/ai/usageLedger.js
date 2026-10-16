import { estimateCostMicroUsd } from '../../config/ai.js';
import { HttpError } from '../../utils/httpError.js';

/** 예산에 잡히는 상태: 예약·확정·불확실(과금 가능). RELEASED는 제외. */
const CHARGEABLE = Object.freeze(['RESERVED', 'SETTLED', 'FAILED_CHARGED']);

export function utcMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * PostgreSQL 기반 월간 예산 예약·정산(D-117).
 * 동시 요청은 월 행 FOR UPDATE로 직렬화한다. 타임아웃 등 불확실 실패는 환불하지 않는다.
 *
 * @param {{ prisma: object, aiConfig: ReturnType<import('../../config/ai.js').loadAiConfig> }} deps
 */
export function createUsageLedger({ prisma, aiConfig }) {
  function reservationCost() {
    const { pricing, reserveInputTokens, maxOutputTokens } = aiConfig.openai;
    return estimateCostMicroUsd(BigInt(reserveInputTokens), BigInt(maxOutputTokens), pricing);
  }

  /**
   * @param {{ userId: number }} args
   * @returns {Promise<{ id: bigint, reservedMicroUsd: bigint, monthKey: string }>}
   */
  async function reserve({ userId }) {
    const monthKey = utcMonthKey();
    const reservedMicroUsd = reservationCost();
    const budget = aiConfig.monthlyBudgetMicroUsd;
    const maxConcurrent = aiConfig.maxConcurrent;

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ai_budget_months (month_key, committed_micro_usd, updated_at)
        VALUES (${monthKey}, 0, NOW())
        ON CONFLICT (month_key) DO NOTHING
      `;

      const [monthRow] = await tx.$queryRaw`
        SELECT month_key, committed_micro_usd
        FROM ai_budget_months
        WHERE month_key = ${monthKey}
        FOR UPDATE
      `;
      if (!monthRow) {
        throw new HttpError(503, 'AI_UNAVAILABLE', 'AI 예산 상태를 확인할 수 없습니다.');
      }

      const openReserved = await tx.aiUsageLedger.count({
        where: { status: 'RESERVED' },
      });
      if (openReserved >= maxConcurrent) {
        throw new HttpError(
          429,
          'AI_CONCURRENCY_LIMITED',
          'AI 단가 분석 동시 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        );
      }

      const committed = BigInt(monthRow.committed_micro_usd);
      if (committed + reservedMicroUsd > budget) {
        throw new HttpError(
          429,
          'AI_BUDGET_EXCEEDED',
          '이번 달 AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }

      const nextCommitted = committed + reservedMicroUsd;
      await tx.$executeRaw`
        UPDATE ai_budget_months
        SET committed_micro_usd = ${nextCommitted}, updated_at = NOW()
        WHERE month_key = ${monthKey}
      `;

      const row = await tx.aiUsageLedger.create({
        data: {
          userId,
          monthKey,
          status: 'RESERVED',
          provider: 'openai',
          model: aiConfig.openai.model,
          reservedMicroUsd,
        },
      });

      return {
        id: row.id,
        reservedMicroUsd,
        monthKey,
      };
    });
  }

  /**
   * 실제 usage로 정산. 예약보다 크면 차액만큼 committed를 늘리고, 작으면 줄인다.
   * 예산 초과로 차액을 못 올릴 때는 FAILED_CHARGED로 두고 예약을 유지(보수적).
   */
  async function settle(reservation, usage) {
    const inputTokens = Number(usage?.inputTokens ?? 0);
    const outputTokens = Number(usage?.outputTokens ?? 0);
    const actual = estimateCostMicroUsd(
      BigInt(Math.max(0, inputTokens)),
      BigInt(Math.max(0, outputTokens)),
      aiConfig.openai.pricing,
    );

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT month_key FROM ai_budget_months WHERE month_key = ${reservation.monthKey} FOR UPDATE
      `;

      const [monthRow] = await tx.$queryRaw`
        SELECT committed_micro_usd FROM ai_budget_months WHERE month_key = ${reservation.monthKey}
      `;
      const committed = BigInt(monthRow.committed_micro_usd);
      const delta = actual - reservation.reservedMicroUsd;
      let nextCommitted = committed + delta;
      if (nextCommitted < 0n) nextCommitted = 0n;

      if (delta > 0n && nextCommitted > aiConfig.monthlyBudgetMicroUsd) {
        // 이미 호출된 비용은 환불하지 않고 예약을 확정 금액으로 올려 둔다(한도 초과 기록).
        nextCommitted = committed + delta;
      }

      await tx.$executeRaw`
        UPDATE ai_budget_months
        SET committed_micro_usd = ${nextCommitted}, updated_at = NOW()
        WHERE month_key = ${reservation.monthKey}
      `;

      await tx.aiUsageLedger.update({
        where: { id: reservation.id },
        data: {
          status: 'SETTLED',
          settledMicroUsd: actual,
          inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
          outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
          providerRequestId: usage?.requestId ?? null,
          settledAt: new Date(),
        },
      });
    });
  }

  /** API 호출 전·과금 가능성 없는 명확한 실패 → 예약 환불. */
  async function release(reservation, errorCode = null) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.aiUsageLedger.findUnique({ where: { id: reservation.id } });
      if (!row || row.status !== 'RESERVED') return;

      await tx.$executeRaw`
        SELECT month_key FROM ai_budget_months WHERE month_key = ${reservation.monthKey} FOR UPDATE
      `;
      const [monthRow] = await tx.$queryRaw`
        SELECT committed_micro_usd FROM ai_budget_months WHERE month_key = ${reservation.monthKey}
      `;
      const committed = BigInt(monthRow.committed_micro_usd);
      const next =
        committed >= reservation.reservedMicroUsd ? committed - reservation.reservedMicroUsd : 0n;
      await tx.$executeRaw`
        UPDATE ai_budget_months
        SET committed_micro_usd = ${next}, updated_at = NOW()
        WHERE month_key = ${reservation.monthKey}
      `;
      await tx.aiUsageLedger.update({
        where: { id: reservation.id },
        data: {
          status: 'RELEASED',
          settledMicroUsd: 0n,
          errorCode,
          settledAt: new Date(),
        },
      });
    });
  }

  /** 타임아웃 등 과금 불확실 → 예약 유지(보수적 차감). */
  async function markUncertain(reservation, errorCode) {
    await prisma.aiUsageLedger.updateMany({
      where: { id: reservation.id, status: 'RESERVED' },
      data: {
        status: 'FAILED_CHARGED',
        settledMicroUsd: reservation.reservedMicroUsd,
        errorCode,
        settledAt: new Date(),
      },
    });
  }

  /** 테스트·운영 점검용: 해당 월 chargeable 합. */
  async function committedMicroUsdForMonth(monthKey = utcMonthKey()) {
    const [row] = await prisma.$queryRaw`
      SELECT committed_micro_usd FROM ai_budget_months WHERE month_key = ${monthKey}
    `;
    return row ? BigInt(row.committed_micro_usd) : 0n;
  }

  return {
    reserve,
    settle,
    release,
    markUncertain,
    committedMicroUsdForMonth,
    reservationCost,
    CHARGEABLE,
  };
}
