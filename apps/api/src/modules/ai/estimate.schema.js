/**
 * LLM(또는 mock) 원시 응답을 검증한다. 총액은 여기서 믿지 않고, 서비스가 항목 합으로 다시 계산한다.
 * zod 없이 수동 검증(기존 모듈과 동일).
 */

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const RATIONALE_MAX = 500;
const ITEMS_MIN = 1;
const ITEMS_MAX = 20;
/** 기능당 최대 금액(원, 최대 18자리). 비정상 거액 차단. */
export const AMOUNT_MAX = 999_999_999_999_999_999n;

/** 양의 정수 금액(BigInt). 문자열·안전 정수만 받는다. */
export function parseEstimateAmount(value) {
  if (typeof value === 'bigint') {
    return value > 0n && value <= AMOUNT_MAX ? value : null;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && BigInt(value) <= AMOUNT_MAX
      ? BigInt(value)
      : null;
  }
  if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    return amount > 0n && amount <= AMOUNT_MAX ? amount : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, items: { name: string, description: string, estimatedAmount: bigint, rationale: string }[], assumptions: string[] }
 *   | { ok: false, reason: string }}
 */
export function parseEstimateResponse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'response must be an object' };
  }
  // OpenAI Structured Outputs는 functions, mock/DTO는 items
  const items = raw.items ?? raw.functions;
  const { assumptions } = raw;
  if (!Array.isArray(items) || items.length < ITEMS_MIN || items.length > ITEMS_MAX) {
    return { ok: false, reason: `items must have ${ITEMS_MIN}–${ITEMS_MAX} entries` };
  }

  const parsedItems = [];
  const seenNames = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: `items[${i}] must be an object` };
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const rationale = typeof item.rationale === 'string' ? item.rationale.trim() : '';
    const amountRaw = item.estimatedAmount ?? item.estimatedPrice;
    const estimatedAmount = parseEstimateAmount(amountRaw);

    if (!name || name.length > NAME_MAX) {
      return { ok: false, reason: `items[${i}].name is invalid` };
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      return { ok: false, reason: `items[${i}].name is duplicated` };
    }
    seenNames.add(nameKey);
    if (!description || description.length > DESCRIPTION_MAX) {
      return { ok: false, reason: `items[${i}].description is invalid` };
    }
    if (!rationale || rationale.length > RATIONALE_MAX) {
      return { ok: false, reason: `items[${i}].rationale is invalid` };
    }
    if (estimatedAmount === null) {
      return { ok: false, reason: `items[${i}].estimatedAmount is invalid` };
    }
    parsedItems.push({ name, description, estimatedAmount, rationale });
  }

  let parsedAssumptions = [];
  if (assumptions !== undefined && assumptions !== null) {
    if (!Array.isArray(assumptions)) {
      return { ok: false, reason: 'assumptions must be an array' };
    }
    parsedAssumptions = assumptions
      .filter((text) => typeof text === 'string')
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  return { ok: true, items: parsedItems, assumptions: parsedAssumptions };
}

/** 항목 단가의 합. LLM이 준 totalAmount/totalPrice는 무시한다. */
export function sumEstimatedAmounts(items) {
  return items.reduce((sum, item) => sum + item.estimatedAmount, 0n);
}
