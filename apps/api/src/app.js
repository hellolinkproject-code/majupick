import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

export function createApp(config) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
