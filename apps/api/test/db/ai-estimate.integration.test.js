// AI 단가 분석(AI-01) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// mock provider만 사용하며 외부 네트워크·OpenAI를 호출하지 않는다.
// 이번 실행에서 만든 사용자(runId 이메일)·기술 스택만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAiConfig } from '../../src/config/ai.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';

const ORIGIN = 'http://localhost:5173';
const runId = `ai${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});
const aiConfig = loadAiConfig({
  AI_ESTIMATE_MODE: 'mock',
  AI_ESTIMATE_RATE_LIMIT_MAX: '3',
  AI_ESTIMATE_RATE_LIMIT_WINDOW_MINUTES: '60',
});

let prisma;
let app;
const users = {};
let stack;

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });
const analyze = (user, body) => {
  const req = request(app).post('/api/ai/price-analyses').send(body);
  return user ? req.set(bearer(user)) : req;
};

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `AI${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig, aiConfig });
  stack = await prisma.techStack.create({
    data: { name: `AI Stack ${runId}`, normalizedName: `aistack${runId}` },
  });

  users.client = await signup('client', 'CLIENT');
  const profile = await request(app)
    .put('/api/users/me/client-profile')
    .set(bearer(users.client))
    .send({ companyName: 'AI테스트', businessField: 'IT' });
  expect(profile.status).toBe(200);

  users.freelancer = await signup('freelancer', 'FREELANCER');
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', passwordHash: null, role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
  await prisma.refreshToken.deleteMany({ where: { user: runUsers } });
  await prisma.clientProfile.deleteMany({ where: { user: runUsers } });
  await prisma.freelancerProfile.deleteMany({ where: { user: runUsers } });
  await prisma.user.deleteMany({ where: runUsers });
  if (stack) await prisma.techStack.deleteMany({ where: { id: stack.id } });
  await prisma.$disconnect();
});

describe('AI-01 price analysis', () => {
  it('returns a structured mock report for a client and recomputes the total', async () => {
    const res = await analyze(users.client, {
      title: '반응형 쇼핑몰',
      description: '상품·주문·결제 흐름',
      category: 'WEB',
      techStackIds: [stack.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.isMock).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
    for (const item of res.body.data.items) {
      expect(item).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          estimatedAmount: expect.stringMatching(/^\d+$/),
          rationale: expect.any(String),
        }),
      );
    }
    const sum = res.body.data.items.reduce((acc, item) => acc + BigInt(item.estimatedAmount), 0n);
    expect(res.body.data.totalAmount).toBe(sum.toString());
  });

  it('rejects guests, freelancers, and users without a role', async () => {
    const body = { title: 't', description: '충분히 긴 설명입니다' };
    expect((await analyze(null, body)).status).toBe(401);
    expect((await analyze(users.freelancer, body)).body.error.code).toBe('FORBIDDEN');
    expect((await analyze(users.noRole, body)).body.error.code).toBe('ROLE_REQUIRED');
  });

  it('validates the body', async () => {
    const res = await analyze(users.client, { title: '', description: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rate-limits repeated requests for the same client', async () => {
    const body = {
      title: `한도 테스트 ${runId}`,
      description: '호출 제한 확인용',
      category: 'ETC',
    };
    // beforeAll·이전 케이스에서 이미 호출했을 수 있으므로, 새 클라이언트로 한도를 본다.
    const limited = await signup('limited', 'CLIENT');
    await request(app)
      .put('/api/users/me/client-profile')
      .set(bearer(limited))
      .send({ companyName: '한도', businessField: 'IT' });

    expect((await analyze(limited, body)).status).toBe(200);
    expect((await analyze(limited, body)).status).toBe(200);
    expect((await analyze(limited, body)).status).toBe(200);
    const blocked = await analyze(limited, body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
