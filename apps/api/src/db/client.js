import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { getDatabaseConfig } from '../config/database.js';

/**
 * Prisma Client를 만든다. 대상 DB는 검증 모듈을 통과한 URL만 쓴다.
 * 클라이언트 코드는 `npm run db:generate`로 src/generated/prisma에 생성된다(Git 제외).
 * @param {{ target?: 'development' | 'test', env?: Record<string, string | undefined> }} [options]
 */
export function createPrismaClient({ target = 'development', env = process.env } = {}) {
  const { url } = getDatabaseConfig(target, env);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
