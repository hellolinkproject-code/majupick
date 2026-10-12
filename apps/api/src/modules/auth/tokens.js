import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { HttpError } from '../../utils/httpError.js';

const ISSUER = 'workbridge-api';
const AUDIENCE = 'workbridge-web';
const ALGORITHM = 'HS256';

/** Access Token(JWT). 역할은 바뀔 수 있으므로(AUTH-09) 넣지 않고 사용자 ID만 담는다. */
export function signAccessToken(userId, authConfig) {
  return jwt.sign({}, authConfig.accessTokenSecret, {
    algorithm: ALGORITHM,
    expiresIn: authConfig.accessTokenTtlSeconds,
    subject: String(userId),
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/** 서명·만료·발급자·대상을 검증하고 사용자 ID를 돌려준다. */
export function verifyAccessToken(token, authConfig) {
  let payload;
  try {
    payload = jwt.verify(token, authConfig.accessTokenSecret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, 'TOKEN_EXPIRED', '로그인이 만료되었습니다.');
    }
    throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  }

  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  }
  return userId;
}

/** Refresh Token 원문(쿠키로만 전달). 서버에는 hashRefreshToken 결과만 저장한다. */
export function generateRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
