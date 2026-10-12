import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

function shutdown(signal) {
  console.log(`[api] ${signal} received, closing server`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
