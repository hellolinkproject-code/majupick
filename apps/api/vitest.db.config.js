import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 실제 PostgreSQL 통합 테스트(npm run test:db). TEST_DATABASE_URL(workbridge_test)만 사용한다.
// VITEST 환경에서는 src/config/database.js가 개발 DB(DATABASE_URL) 연결을 거부한다.
const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

export default defineConfig({
  test: {
    include: ['test/db/**/*.test.js'],
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
