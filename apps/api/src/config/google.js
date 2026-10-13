import { AuthConfigError } from './auth.js';

const REDIRECT_PATH = '/api/auth/oauth/google/callback';
const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];

function blank(value) {
  return value === undefined || value.trim() === '';
}

/**
 * Google OAuth 설정. 세 값이 모두 없으면 기능을 끄고, 일부만 있으면 잘못된 설정으로 거부한다.
 * 비밀 값은 반환 객체에만 담고 로그로 남기지 않는다.
 * @param {Record<string, string | undefined>} env
 * @param {{ corsOrigins: string[] }} options
 */
export function loadGoogleOAuthConfig(env, { corsOrigins }) {
  const missing = REQUIRED.filter((key) => blank(env[key]));
  if (missing.length === REQUIRED.length) return Object.freeze({ enabled: false });
  if (missing.length > 0) {
    throw new AuthConfigError(`Google OAuth requires ${missing.join(', ')}`);
  }

  const clientId = env.GOOGLE_CLIENT_ID.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI.trim();

  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new AuthConfigError('GOOGLE_REDIRECT_URI must be an absolute URL');
  }

  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.username || url.password || url.search || url.hash) {
    throw new AuthConfigError('GOOGLE_REDIRECT_URI must not include credentials, query, or hash');
  }
  if (url.protocol === 'http:' && !localhost) {
    throw new AuthConfigError('GOOGLE_REDIRECT_URI may use http only for localhost');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AuthConfigError('GOOGLE_REDIRECT_URI must use http or https');
  }
  if (url.pathname !== REDIRECT_PATH) {
    throw new AuthConfigError(`GOOGLE_REDIRECT_URI path must be ${REDIRECT_PATH}`);
  }
  if (!corsOrigins.includes(url.origin)) {
    throw new AuthConfigError('GOOGLE_REDIRECT_URI origin must be included in CORS_ORIGIN');
  }

  return Object.freeze({
    enabled: true,
    clientId,
    clientSecret,
    redirectUri,
    frontendOrigin: url.origin,
  });
}
