import { billableBlockReason, canMakeBillableCalls } from '../../config/ai.js';
import { HttpError } from '../../utils/httpError.js';
import { parseEstimateResponse, sumEstimatedAmounts } from './estimate.schema.js';
import { mapOpenAiError } from './providers/openaiProvider.js';

/**
 * @param {{
 *   prisma: object,
 *   provider: { name: string, isMock: boolean, analyze: Function },
 *   aiConfig?: ReturnType<import('../../config/ai.js').loadAiConfig>,
 *   usageLedger?: ReturnType<import('./usageLedger.js').createUsageLedger> | null,
 * }} deps
 */
export function createEstimateService({ prisma, provider, aiConfig = null, usageLedger = null }) {
  async function resolveTechStackNames(techStackIds) {
    if (techStackIds.length === 0) return [];
    const rows = await prisma.techStack.findMany({
      where: { id: { in: techStackIds } },
      select: { id: true, name: true },
    });
    if (rows.length !== techStackIds.length) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
        fields: { techStackIds: '존재하지 않는 기술 스택이 포함되어 있습니다.' },
      });
    }
    const byId = new Map(rows.map((row) => [row.id, row.name]));
    return techStackIds.map((id) => byId.get(id));
  }

  function toDto(parsed, isMock) {
    const totalAmount = sumEstimatedAmounts(parsed.items);
    return {
      items: parsed.items.map((item) => ({
        name: item.name,
        description: item.description,
        estimatedAmount: item.estimatedAmount.toString(),
        rationale: item.rationale,
      })),
      totalAmount: totalAmount.toString(),
      assumptions: parsed.assumptions,
      isMock,
    };
  }

  function normalizeRaw(raw) {
    if (raw && Array.isArray(raw.items)) {
      return {
        items: raw.items.map((item) => ({
          name: item.name,
          description: item.description,
          estimatedAmount:
            typeof item.estimatedAmount === 'bigint'
              ? item.estimatedAmount.toString()
              : item.estimatedAmount,
          rationale: item.rationale,
        })),
        assumptions: raw.assumptions,
      };
    }
    if (raw && Array.isArray(raw.functions)) {
      return { items: raw.functions, assumptions: raw.assumptions };
    }
    return raw;
  }

  /**
   * mock: 스키마 실패 시 1회 재시도(비용 없음).
   * openai: 유료 호출이므로 API 재시도 없음. 예산 예약 → 호출 → usage 정산.
   * @param {{ title: string, description: string, category: string | null, techStackIds: number[] }} input
   * @param {{ userId: number }} ctx
   */
  async function analyzePrice(input, ctx = {}) {
    const techStackNames = await resolveTechStackNames(input.techStackIds);
    const providerInput = {
      title: input.title,
      description: input.description,
      category: input.category,
      techStackNames,
    };

    if (provider.isMock) {
      let lastReason = 'invalid response';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let raw;
        try {
          raw = await provider.analyze(providerInput);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(503, 'AI_UNAVAILABLE', 'AI 단가 분석을 사용할 수 없습니다.');
        }
        const parsed = parseEstimateResponse(normalizeRaw(raw));
        if (!parsed.ok) {
          lastReason = parsed.reason;
          continue;
        }
        return toDto(parsed, true);
      }
      throw new HttpError(
        502,
        'AI_INVALID_RESPONSE',
        'AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
        { reason: lastReason },
      );
    }

    // ---- OpenAI (유료 가능) 경로 ----
    if (!aiConfig) {
      throw new HttpError(503, 'AI_UNAVAILABLE', 'AI 단가 분석을 사용할 수 없습니다.');
    }
    const block = billableBlockReason(aiConfig);
    if (block) {
      const status =
        block.code === 'AI_BUDGET_EXCEEDED' || block.code === 'AI_CONCURRENCY_LIMITED' ? 429 : 503;
      throw new HttpError(status, block.code, block.message);
    }
    if (!canMakeBillableCalls(aiConfig) || !usageLedger) {
      throw new HttpError(503, 'AI_BILLABLE_DISABLED', '유료 AI 호출이 허용되지 않았습니다.');
    }
    if (!ctx.userId) {
      throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    }

    const reservation = await usageLedger.reserve({ userId: ctx.userId });
    let raw;
    try {
      raw = await provider.analyze(providerInput);
    } catch (error) {
      const mapped = mapOpenAiError(error);
      const details = error instanceof HttpError ? error.details : mapped.details;
      const usage = details?.usage;
      const billableAttempted = details?.billableAttempted === true;
      const uncertain =
        billableAttempted ||
        mapped.code === 'AI_TIMEOUT' ||
        mapped.code === 'AI_NETWORK' ||
        mapped.code === 'AI_UNAVAILABLE' ||
        mapped.code === 'AI_INVALID_RESPONSE';
      if (billableAttempted && usage) await usageLedger.settle(reservation, usage);
      else if (uncertain) await usageLedger.markUncertain(reservation, mapped.code);
      else await usageLedger.release(reservation, mapped.code);
      throw mapped;
    }

    const parsed = parseEstimateResponse(normalizeRaw(raw));
    if (!parsed.ok) {
      // 응답은 받았으므로 과금됐을 수 있음 → usage로 정산 시도, 없으면 예약 유지
      if (raw?.usage) await usageLedger.settle(reservation, raw.usage);
      else await usageLedger.markUncertain(reservation, 'AI_INVALID_RESPONSE');
      throw new HttpError(
        502,
        'AI_INVALID_RESPONSE',
        'AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
        { reason: parsed.reason },
      );
    }

    // usage가 없으면 과소 정산을 피하기 위해 예약을 확정(보수적)
    if (!raw?.usage || (raw.usage.inputTokens === 0 && raw.usage.outputTokens === 0)) {
      await usageLedger.markUncertain(reservation, 'AI_USAGE_MISSING');
    } else {
      await usageLedger.settle(reservation, raw.usage);
    }
    return toDto(parsed, false);
  }

  return { analyzePrice };
}
