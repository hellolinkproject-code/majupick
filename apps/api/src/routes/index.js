import { Router } from 'express';
import { healthRouter } from './health.js';
import { metaRouter } from './meta.js';
import { createApplicationsRouter } from '../modules/applications/applications.router.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';
import { createUsersRouter } from '../modules/profiles/users.router.js';
import {
  createMyProjectsRouter,
  createProjectsRouter,
} from '../modules/projects/projects.router.js';
import { createProjectService } from '../modules/projects/project.service.js';
import { createTechStacksRouter } from '../modules/techStacks/techStacks.router.js';
import { createUploadsRouter } from '../modules/uploads/uploads.router.js';

/**
 * DB(prisma)·인증 설정이 없으면 health·meta만 연결한다(DB 없는 단위 테스트용).
 * 이미지 저장소가 없으면 업로드 API를 연결하지 않는다.
 */
export function createApiRouter({
  config,
  prisma,
  authConfig,
  googleOAuth = null,
  imageStorage = null,
} = {}) {
  const apiRouter = Router();

  apiRouter.use('/health', healthRouter);
  apiRouter.use('/meta', metaRouter);
  if (prisma && authConfig) {
    apiRouter.use('/auth', createAuthRouter({ prisma, config, authConfig, googleOAuth }));
    apiRouter.use('/users', createUsersRouter({ prisma, authConfig, imageStorage }));
    apiRouter.use('/tech-stacks', createTechStacksRouter({ prisma, authConfig }));
    const projectService = createProjectService({ prisma });
    apiRouter.use('/projects', createProjectsRouter({ prisma, authConfig, projectService }));
    apiRouter.use('/me', createMyProjectsRouter({ prisma, authConfig, projectService }));
    apiRouter.use(createApplicationsRouter({ prisma, authConfig }));
    if (imageStorage) {
      apiRouter.use('/uploads', createUploadsRouter({ prisma, authConfig, imageStorage }));
    }
  }

  return apiRouter;
}
