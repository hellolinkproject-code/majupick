import express from 'express';
import cors from 'cors';
import { loadPgConfig } from './config/pg.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

/**
 * @param {ReturnType<import('./config/env.js').loadConfig>} config
 * @param {{ prisma?: object, authConfig?: ReturnType<import('./config/auth.js').loadAuthConfig>, googleOAuth?: object | null, imageStorage?: object | null, aiConfig?: object | null, estimateProvider?: object | null, pgConfig?: object | null, pgClient?: object | null, paymentService?: object | null }} [deps]
 */
export function createApp(
  config,
  {
    prisma,
    authConfig,
    googleOAuth = null,
    imageStorage = null,
    aiConfig = null,
    estimateProvider = null,
    pgConfig: pgConfigArg,
    pgClient = null,
    paymentService = null,
  } = {},
) {
  const app = express();

  // 테스트·로컬에서 pgConfig를 생략하면 mock/Fake PG로 결제 API를 켠다. null을 넘기면 끈다.
  const pgConfig =
    pgConfigArg !== undefined
      ? pgConfigArg
      : prisma
        ? loadPgConfig({ PG_MODE: 'mock', TOSS_ENABLE_TEST_CALLS: 'false' })
        : null;

  app.disable('x-powered-by');
  // Render·Vercel 프록시 뒤에서 Secure 쿠키·클라이언트 IP가 맞게 잡히도록 한다.
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    '/api',
    createApiRouter({
      config,
      prisma,
      authConfig,
      googleOAuth,
      imageStorage,
      aiConfig,
      estimateProvider,
      pgConfig,
      pgClient,
      paymentService,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
