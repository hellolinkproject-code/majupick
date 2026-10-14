import { verifyAccessToken } from '../modules/auth/tokens.js';
import { HttpError } from '../utils/httpError.js';

/** `Authorization: Bearer <accessToken>`을 검증하고 req.auth = { userId }를 채운다. */
export function createAuthenticate(authConfig) {
  return function authenticate(req, _res, next) {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.'));
    }
    req.auth = { userId: verifyAccessToken(token, authConfig) };
    return next();
  };
}

/**
 * 공개 API용. 헤더가 없으면 비로그인(req.auth = null)으로 진행하고, 헤더가 있으면 authenticate와 같이 검증한다.
 * 만료 토큰을 비로그인으로 넘기지 않아야 FE가 재발급 후 다시 요청해 소유자 화면을 받는다.
 */
export function createOptionalAuthenticate(authConfig) {
  const authenticate = createAuthenticate(authConfig);
  return function optionalAuthenticate(req, res, next) {
    if (!req.get('authorization')) {
      req.auth = null;
      return next();
    }
    return authenticate(req, res, next);
  };
}
