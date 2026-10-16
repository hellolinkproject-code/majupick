/**
 * 토스페이먼츠 PG 설정(D-16, D-123, N-04).
 * 기본 mock. live 키면 기동/결제 기능을 거부한다. 시크릿은 로그에 남기지 않는다.
 */

const DEFAULTS = Object.freeze({
  mode: 'mock',
  enableTestCalls: false,
  confirmUrl: 'https://api.tosspayments.com/v1/payments/confirm',
  retrieveUrlBase: 'https://api.tosspayments.com/v1/payments',
  timeoutMs: 15_000,
});

const MODES = new Set(['mock', 'toss']);

export class PgConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PgConfigError';
  }
}

function parseBoolean(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new PgConfigError(`${key} must be a boolean (true/false)`);
}

/** 테스트 클라이언트 키: test_ck_ / test_gck_ (SDK v2·API 개별 연동). */
export function isTossTestClientKey(key) {
  return typeof key === 'string' && /^(test_ck_|test_gck_)/.test(key);
}

/** 테스트 시크릿 키: test_sk_ / test_gsk_ */
export function isTossTestSecretKey(key) {
  return typeof key === 'string' && /^(test_sk_|test_gsk_)/.test(key);
}

export function isTossLiveKey(key) {
  return typeof key === 'string' && /^(live_ck_|live_sk_|live_gck_|live_gsk_)/.test(key);
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadPgConfig(env = process.env) {
  const rawMode = (env.PG_MODE ?? DEFAULTS.mode).trim().toLowerCase();
  if (!MODES.has(rawMode)) {
    throw new PgConfigError('PG_MODE must be "mock" or "toss"');
  }

  const clientKeyRaw = env.TOSS_CLIENT_KEY;
  const secretKeyRaw = env.TOSS_SECRET_KEY;
  const clientKey =
    typeof clientKeyRaw === 'string' && clientKeyRaw.trim() !== '' ? clientKeyRaw.trim() : null;
  const secretKey =
    typeof secretKeyRaw === 'string' && secretKeyRaw.trim() !== '' ? secretKeyRaw.trim() : null;

  if (isTossLiveKey(clientKey) || isTossLiveKey(secretKey)) {
    throw new PgConfigError(
      'Live Toss Payments keys are not allowed. Use test keys only (test_ck_/test_sk_ or test_gck_/test_gsk_).',
    );
  }

  const enableTestCalls = parseBoolean(env, 'TOSS_ENABLE_TEST_CALLS', DEFAULTS.enableTestCalls);

  if (rawMode === 'toss') {
    if (!clientKey || !secretKey) {
      throw new PgConfigError(
        'PG_MODE=toss requires TOSS_CLIENT_KEY and TOSS_SECRET_KEY (test keys only)',
      );
    }
    if (!isTossTestClientKey(clientKey) || !isTossTestSecretKey(secretKey)) {
      throw new PgConfigError(
        'TOSS_CLIENT_KEY / TOSS_SECRET_KEY must be Toss test keys (test_ck_/test_sk_ or test_gck_/test_gsk_)',
      );
    }
  }

  return Object.freeze({
    mode: rawMode,
    clientKey,
    secretKey,
    enableTestCalls,
    confirmUrl: DEFAULTS.confirmUrl,
    retrieveUrlBase: DEFAULTS.retrieveUrlBase,
    timeoutMs: DEFAULTS.timeoutMs,
    /** FE가 SDK를 쓸지 Fake 리다이렉트를 쓸지 */
    usesBrowserSdk: rawMode === 'toss' && enableTestCalls && Boolean(clientKey),
    /** 서버가 실제 Toss confirm HTTP를 칠지 */
    usesLiveConfirm: rawMode === 'toss' && enableTestCalls && Boolean(secretKey),
  });
}

/** 시크릿을 제외한 공개 요약(응답·로그용). */
export function publicPgInfo(pgConfig) {
  return {
    mode: pgConfig.mode,
    usesBrowserSdk: pgConfig.usesBrowserSdk,
    clientKey: pgConfig.usesBrowserSdk ? pgConfig.clientKey : null,
  };
}
