import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';

/** DB(prisma)·인증 설정이 없으면 health만 연결한다(DB 없는 단위 테스트용). */
export function createApiRouter({ config, prisma, authConfig } = {}) {
  const apiRouter = Router();

  apiRouter.use('/health', healthRouter);
  if (prisma && authConfig) {
    apiRouter.use('/auth', createAuthRouter({ prisma, config, authConfig }));
  }

  return apiRouter;
}
