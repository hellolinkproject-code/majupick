import { createApp } from './app.js';
import { AiConfigError, canMakeBillableCalls, loadAiConfig } from './config/ai.js';
import { AuthConfigError, loadAuthConfig } from './config/auth.js';
import { DatabaseConfigError, describeDatabase, getDatabaseConfig } from './config/database.js';
import { loadConfig } from './config/env.js';
import { loadGoogleOAuthConfig } from './config/google.js';
import { loadPgConfig, PgConfigError } from './config/pg.js';
import { loadUploadConfig, UploadConfigError } from './config/uploads.js';
import { createPrismaClient } from './db/client.js';
import {
  JobConfigError,
  parseRecruitSyncInterval,
  startRecruitStatusScheduler,
} from './jobs/recruitStatusScheduler.js';
import { createEstimateProvider } from './modules/ai/providers/index.js';
import { createGoogleOAuthClient } from './modules/auth/googleOAuth.js';
import { createPgClient } from './modules/payments/pgClient.js';
import { runRecruitStatusSync } from './modules/projects/projectClosure.js';
import { createImageStorage } from './modules/uploads/imageStorage.js';

const config = loadConfig();

let database;
let authConfig;
let googleConfig;
let aiConfig;
let pgConfig;
let uploadConfig;
let recruitSyncIntervalMs;
try {
  database = getDatabaseConfig('development');
  authConfig = loadAuthConfig();
  googleConfig = loadGoogleOAuthConfig(process.env, { corsOrigins: config.corsOrigins });
  aiConfig = loadAiConfig();
  pgConfig = loadPgConfig();
  uploadConfig = loadUploadConfig();
  recruitSyncIntervalMs = parseRecruitSyncInterval(process.env.RECRUIT_SYNC_INTERVAL_MS);
} catch (error) {
  if (
    !(error instanceof DatabaseConfigError) &&
    !(error instanceof AuthConfigError) &&
    !(error instanceof AiConfigError) &&
    !(error instanceof PgConfigError) &&
    !(error instanceof UploadConfigError) &&
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

if (aiConfig.mode === 'openai' && !canMakeBillableCalls(aiConfig)) {
  console.warn(
    '[api] AI_ESTIMATE_MODE=openai but billable calls are gated off (need AI_ENABLE_BILLABLE_CALLS=true, API key, pricing, monthly budget > 0). No external OpenAI requests will be made.',
  );
} else if (aiConfig.mode === 'openai' && canMakeBillableCalls(aiConfig)) {
  console.warn(
    '[api] AI billable OpenAI calls are ENABLED. Project text may be sent to OpenAI and incur cost.',
  );
}

if (pgConfig.mode === 'toss' && !pgConfig.usesLiveConfirm) {
  console.warn(
    '[api] PG_MODE=toss but TOSS_ENABLE_TEST_CALLS is false or keys missing for live confirm. Using Fake PG client (no Toss HTTP).',
  );
} else if (pgConfig.usesLiveConfirm) {
  console.warn(
    '[api] Toss Payments TEST confirm is ENABLED. Only test keys are allowed; not production charges.',
  );
}

const prisma = createPrismaClient({ target: 'development' });
const googleOAuth = googleConfig.enabled ? createGoogleOAuthClient(googleConfig) : null;
const imageStorage = createImageStorage(uploadConfig);
if (imageStorage.kind === 'local' && config.nodeEnv === 'production') {
  console.warn(
    '[api] STORAGE_DRIVER=local: profile images are on ephemeral disk and are lost on redeploy/sleep (see D-76, docs/DEPLOYMENT_PLAN.md).',
  );
}
const estimateProvider = createEstimateProvider(aiConfig);
const pgClient = createPgClient(pgConfig);
const app = createApp(config, {
  prisma,
  authConfig,
  googleOAuth,
  imageStorage,
  aiConfig,
  estimateProvider,
  pgConfig,
  pgClient,
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] listening on http://${config.host}:${config.port} (${config.nodeEnv})`);
  console.log(`[api] database: ${describeDatabase(database)}`);
  console.log(`[api] image storage: ${imageStorage.kind}`);
  console.log(`[api] AI estimate mode: ${aiConfig.mode}`);
  console.log(`[api] PG mode: ${pgConfig.mode} (sdk=${pgConfig.usesBrowserSdk})`);
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
