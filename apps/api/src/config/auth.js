import { randomBytes } from 'node:crypto';

// 인증 설정. 기본값의 근거는 planning/DECISIONS.md D-25, D-26, D-64~D-68.
const DEFAULTS = Object.freeze({
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 14,
  bcryptRounds: 12,
  loginRateLimitMax: 10,
  loginRateLimitWindowMinutes: 15,
});

const MIN_SECRET_LENGTH = 32;

export class AuthConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

function parsePositiveInt(env, key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AuthConfigError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const SAME_SITE_VALUES = new Set(['lax', 'strict', 'none']);

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ accessTokenSecret: string, ephemeralSecret: boolean, accessTokenTtlSeconds: number,
 *   refreshTokenTtlDays: number, bcryptRounds: number, cookieSecure: boolean,
 *   cookieSameSite: 'lax' | 'strict' | 'none',
 *   loginRateLimit: { max: number, windowMs: number } }}
 */
export function loadAuthConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  let accessTokenSecret = env.JWT_ACCESS_SECRET ?? '';
  let ephemeralSecret = false;
  if (!accessTokenSecret) {
    if (isProduction) throw new AuthConfigError('JWT_ACCESS_SECRET is required in production');
    // 개발 편의용: 서버를 다시 켜면 Access Token만 무효가 되고, Refresh Token(DB 저장)으로 다시 발급된다.
    accessTokenSecret = randomBytes(48).toString('base64url');
    ephemeralSecret = true;
  } else if (accessTokenSecret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(`JWT_ACCESS_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const cookieSecureRaw = env.COOKIE_SECURE;
  if (
    cookieSecureRaw !== undefined &&
    cookieSecureRaw !== '' &&
    !/^(true|false)$/.test(cookieSecureRaw)
  ) {
    throw new AuthConfigError('COOKIE_SECURE must be "true" or "false"');
  }
  const cookieSecure = isProduction || cookieSecureRaw === 'true';

  const sameSiteRaw = (env.COOKIE_SAME_SITE ?? 'lax').trim().toLowerCase();
  if (!SAME_SITE_VALUES.has(sameSiteRaw)) {
    throw new AuthConfigError('COOKIE_SAME_SITE must be "lax", "strict", or "none"');
  }
  /** @type {'lax' | 'strict' | 'none'} */
  const cookieSameSite = sameSiteRaw;
  // SameSite=None 은 브라우저가 Secure를 요구한다(크로스 사이트 쿠키).
  if (cookieSameSite === 'none' && !cookieSecure) {
    throw new AuthConfigError('COOKIE_SAME_SITE=none requires Secure cookies (COOKIE_SECURE=true)');
  }

  return Object.freeze({
    accessTokenSecret,
    ephemeralSecret,
    accessTokenTtlSeconds: parsePositiveInt(
      env,
      'ACCESS_TOKEN_TTL_SECONDS',
      DEFAULTS.accessTokenTtlSeconds,
      {
        min: 60,
        max: 24 * 60 * 60,
      },
    ),
    refreshTokenTtlDays: parsePositiveInt(
      env,
      'REFRESH_TOKEN_TTL_DAYS',
      DEFAULTS.refreshTokenTtlDays,
      {
        max: 90,
      },
    ),
    bcryptRounds: parsePositiveInt(env, 'BCRYPT_ROUNDS', DEFAULTS.bcryptRounds, {
      min: isProduction ? 10 : 4,
      max: 15,
    }),
    cookieSecure,
    cookieSameSite,
    loginRateLimit: Object.freeze({
      max: parsePositiveInt(env, 'LOGIN_RATE_LIMIT_MAX', DEFAULTS.loginRateLimitMax),
      windowMs: DEFAULTS.loginRateLimitWindowMinutes * 60 * 1000,
    }),
  });
}
