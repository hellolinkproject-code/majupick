import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { createProfileService } from './profile.service.js';
import {
  validateClientProfile,
  validateFreelancerProfile,
  validateUserUpdate,
} from './profile.validation.js';

function onlyRole(role, label) {
  return (req, _res, next) => {
    if (req.auth.role === role) next();
    else next(new HttpError(403, 'FORBIDDEN', `${label} 계정만 이 프로필을 저장할 수 있습니다.`));
  };
}

/**
 * PROF-01~03. 내 프로필 조회는 AUTH-05(`GET /auth/me`)를 쓴다.
 * 역할이 없는 사용자는 requireRole이 403 ROLE_REQUIRED로 막는다.
 */
export function createUsersRouter({ prisma, authConfig, imageStorage = null }) {
  const router = Router();
  const service = createProfileService({ prisma, imageStorage });
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.patch('/me', authenticate, requireRole, async (req, res) => {
    res.json({ data: await service.updateMe(req.auth.userId, validateUserUpdate(req.body)) });
  });

  router.put(
    '/me/client-profile',
    authenticate,
    requireRole,
    onlyRole('CLIENT', '의뢰인'),
    async (req, res) => {
      const profile = validateClientProfile(req.body);
      res.json({ data: await service.saveClientProfile(req.auth.userId, profile) });
    },
  );

  router.put(
    '/me/freelancer-profile',
    authenticate,
    requireRole,
    onlyRole('FREELANCER', '프리랜서'),
    async (req, res) => {
      const profile = validateFreelancerProfile(req.body);
      res.json({ data: await service.saveFreelancerProfile(req.auth.userId, profile) });
    },
  );

  return router;
}
