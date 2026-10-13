import express from 'express';
import cors from 'cors';
import { createApiRouter } from './routes/index.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

/**
 * @param {ReturnType<import('./config/env.js').loadConfig>} config
 * @param {{ prisma?: object, authConfig?: ReturnType<import('./config/auth.js').loadAuthConfig>, googleOAuth?: object | null, imageStorage?: object | null }} [deps]
 */
export function createApp(
  config,
  { prisma, authConfig, googleOAuth = null, imageStorage = null } = {},
) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', createApiRouter({ config, prisma, authConfig, googleOAuth, imageStorage }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
