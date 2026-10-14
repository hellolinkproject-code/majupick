import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireCompleteProfile } from '../../middlewares/requireCompleteProfile.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { parseProjectId } from '../projects/project.validation.js';
import { createApplicationService } from './application.service.js';
import { parseApplicationId, parseMyApplicationsQuery } from './application.validation.js';

function onlyFreelancer(message) {
  return (req, _res, next) => {
    if (req.auth.role === 'FREELANCER') next();
    else next(new HttpError(403, 'FORBIDDEN', message));
  };
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * APP-01(`POST /projects/:projectId/applications`), APP-03(`GET /applications/:applicationId`),
 * APP-04(`GET /me/applications`). `/api` 바로 아래에 붙인다.
 * 지원 확인 순서(D-78 + D-91): 로그인(401) → 역할 선택(ROLE_REQUIRED) → 프리랜서(FORBIDDEN)
 * → 필수 프로필(PROFILE_INCOMPLETE) → 프로젝트 존재(404) → 실제 모집 상태(409) → 중복(409) → 입력(400).
 */
export function createApplicationsRouter({ prisma, authConfig, applicationService }) {
  const router = Router();
  const service = applicationService ?? createApplicationService({ prisma });
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);
  const requireCompleteProfile = createRequireCompleteProfile(prisma);

  router.post(
    '/projects/:projectId/applications',
    noStore,
    authenticate,
    requireRole,
    onlyFreelancer('프리랜서 계정만 프로젝트에 지원할 수 있습니다.'),
    requireCompleteProfile,
    async (req, res) => {
      const projectId = parseProjectId(req.params.projectId);
      const application = await service.apply(req.auth.userId, projectId, req.body);
      res.status(201).json({ data: application });
    },
  );

  router.get(
    '/me/applications',
    noStore,
    authenticate,
    requireRole,
    onlyFreelancer('프리랜서 계정만 지원 현황을 볼 수 있습니다.'),
    async (req, res) => {
      res.json(await service.listMine(req.auth.userId, parseMyApplicationsQuery(req.query)));
    },
  );

  router.get(
    '/applications/:applicationId',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      res.json({ data: await service.getMine(req.auth.userId, applicationId) });
    },
  );

  return router;
}
