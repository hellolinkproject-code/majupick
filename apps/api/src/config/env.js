const DEFAULT_PORT = 4000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

function parsePort(value, label) {
  if (value === undefined || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535 (received "${value}")`);
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

function parseBoolean(value, label) {
  if (value === undefined || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} must be "true" or "false"`);
}

/**
 * 호스트 바인딩·포트·CORS·프록시 신뢰.
 * Render 등은 `PORT`를 주입하므로 `PORT`가 있으면 `API_PORT`보다 우선한다.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const portFromPlatform = parsePort(env.PORT, 'PORT');
  const portFromApi = parsePort(env.API_PORT, 'API_PORT');
  const port = portFromPlatform ?? portFromApi ?? DEFAULT_PORT;
  const host = (env.HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;

  const trustProxyExplicit = parseBoolean(env.TRUST_PROXY, 'TRUST_PROXY');
  const trustProxy = trustProxyExplicit ?? isProduction;

  return Object.freeze({
    nodeEnv,
    host,
    port,
    corsOrigins: parseOrigins(env.CORS_ORIGIN),
    trustProxy,
  });
}
