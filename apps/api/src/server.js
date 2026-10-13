import { createApp } from './app.js';
import { AuthConfigError, loadAuthConfig } from './config/auth.js';
import { DatabaseConfigError, describeDatabase, getDatabaseConfig } from './config/database.js';
import { loadConfig } from './config/env.js';
import { loadGoogleOAuthConfig } from './config/google.js';
import { createPrismaClient } from './db/client.js';
import { createGoogleOAuthClient } from './modules/auth/googleOAuth.js';

const config = loadConfig();

let database;
let authConfig;
let googleConfig;
try {
  database = getDatabaseConfig('development');
  authConfig = loadAuthConfig();
  googleConfig = loadGoogleOAuthConfig(process.env, { corsOrigins: config.corsOrigins });
} catch (error) {
  if (!(error instanceof DatabaseConfigError) && !(error instanceof AuthConfigError)) throw error;
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

const prisma = createPrismaClient({ target: 'development' });
const googleOAuth = googleConfig.enabled ? createGoogleOAuthClient(googleConfig) : null;
const app = createApp(config, { prisma, authConfig, googleOAuth });

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[api] database: ${describeDatabase(database)}`);
});

function shutdown(signal) {
  console.log(`[api] ${signal} received, closing server`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
