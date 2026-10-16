import { HttpError } from '../../utils/httpError.js';
import { parseEstimateResponse, sumEstimatedAmounts } from './estimate.schema.js';

/**
 * @param {{ prisma: object, provider: { name: string, isMock: boolean, analyze: Function } }} deps
 */
export function createEstimateService({ prisma, provider }) {
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

  /**
   * provider 호출 → 스키마 검증(실패 시 1회 재시도) → 총액 재계산.
   * @param {{ title: string, description: string, category: string | null, techStackIds: number[] }} input
   */
  async function analyzePrice(input) {
    const techStackNames = await resolveTechStackNames(input.techStackIds);
    const providerInput = {
      title: input.title,
      description: input.description,
      category: input.category,
      techStackNames,
    };

    let lastReason = 'invalid response';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let raw;
      try {
        raw = await provider.analyze(providerInput);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'AI_UNAVAILABLE', 'AI 단가 분석을 사용할 수 없습니다.');
      }

      // provider가 이미 파싱된 items(estimatedAmount: bigint)를 줄 수도 있고, JSON 형태일 수도 있다.
      const normalized =
        raw && Array.isArray(raw.items)
          ? {
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
            }
          : raw;

      const parsed = parseEstimateResponse(normalized);
      if (!parsed.ok) {
        lastReason = parsed.reason;
        continue;
      }

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
        isMock: provider.isMock,
      };
    }

    throw new HttpError(
      502,
      'AI_INVALID_RESPONSE',
      'AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
      { reason: lastReason },
    );
  }

  return { analyzePrice };
}
