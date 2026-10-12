// Prisma CLI 설정. Express와 같은 루트 .env를 읽고, 같은 검증 모듈(src/config/database.js)을 사용한다.
//   기본 대상: 개발 DB(DATABASE_URL) + shadow DB(SHADOW_DATABASE_URL)
//   WORKBRIDGE_DB_TARGET=test: 테스트 DB(TEST_DATABASE_URL), migrate deploy/status 전용
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';
import { DatabaseConfigError, getDatabaseConfig } from './src/config/database.js';

const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

const target = process.env.WORKBRIDGE_DB_TARGET ?? 'development';
if (target !== 'development' && target !== 'test') {
  throw new DatabaseConfigError('WORKBRIDGE_DB_TARGET must be "development" or "test"');
}

if (target === 'test') {
  const blocked = ['dev', 'reset', 'push'];
  if (process.argv.some((arg) => blocked.includes(arg))) {
    throw new DatabaseConfigError(
      'Only "prisma migrate deploy" / "migrate status" are allowed against the test database',
    );
  }
}

// generate·validate는 DB 없이도 동작해야 하므로 URL이 없으면 비워 둔다(값이 잘못된 경우는 오류).
const main = getDatabaseConfig(target, process.env, { optional: true });
const shadow =
  target === 'development' ? getDatabaseConfig('shadow', process.env, { optional: true }) : null;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    ...(main && { url: main.url }),
    ...(shadow && { shadowDatabaseUrl: shadow.url }),
  },
});
