import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireCompleteProfile } from '../../middlewares/requireCompleteProfile.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { parseProjectId } from '../projects/project.validation.js';
import { createApplicationService } from './application.service.js';
import { parseApplicationId, parseApplicationListQuery } from './application.validation.js';

function onlyRole(role, message) {
  return (req, _res, next) => {
    if (req.auth.role === role) next();
    else next(new HttpError(403, 'FORBIDDEN', message));
  };
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * APP-01(`POST /projects/:projectId/applications`), APP-02(`GET /projects/:projectId/applications`),
 * APP-03(`GET /applications/:applicationId`), APP-04(`GET /me/applications`),
 * DEC-01(`POST /applications/:applicationId/accept`), DEC-02(`POST /applications/:applicationId/reject`).
 * `/api` 바로 아래에 붙인다.
 * 지원 확인 순서(D-78 + D-91): 로그인(401) → 역할 선택(ROLE_REQUIRED) → 프리랜서(FORBIDDEN)
 * → 필수 프로필(PROFILE_INCOMPLETE) → 프로젝트 존재(404) → 실제 모집 상태(409) → 중복(409) → 입력(400).
 * 선정·거절 확인 순서(D-95): 로그인(401) → 역할 선택 → 의뢰인(FORBIDDEN) → 소유자(404) → 프로젝트 유효(404)
 * → 선정 가능 상태(409) → 프로젝트 소속(404) → PENDING(409) → (선정) 기존 선정 없음(409) → 본문(400).
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
    onlyRole('FREELANCER', '프리랜서 계정만 프로젝트에 지원할 수 있습니다.'),
    requireCompleteProfile,
    async (req, res) => {
      const projectId = parseProjectId(req.params.projectId);
      const application = await service.apply(req.auth.userId, projectId, req.body);
      res.status(201).json({ data: application });
    },
  );

  router.get(
    '/projects/:projectId/applications',
    noStore,
    authenticate,
    requireRole,
    onlyRole('CLIENT', '프로젝트를 등록한 의뢰인만 지원자를 볼 수 있습니다.'),
    async (req, res) => {
      const projectId = parseProjectId(req.params.projectId);
      const query = parseApplicationListQuery(req.query);
      res.json(await service.listForOwner(req.auth.userId, projectId, query));
    },
  );

  router.get(
    '/me/applications',
    noStore,
    authenticate,
    requireRole,
    onlyRole('FREELANCER', '프리랜서 계정만 지원 현황을 볼 수 있습니다.'),
    async (req, res) => {
      res.json(await service.listMine(req.auth.userId, parseApplicationListQuery(req.query)));
    },
  );

  router.get(
    '/applications/:applicationId',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      res.json({ data: await service.getForViewer(req.auth.userId, applicationId) });
    },
  );

  router.post(
    '/applications/:applicationId/accept',
    noStore,
    authenticate,
    requireRole,
    onlyRole('CLIENT', '프로젝트를 등록한 의뢰인만 지원자를 선정할 수 있습니다.'),
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      res.json({ data: await service.accept(req.auth.userId, applicationId, req.body) });
    },
  );

  router.post(
    '/applications/:applicationId/reject',
    noStore,
    authenticate,
    requireRole,
    onlyRole('CLIENT', '프로젝트를 등록한 의뢰인만 지원을 거절할 수 있습니다.'),
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      res.json({ data: await service.reject(req.auth.userId, applicationId, req.body) });
    },
  );

  return router;
}
