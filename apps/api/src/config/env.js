const DEFAULT_PORT = 4000;
const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535 (received "${value}")`);
  }
  return port;
}

function parseOrigins(value) {
  const raw = value === undefined || value === '' ? DEFAULT_CORS_ORIGIN : value;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? 'development',
    port: parsePort(env.API_PORT),
    corsOrigins: parseOrigins(env.CORS_ORIGIN),
  });
}
