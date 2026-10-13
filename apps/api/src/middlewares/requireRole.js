import { HttpError } from '../utils/httpError.js';

/**
 * 역할이 필요한 API의 인가. 로그인은 되어 있지만 역할을 고르지 않았으면 403 ROLE_REQUIRED.
 * AUTH-04·AUTH-05·AUTH-09에는 붙이지 않는다.
 */
export function createRequireRole(prisma) {
  return async function requireRole(req, _res, next) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { role: true },
      });
      if (!user) {
        next(new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.'));
        return;
      }
      if (!user.role) {
        next(
          new HttpError(403, 'ROLE_REQUIRED', '의뢰인 또는 프리랜서 역할을 먼저 선택해 주세요.'),
        );
        return;
      }
      req.auth.role = user.role;
      next();
    } catch (error) {
      next(error);
    }
  };
}
