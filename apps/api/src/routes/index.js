import { Router } from 'express';
import { healthRouter } from './health.js';
import { metaRouter } from './meta.js';
import { createAiRouter } from '../modules/ai/ai.router.js';
import { createEstimateProvider } from '../modules/ai/providers/index.js';
import { createApplicationsRouter } from '../modules/applications/applications.router.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';
import { createBookmarksRouter } from '../modules/bookmarks/bookmarks.router.js';
import { createContractsRouter } from '../modules/contracts/contracts.router.js';
import { prismaContractPolicy } from '../modules/contracts/contractPolicy.js';
import { createNotificationsRouter } from '../modules/notifications/notifications.router.js';
import { createPgClient } from '../modules/payments/pgClient.js';
import { createPaymentService } from '../modules/payments/payment.service.js';
import { createPaymentsRouter } from '../modules/payments/payments.router.js';
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
 * AI 설정이 없으면 단가 분석 API를 연결하지 않는다.
 * PG 설정이 있으면 결제 API를 연결한다(기본 mock/Fake).
 */
export function createApiRouter({
  config,
  prisma,
  authConfig,
  googleOAuth = null,
  imageStorage = null,
  aiConfig = null,
  estimateProvider = null,
  pgConfig = null,
  pgClient = null,
  paymentService = null,
} = {}) {
  const apiRouter = Router();

  apiRouter.use('/health', healthRouter);
  apiRouter.use('/meta', metaRouter);
  if (prisma && authConfig) {
    apiRouter.use('/auth', createAuthRouter({ prisma, config, authConfig, googleOAuth }));
    apiRouter.use('/users', createUsersRouter({ prisma, authConfig, imageStorage }));
    apiRouter.use('/tech-stacks', createTechStacksRouter({ prisma, authConfig }));
    const projectService = createProjectService({ prisma, contractPolicy: prismaContractPolicy });
    apiRouter.use('/projects', createProjectsRouter({ prisma, authConfig, projectService }));
    apiRouter.use('/me', createMyProjectsRouter({ prisma, authConfig, projectService }));
    apiRouter.use(createApplicationsRouter({ prisma, authConfig }));
    apiRouter.use(createContractsRouter({ prisma, authConfig }));
    apiRouter.use(createBookmarksRouter({ prisma, authConfig }));
    apiRouter.use('/notifications', createNotificationsRouter({ prisma, authConfig }));
    if (pgConfig) {
      const client = pgClient ?? createPgClient(pgConfig);
      const payments =
        paymentService ?? createPaymentService({ prisma, pgClient: client, pgConfig });
      apiRouter.use(createPaymentsRouter({ prisma, authConfig, paymentService: payments }));
    }
    if (aiConfig) {
      const provider = estimateProvider ?? createEstimateProvider(aiConfig);
      apiRouter.use('/ai', createAiRouter({ prisma, authConfig, aiConfig, provider }));
    }
    if (imageStorage) {
      apiRouter.use('/uploads', createUploadsRouter({ prisma, authConfig, imageStorage }));
    }
  }

  return apiRouter;
}
