import { createApp } from './app.js';
import { DatabaseConfigError, describeDatabase, getDatabaseConfig } from './config/database.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();

let database;
try {
  database = getDatabaseConfig('development');
} catch (error) {
  if (!(error instanceof DatabaseConfigError)) throw error;
  console.error(`[api] database configuration error: ${error.message}`);
  process.exit(1);
}

const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[api] database: ${describeDatabase(database)}`);
});

function shutdown(signal) {
  console.log(`[api] ${signal} received, closing server`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
