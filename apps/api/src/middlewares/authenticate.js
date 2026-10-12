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
