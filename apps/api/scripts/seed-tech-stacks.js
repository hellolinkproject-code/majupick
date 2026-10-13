// 기술 스택 기본 옵션(A-12) 시드. 여러 번 실행해도 결과가 같고, 기존 행은 바꾸거나 지우지 않는다.
//   npm run db:seed:tech-stacks -w apps/api          (개발 DB)
//   npm run db:seed:tech-stacks -w apps/api -- --test (테스트 DB)
import {
  DatabaseConfigError,
  describeDatabase,
  getDatabaseConfig,
} from '../src/config/database.js';
import { createPrismaClient } from '../src/db/client.js';
import { DEFAULT_TECH_STACKS, seedTechStacks } from '../src/modules/techStacks/techStack.js';

const target = process.argv.includes('--test') ? 'test' : 'development';

let info;
try {
  info = getDatabaseConfig(target);
} catch (error) {
  if (!(error instanceof DatabaseConfigError)) throw error;
  console.error(`[seed] configuration error: ${error.message}`);
  process.exit(1);
}

const prisma = createPrismaClient({ target });
try {
  const added = await seedTechStacks(prisma);
  const total = await prisma.techStack.count({ where: { isCustom: false } });
  console.log(`[seed] database: ${describeDatabase(info)}`);
  console.log(
    `[seed] tech stacks: ${added} added, ${DEFAULT_TECH_STACKS.length - added} already present, ${total} default options in total`,
  );
} finally {
  await prisma.$disconnect();
}
