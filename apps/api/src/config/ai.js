// AI 단가 분석 설정(D-27, D-115, D-117). 키·예산 값은 로그에 남기지 않는다.
// 유료 호출은 mode=openai + AI_ENABLE_BILLABLE_CALLS=true + 키 + 가격 + 월간 예산>0 이 모두 필요할 때만 허용한다.

const DEFAULTS = Object.freeze({
  mode: 'mock',
  rateLimitMax: 20,
  rateLimitWindowMinutes: 60,
  globalRateLimitMax: 60,
  maxConcurrent: 2,
  enableBillableCalls: false,
  monthlyBudgetUsd: 0,
  openaiModel: 'gpt-6-luna',
  // gpt-6-luna Standard 텍스트 토큰(USD / 1M). 설정이 없으면 이 모델만 기본 가격을 쓴다.
  lunaInputUsdPer1M: 0.1,
  lunaOutputUsdPer1M: 0.5,
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  // 예약 시 입력 토큰 상한(프롬프트+스키마 여유). 실제 usage로 정산한다.
  reserveInputTokens: 4_000,
});

const MODES = new Set(['mock', 'openai']);
/** 1 USD = 1_000_000 micro-USD (정수 보관용). */
export const MICRO_USD_PER_USD = 1_000_000n;

export class AiConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiConfigError';
  }
}

function parsePositiveInt(env, key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AiConfigError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseBoolean(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new AiConfigError(`${key} must be a boolean (true/false)`);
}

function parseUsdAmount(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new AiConfigError(`${key} must be a number between 0 and 1000000`);
  }
  return value;
}

/** USD 금액을 micro-USD(정수)로. 소수 6자리까지 반올림 없이 버림하지 않고 정확히 표현 가능한 값만. */
export function usdToMicroUsd(usd) {
  const scaled = Math.round(usd * Number(MICRO_USD_PER_USD));
  if (!Number.isSafeInteger(scaled) || scaled < 0) {
    throw new AiConfigError('USD amount is out of range for micro-USD storage');
  }
  return BigInt(scaled);
}

/**
 * 모델별 토큰 단가(micro-USD / 1M tokens). 가격이 없으면 null → 유료 호출 불가.
 * @param {string} model
 * @param {Record<string, string | undefined>} env
 */
function resolvePricing(model, env) {
  const inputOverride = env.AI_OPENAI_INPUT_USD_PER_1M;
  let inputUsd;
  let outputUsd;

  if (inputOverride !== undefined && inputOverride !== '') {
    inputUsd = parseUsdAmount(env, 'AI_OPENAI_INPUT_USD_PER_1M', NaN);
    outputUsd = parseUsdAmount(env, 'AI_OPENAI_OUTPUT_USD_PER_1M', NaN);
    if (
      !Number.isFinite(inputUsd) ||
      !Number.isFinite(outputUsd) ||
      inputUsd <= 0 ||
      outputUsd <= 0
    ) {
      throw new AiConfigError(
        'AI_OPENAI_INPUT_USD_PER_1M and AI_OPENAI_OUTPUT_USD_PER_1M must both be positive when set',
      );
    }
  } else if (model === 'gpt-6-luna' || model.startsWith('gpt-6-luna')) {
    inputUsd = DEFAULTS.lunaInputUsdPer1M;
    outputUsd = DEFAULTS.lunaOutputUsdPer1M;
  } else {
    return null;
  }

  return Object.freeze({
    inputMicroUsdPer1MTokens: usdToMicroUsd(inputUsd),
    outputMicroUsdPer1MTokens: usdToMicroUsd(outputUsd),
  });
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadAiConfig(env = process.env) {
  const rawMode = (env.AI_ESTIMATE_MODE ?? DEFAULTS.mode).trim().toLowerCase();
  if (!MODES.has(rawMode)) {
    throw new AiConfigError('AI_ESTIMATE_MODE must be "mock" or "openai"');
  }

  const apiKeyRaw = env.OPENAI_API_KEY;
  const apiKey = typeof apiKeyRaw === 'string' && apiKeyRaw.trim() !== '' ? apiKeyRaw.trim() : null;
  const modelRaw = env.OPENAI_MODEL;
  const model =
    typeof modelRaw === 'string' && modelRaw.trim() !== '' ? modelRaw.trim() : DEFAULTS.openaiModel;

  const enableBillableCalls = parseBoolean(
    env,
    'AI_ENABLE_BILLABLE_CALLS',
    DEFAULTS.enableBillableCalls,
  );
  const monthlyBudgetUsd = parseUsdAmount(
    env,
    'AI_ESTIMATE_MONTHLY_BUDGET_USD',
    DEFAULTS.monthlyBudgetUsd,
  );
  const pricing = resolvePricing(model, env);

  return Object.freeze({
    mode: rawMode,
    enableBillableCalls,
    monthlyBudgetMicroUsd: usdToMicroUsd(monthlyBudgetUsd),
    rateLimit: Object.freeze({
      max: parsePositiveInt(env, 'AI_ESTIMATE_RATE_LIMIT_MAX', DEFAULTS.rateLimitMax, {
        max: 1000,
      }),
      windowMs:
        parsePositiveInt(
          env,
          'AI_ESTIMATE_RATE_LIMIT_WINDOW_MINUTES',
          DEFAULTS.rateLimitWindowMinutes,
          { max: 24 * 60 },
        ) *
        60 *
        1000,
      globalMax: parsePositiveInt(
        env,
        'AI_ESTIMATE_GLOBAL_RATE_LIMIT_MAX',
        DEFAULTS.globalRateLimitMax,
        { max: 10_000 },
      ),
    }),
    maxConcurrent: parsePositiveInt(env, 'AI_ESTIMATE_MAX_CONCURRENT', DEFAULTS.maxConcurrent, {
      max: 100,
    }),
    openai: Object.freeze({
      apiKey,
      model,
      timeoutMs: parsePositiveInt(env, 'AI_OPENAI_TIMEOUT_MS', DEFAULTS.timeoutMs, {
        min: 1_000,
        max: 120_000,
      }),
      maxOutputTokens: parsePositiveInt(
        env,
        'AI_OPENAI_MAX_OUTPUT_TOKENS',
        DEFAULTS.maxOutputTokens,
        { min: 256, max: 16_384 },
      ),
      reserveInputTokens: parsePositiveInt(
        env,
        'AI_OPENAI_RESERVE_INPUT_TOKENS',
        DEFAULTS.reserveInputTokens,
        { min: 500, max: 100_000 },
      ),
      pricing,
    }),
  });
}

/**
 * 유료 외부 호출 6조건을 모두 만족하는지. 하나라도 아니면 false.
 * @param {ReturnType<typeof loadAiConfig>} aiConfig
 */
export function canMakeBillableCalls(aiConfig) {
  return (
    aiConfig.mode === 'openai' &&
    aiConfig.enableBillableCalls === true &&
    Boolean(aiConfig.openai.apiKey) &&
    Boolean(aiConfig.openai.model) &&
    aiConfig.openai.pricing != null &&
    aiConfig.monthlyBudgetMicroUsd > 0n
  );
}

/**
 * 유료 호출 불가 사유를 HttpError용 코드·메시지로. 키가 있어도 조건 미달이면 네트워크를 쓰지 않는다.
 * @param {ReturnType<typeof loadAiConfig>} aiConfig
 * @returns {{ code: string, message: string } | null} null이면 호출 가능
 */
export function billableBlockReason(aiConfig) {
  if (aiConfig.mode !== 'openai') {
    return {
      code: 'AI_UNAVAILABLE',
      message: 'AI 단가 분석이 OpenAI 모드가 아닙니다. AI_ESTIMATE_MODE=mock 을 사용해 주세요.',
    };
  }
  if (!aiConfig.enableBillableCalls) {
    return {
      code: 'AI_BILLABLE_DISABLED',
      message:
        '유료 AI 호출이 비활성화되어 있습니다. AI_ENABLE_BILLABLE_CALLS=true 와 월간 예산 설정이 필요합니다.',
    };
  }
  if (!aiConfig.openai.apiKey) {
    return {
      code: 'AI_KEY_MISSING',
      message:
        'OpenAI API 키가 설정되지 않았습니다. 서버 환경 변수 OPENAI_API_KEY 를 확인해 주세요.',
    };
  }
  if (!aiConfig.openai.pricing) {
    return {
      code: 'AI_PRICING_UNCONFIGURED',
      message:
        '모델 가격이 설정되지 않아 유료 호출을 할 수 없습니다. AI_OPENAI_INPUT_USD_PER_1M·OUTPUT 또는 지원 모델을 설정해 주세요.',
    };
  }
  if (aiConfig.monthlyBudgetMicroUsd <= 0n) {
    return {
      code: 'AI_BUDGET_EXCEEDED',
      message: '월간 AI 예산이 0이어서 유료 호출을 할 수 없습니다.',
    };
  }
  return null;
}

/**
 * @param {bigint} inputTokens
 * @param {bigint} outputTokens
 * @param {{ inputMicroUsdPer1MTokens: bigint, outputMicroUsdPer1MTokens: bigint }} pricing
 */
export function estimateCostMicroUsd(inputTokens, outputTokens, pricing) {
  const input = (inputTokens * pricing.inputMicroUsdPer1MTokens) / 1_000_000n;
  const output = (outputTokens * pricing.outputMicroUsdPer1MTokens) / 1_000_000n;
  // 최소 1 micro-USD 예약(0원 예약으로 한도 우회 방지)
  const total = input + output;
  return total > 0n ? total : 1n;
}
