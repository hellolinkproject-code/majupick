// DB 연결 정보 검증. Express 서버, Prisma CLI(prisma.config.js), DB 테스트가 모두 이 모듈을 거친다.
// 오류 메시지에는 비밀번호가 들어간 URL 원문을 넣지 않는다.

export const DATABASE_TARGETS = Object.freeze({
  development: { key: 'DATABASE_URL', suffix: null },
  test: { key: 'TEST_DATABASE_URL', suffix: '_test' },
  shadow: { key: 'SHADOW_DATABASE_URL', suffix: '_shadow' },
});

const RESERVED_SUFFIXES = ['_test', '_shadow'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class DatabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

function isTestRuntime(env) {
  return env.NODE_ENV === 'test' || Boolean(env.VITEST);
}

function parseDatabaseUrl(target, env) {
  const { key, suffix } = DATABASE_TARGETS[target];
  const raw = env[key];
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseConfigError(`${key} is not a valid URL`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new DatabaseConfigError(`${key} must use the postgresql:// protocol`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new DatabaseConfigError(`${key} must include a database name`);

  if (!LOCAL_HOSTS.has(url.hostname) && env.ALLOW_REMOTE_DATABASE !== 'true') {
    throw new DatabaseConfigError(
      `${key} points to a non-local host (${url.hostname}). Set ALLOW_REMOTE_DATABASE=true only if this is intended.`,
    );
  }

  if (suffix && !database.endsWith(suffix)) {
    throw new DatabaseConfigError(
      `${key} database name must end with "${suffix}" (got "${database}")`,
    );
  }
  if (!suffix && RESERVED_SUFFIXES.some((reserved) => database.endsWith(reserved))) {
    throw new DatabaseConfigError(
      `${key} must not point to a test or shadow database ("${database}")`,
    );
  }

  return {
    target,
    key,
    url: raw,
    host: url.hostname,
    port: url.port || '5432',
    database,
  };
}

function assertDistinct(parsed) {
  const seen = new Map();
  for (const info of parsed) {
    const identity = `${info.host}:${info.port}/${info.database}`;
    const other = seen.get(identity);
    if (other) {
      throw new DatabaseConfigError(
        `${other.key} and ${info.key} must point to different databases`,
      );
    }
    seen.set(identity, info);
  }
}

/**
 * 대상 DB의 연결 정보를 검증해 돌려준다. 설정된 다른 DB URL과 겹치는지도 함께 확인한다.
 * @param {'development' | 'test' | 'shadow'} target
 * @param {Record<string, string | undefined>} [env]
 * @param {{ optional?: boolean }} [options] optional이면 값이 없을 때 null을 돌려준다.
 */
export function getDatabaseConfig(target, env = process.env, { optional = false } = {}) {
  if (!DATABASE_TARGETS[target])
    throw new DatabaseConfigError(`Unknown database target "${target}"`);

  // 테스트 런타임에서는 개발 DB 연결을 막는다. Prisma generate/validate처럼
  // optional이면 URL을 쓰지 않으므로 null을 돌려 설정 로딩만 허용한다(연결·migrate 아님).
  if (target === 'development' && isTestRuntime(env)) {
    if (optional) return null;
    throw new DatabaseConfigError(
      'Tests must not use DATABASE_URL (development). Use TEST_DATABASE_URL instead.',
    );
  }

  const parsed = Object.keys(DATABASE_TARGETS)
    .map((name) => parseDatabaseUrl(name, env))
    .filter(Boolean);
  assertDistinct(parsed);

  const info = parsed.find((item) => item.target === target) ?? null;
  if (!info && !optional) {
    throw new DatabaseConfigError(
      `${DATABASE_TARGETS[target].key} is not set. Run apps/api/scripts/setup-local-db.ps1 or copy .env.example to .env.`,
    );
  }
  return info;
}

/** 로그용 표시 문자열(계정·비밀번호 제외). */
export function describeDatabase(info) {
  return `${info.database}@${info.host}:${info.port}`;
}
