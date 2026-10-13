import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { HttpError } from '../../utils/httpError.js';
import { normalizeEmail, EMAIL_MAX_LENGTH, NAME_MAX_LENGTH } from './validation.js';

const GOOGLE_ISSUERS = Object.freeze(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';
const SCOPES = Object.freeze(['openid', 'email', 'profile']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const OAUTH_TTL_MS = 10 * 60 * 1000;

function oauthFailed() {
  return new HttpError(400, 'OAUTH_FAILED', 'Google 로그인에 실패했습니다. 다시 시도해 주세요.');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Google 표시 이름. 없으면 이메일 로컬 부분을 쓰고, 저장 한도(50자)를 넘기면 자른다. */
export function googleDisplayName(name, email) {
  const cleaned = typeof name === 'string' ? name.replace(/\p{Cc}/gu, '').trim() : '';
  const local = email.split('@')[0] || 'user';
  const base = cleaned || local;
  const sliced = Array.from(base).slice(0, NAME_MAX_LENGTH).join('');
  return sliced || 'user';
}

/**
 * 서명 검증이 끝난 ID 토큰 payload에서 WorkBridge가 필요한 값만 꺼낸다.
 * Google Access Token·ID Token 원문은 반환하지 않는다.
 */
export function readGoogleIdentity(payload, expectedNonce) {
  if (!payload || typeof payload !== 'object') throw oauthFailed();
  if (!safeEqual(payload.nonce, expectedNonce)) throw oauthFailed();

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 255 || /[\s\p{Cc}]/u.test(sub)) throw oauthFailed();

  if (payload.email_verified !== true) {
    throw new HttpError(
      403,
      'OAUTH_EMAIL_UNVERIFIED',
      'Google 계정의 이메일이 인증되지 않아 로그인할 수 없습니다.',
    );
  }

  const email = normalizeEmail(payload.email);
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) throw oauthFailed();

  return {
    sub,
    email,
    emailVerified: true,
    name: googleDisplayName(payload.name, email),
  };
}

/**
 * 공식 라이브러리로 ID Token 서명·iss·aud·exp를 검사한다. 라이브러리 오류 문구에는
 * 토큰이 포함될 수 있으므로 외부에는 고정 메시지만 전달한다.
 */
export async function verifyGoogleIdToken(idToken, { audience, certs, nonce }) {
  const client = new OAuth2Client({ clientId: audience });
  let payload;
  try {
    const ticket = await client.verifySignedJwtWithCertsAsync(
      idToken,
      certs,
      audience,
      GOOGLE_ISSUERS,
    );
    payload = ticket.getPayload();
  } catch {
    throw oauthFailed();
  }
  return readGoogleIdentity(payload, nonce);
}

/**
 * Authorization Code + PKCE + nonce. 토큰 교환과 ID Token 검증은 google-auth-library가 수행한다.
 * @param {{ clientId: string, clientSecret: string, redirectUri: string }} config
 */
export function createGoogleOAuthClient(config) {
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });

  return {
    async createAuthorizationRequest() {
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const url = client.generateAuthUrl({
        access_type: 'online',
        scope: [...SCOPES],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        prompt: 'select_account',
        include_granted_scopes: false,
        response_type: 'code',
      });

      const parsed = new URL(url);
      if (parsed.origin !== GOOGLE_AUTH_ORIGIN || parsed.searchParams.has('client_secret')) {
        throw oauthFailed();
      }
      if (url.includes(config.clientSecret)) throw oauthFailed();
      return { url, state, nonce, codeVerifier };
    },

    /**
     * 인가 코드를 교환하고 ID Token만 검증한다. Google 토큰은 이 함수 밖으로 나가지 않는다.
     * WorkBridge Refresh Token으로 쓰지 않는다.
     */
    async exchangeCode({ code, codeVerifier, nonce }) {
      let idToken;
      try {
        const { tokens } = await client.getToken({ code, codeVerifier });
        idToken = tokens.id_token;
      } catch {
        throw oauthFailed();
      }
      if (typeof idToken !== 'string' || idToken.length === 0) throw oauthFailed();

      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken, audience: config.clientId });
        payload = ticket.getPayload();
      } catch {
        throw oauthFailed();
      }
      return readGoogleIdentity(payload, nonce);
    },
  };
}
