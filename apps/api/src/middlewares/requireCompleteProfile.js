import { HttpError } from '../utils/httpError.js';
import { getMissingProfileFields, userMeInclude } from '../modules/users/userMe.js';

/**
 * 역할별 필수 프로필(D-05)이 필요한 API(프로젝트 등록·지원 등, "+프로필")의 공통 검사.
 * `authenticate` → `requireRole` 다음에 붙인다. 역할이 없으면 requireRole이 먼저 403 ROLE_REQUIRED를 준다.
 * 비어 있는 항목은 403 PROFILE_INCOMPLETE의 details.missingFields로 알려 화면이 프로필 입력으로 안내한다(A-13).
 */
export function createRequireCompleteProfile(prisma) {
  return async function requireCompleteProfile(req, _res, next) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        include: userMeInclude,
      });
      if (!user) {
        next(new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.'));
        return;
      }
      const missingFields = getMissingProfileFields(user);
      if (missingFields.length > 0) {
        next(
          new HttpError(403, 'PROFILE_INCOMPLETE', '프로필을 먼저 완성해 주세요.', {
            missingFields,
          }),
        );
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
