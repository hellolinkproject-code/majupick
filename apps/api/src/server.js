import { createApp } from './app.js';
import { AiConfigError, loadAiConfig } from './config/ai.js';
import { AuthConfigError, loadAuthConfig } from './config/auth.js';
import { DatabaseConfigError, describeDatabase, getDatabaseConfig } from './config/database.js';
import { loadConfig } from './config/env.js';
import { loadGoogleOAuthConfig } from './config/google.js';
import { loadUploadConfig } from './config/uploads.js';
import { createPrismaClient } from './db/client.js';
import {
  JobConfigError,
  parseRecruitSyncInterval,
  startRecruitStatusScheduler,
} from './jobs/recruitStatusScheduler.js';
import { createEstimateProvider } from './modules/ai/providers/index.js';
import { createGoogleOAuthClient } from './modules/auth/googleOAuth.js';
import { runRecruitStatusSync } from './modules/projects/projectClosure.js';
import { createLocalImageStorage } from './modules/uploads/imageStorage.js';

const config = loadConfig();

let database;
let authConfig;
let googleConfig;
let aiConfig;
let recruitSyncIntervalMs;
try {
  database = getDatabaseConfig('development');
  authConfig = loadAuthConfig();
  googleConfig = loadGoogleOAuthConfig(process.env, { corsOrigins: config.corsOrigins });
  aiConfig = loadAiConfig();
  recruitSyncIntervalMs = parseRecruitSyncInterval(process.env.RECRUIT_SYNC_INTERVAL_MS);
} catch (error) {
  if (
    !(error instanceof DatabaseConfigError) &&
    !(error instanceof AuthConfigError) &&
    !(error instanceof AiConfigError) &&
    !(error instanceof JobConfigError)
  ) {
    throw error;
  }
  console.error(`[api] configuration error: ${error.message}`);
  process.exit(1);
}

if (authConfig.ephemeralSecret) {
  console.warn(
    '[api] JWT_ACCESS_SECRET is not set: using a temporary secret. Access tokens become invalid on restart (refresh still works).',
  );
}

if (!googleConfig.enabled) {
  console.warn(
    '[api] Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to enable it.',
  );
}

if (config.nodeEnv === 'production') {
  console.warn(
    '[api] Profile images use local disk storage. Files are lost when the host disk is not persistent (see D-29).',
  );
}

if (aiConfig.mode !== 'mock') {
  console.warn(
    `[api] AI_ESTIMATE_MODE=${aiConfig.mode}: OpenAI provider is a stub in STEP 08-A (no external calls). Use mock for estimation.`,
  );
}

const prisma = createPrismaClient({ target: 'development' });
const googleOAuth = googleConfig.enabled ? createGoogleOAuthClient(googleConfig) : null;
const imageStorage = createLocalImageStorage(loadUploadConfig());
const estimateProvider = createEstimateProvider(aiConfig);
const app = createApp(config, {
  prisma,
  authConfig,
  googleOAuth,
  imageStorage,
  aiConfig,
  estimateProvider,
});

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[api] database: ${describeDatabase(database)}`);
  console.log(`[api] AI estimate mode: ${aiConfig.mode}`);
});

const recruitSync =
  recruitSyncIntervalMs > 0
    ? startRecruitStatusScheduler({
        run: () => runRecruitStatusSync({ prisma }),
        intervalMs: recruitSyncIntervalMs,
      })
    : null;
console.log(
  recruitSync
    ? `[api] recruit status sync: on startup and every ${recruitSyncIntervalMs / 1000}s`
    : '[api] recruit status sync: disabled (RECRUIT_SYNC_INTERVAL_MS=0). Run job:sync-project-status externally.',
);

function shutdown(signal) {
  console.log(`[api] ${signal} received, closing server`);
  server.close(async () => {
    await recruitSync?.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
