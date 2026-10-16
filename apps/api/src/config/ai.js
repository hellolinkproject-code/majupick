// AI 단가 분석 설정(D-27, D-115). STEP 08-A는 mock만 실제 산정에 쓴다. 키 값은 로그에 남기지 않는다.

const DEFAULTS = Object.freeze({
  mode: 'mock',
  rateLimitMax: 20,
  rateLimitWindowMinutes: 60,
  openaiModel: 'gpt-4o-mini',
});

const MODES = new Set(['mock', 'openai']);

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

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ mode: 'mock' | 'openai', rateLimit: { max: number, windowMs: number },
 *   openai: { apiKey: string | null, model: string } }}
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

  return Object.freeze({
    mode: rawMode,
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
    }),
    openai: Object.freeze({ apiKey, model }),
  });
}
