import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { getDatabaseConfig } from '../config/database.js';

/**
 * Prisma Client를 만든다. 대상 DB는 검증 모듈을 통과한 URL만 쓴다.
 * 명시적 pg.Pool로 연결 수를 제한하고, 종료 시 pool.end()까지 호출한다.
 * (watch 재시작·테스트 누적 시 기본 풀이 고갈되면 P2028 "Unable to start a transaction"이 난다.)
 * @param {{ target?: 'development' | 'test', env?: Record<string, string | undefined> }} [options]
 */
export function createPrismaClient({ target = 'development', env = process.env } = {}) {
  const { url } = getDatabaseConfig(target, env);
  const pool = new pg.Pool({
    connectionString: url,
    // 개발 서버 + 브라우저 + cron이 동시에 붙어도 여유를 두고, 테스트는 더 작게 잡는다.
    max: target === 'test' ? 8 : 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: target === 'test',
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    transactionOptions: {
      // 잠금 대기·풀 대기. 기본 2s는 Windows·동시 요청에서 P2028을 내기 쉽다.
      maxWait: 15_000,
      timeout: 30_000,
    },
  });

  const originalDisconnect = prisma.$disconnect.bind(prisma);
  prisma.$disconnect = async () => {
    await originalDisconnect();
    await pool.end().catch(() => {});
  };

  return prisma;
}
