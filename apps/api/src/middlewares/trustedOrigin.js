import { HttpError } from '../utils/httpError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 쿠키를 쓰는 인증 요청의 CSRF 방어(SameSite=Lax 보완).
 * 브라우저가 보낸 Origin이 허용 목록에 없으면 거부한다. Origin이 없는 요청(서버 간 호출, CLI)은
 * 브라우저 쿠키를 자동으로 싣지 않으므로 허용한다.
 */
export function createTrustedOriginGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return function trustedOrigin(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) {
      return next(new HttpError(403, 'FORBIDDEN', '허용되지 않은 출처의 요청입니다.'));
    }
    return next();
  };
}
