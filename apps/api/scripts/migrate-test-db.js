// 테스트 DB(TEST_DATABASE_URL)에 기존 마이그레이션을 적용한다(prisma migrate deploy).
// 개발 DB와 같은 마이그레이션 파일을 쓰지만 별도로 적용하며, 초기화(reset)는 하지 않는다.
//   npm run db:migrate:test -w apps/api           → migrate deploy
//   npm run db:migrate:test -w apps/api -- status → migrate status
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeDatabase, getDatabaseConfig } from '../src/config/database.js';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const rootEnvPath = path.join(apiDir, '..', '..', '.env');
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

const subcommand = process.argv[2] ?? 'deploy';
if (subcommand !== 'deploy' && subcommand !== 'status') {
  console.error('[db:migrate:test] only "deploy" or "status" is allowed');
  process.exit(1);
}

const testDb = getDatabaseConfig('test');
console.log(`[db:migrate:test] target: ${describeDatabase(testDb)} (migrate ${subcommand})`);

const require = createRequire(import.meta.url);
const prismaPkgPath = require.resolve('prisma/package.json');
const prismaBin = path.join(path.dirname(prismaPkgPath), require(prismaPkgPath).bin.prisma);

const result = spawnSync(process.execPath, [prismaBin, 'migrate', subcommand], {
  cwd: apiDir,
  stdio: 'inherit',
  env: { ...process.env, WORKBRIDGE_DB_TARGET: 'test' },
});
process.exit(result.status ?? 1);
