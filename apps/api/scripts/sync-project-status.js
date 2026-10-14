// 모집 상태 동기화(자동 마감) 1회 실행. 외부 스케줄러(cron, Windows 작업 스케줄러, 배포 플랫폼의
// 예약 작업)에 연결하거나 API 서버 없이 수동으로 따라잡을 때 쓴다. 여러 번·동시에 실행해도 안전하다.
//   npm run job:sync-project-status -w apps/api               (개발 DB)
//   npm run job:sync-project-status -w apps/api -- --target=test
// 결과 요약을 JSON으로 출력하고, 실패한 프로젝트가 있으면 종료 코드 1을 돌려준다.
import {
  DatabaseConfigError,
  describeDatabase,
  getDatabaseConfig,
} from '../src/config/database.js';
import { createPrismaClient } from '../src/db/client.js';
import { runRecruitStatusSync } from '../src/modules/projects/projectClosure.js';

const TARGETS = new Set(['development', 'test']);
const arg = process.argv.find((value) => value.startsWith('--target='));
const target = arg ? arg.slice('--target='.length) : 'development';
if (!TARGETS.has(target)) {
  console.error(`[job] unknown target "${target}" (development | test)`);
  process.exit(2);
}

let info;
try {
  info = getDatabaseConfig(target);
} catch (error) {
  console.error(
    `[job] ${error instanceof DatabaseConfigError ? error.message : 'invalid configuration'}`,
  );
  process.exit(2);
}

const prisma = createPrismaClient({ target });
try {
  const startedAt = new Date();
  const summary = await runRecruitStatusSync({ prisma, now: startedAt });
  console.log(
    JSON.stringify({
      database: describeDatabase(info),
      ranAt: startedAt.toISOString(),
      ...summary,
    }),
  );
  process.exitCode = summary.failed.length > 0 ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
