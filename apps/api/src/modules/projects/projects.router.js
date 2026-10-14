import { Router } from 'express';
import { createAuthenticate, createOptionalAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireCompleteProfile } from '../../middlewares/requireCompleteProfile.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { createProjectService } from './project.service.js';
import {
  parseIdempotencyKey,
  parsePage,
  parseProjectId,
  validateProjectCreate,
  validateProjectUpdate,
} from './project.validation.js';
import { todayKst } from './projectStatus.js';

function onlyClient(action) {
  return (req, _res, next) => {
    if (req.auth.role === 'CLIENT') next();
    else next(new HttpError(403, 'FORBIDDEN', `의뢰인 계정만 프로젝트를 ${action}할 수 있습니다.`));
  };
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function createGuards(prisma, authConfig) {
  return {
    authenticate: createAuthenticate(authConfig),
    optionalAuthenticate: createOptionalAuthenticate(authConfig),
    requireRole: createRequireRole(prisma),
    requireCompleteProfile: createRequireCompleteProfile(prisma),
  };
}

/**
 * PRJ-01~04. 등록 확인 순서: 로그인(401) → 역할 선택(ROLE_REQUIRED) → 의뢰인(FORBIDDEN)
 * → 필수 프로필(PROFILE_INCOMPLETE) → 입력 검사(400). 상세는 공개이며 소유자에게만 내부 상태를 준다.
 */
export function createProjectsRouter({ prisma, authConfig, projectService }) {
  const router = Router();
  const service = projectService ?? createProjectService({ prisma });
  const guard = createGuards(prisma, authConfig);

  router.use(noStore);

  router.post(
    '/',
    guard.authenticate,
    guard.requireRole,
    onlyClient('등록'),
    guard.requireCompleteProfile,
    async (req, res) => {
      const idempotencyKey = parseIdempotencyKey(req.get('idempotency-key'));
      const input = validateProjectCreate(req.body, todayKst());
      const { project, created } = await service.createProject(
        req.auth.userId,
        input,
        idempotencyKey,
      );
      res.status(created ? 201 : 200).json({ data: project });
    },
  );

  router.get('/:projectId', guard.optionalAuthenticate, async (req, res) => {
    const projectId = parseProjectId(req.params.projectId);
    res.json({ data: await service.getProject(projectId, req.auth?.userId ?? null) });
  });

  router.patch(
    '/:projectId',
    guard.authenticate,
    guard.requireRole,
    onlyClient('수정'),
    async (req, res) => {
      const projectId = parseProjectId(req.params.projectId);
      const changes = validateProjectUpdate(req.body);
      res.json({ data: await service.updateProject(req.auth.userId, projectId, changes) });
    },
  );

  router.delete(
    '/:projectId',
    guard.authenticate,
    guard.requireRole,
    onlyClient('삭제'),
    async (req, res) => {
      const projectId = parseProjectId(req.params.projectId);
      await service.deleteProject(req.auth.userId, projectId);
      res.status(204).end();
    },
  );

  return router;
}

/** PRJ-05 `GET /me/projects`. 의뢰인 본인의 프로젝트만(7개 상태 포함). */
export function createMyProjectsRouter({ prisma, authConfig, projectService }) {
  const router = Router();
  const service = projectService ?? createProjectService({ prisma });
  const guard = createGuards(prisma, authConfig);

  router.get(
    '/projects',
    noStore,
    guard.authenticate,
    guard.requireRole,
    onlyClient('조회'),
    async (req, res) => {
      const page = parsePage(req.query.page);
      res.json(await service.listMyProjects(req.auth.userId, page));
    },
  );

  return router;
}
