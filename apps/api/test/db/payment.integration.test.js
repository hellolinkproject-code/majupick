// STEP 10-A 결제(Fake PG) 통합 테스트 — workbridge_test만 사용.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { loadConfig } from '../../src/config/env.js';
import { loadPgConfig } from '../../src/config/pg.js';
import { createPrismaClient } from '../../src/db/client.js';
import { createFakePgClient } from '../../src/modules/payments/pgClient.js';
import { createPaymentService } from '../../src/modules/payments/payment.service.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `p${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});
const pgConfig = loadPgConfig({ PG_MODE: 'mock', TOSS_ENABLE_TEST_CALLS: 'false' });

let prisma;
let app;
let stack;
let pgClient;
const users = {};
const today = todayKst();
const day = (offset) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `결제${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

async function completeFreelancer(user) {
  expect(
    (
      await request(app)
        .put('/api/users/me/freelancer-profile')
        .set(bearer(user))
        .send({
          mainCategory: 'WEB',
          techStackIds: [stack.id],
          careerYears: 2,
          hourlyRate: '40000',
        })
    ).status,
  ).toBe(200);
}

async function completeClient(user) {
  expect(
    (
      await request(app)
        .put('/api/users/me/client-profile')
        .set(bearer(user))
        .send({ companyName: '결제테스트', businessField: 'IT' })
    ).status,
  ).toBe(200);
}

async function createSignedContract(freelancer = users.fl1) {
  const project = await prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `결제 대상 ${runId}`,
      description: '결제 테스트',
      category: 'WEB',
      recruitStartDate: null,
      recruitEndDate: toDbDate(day(14)),
      budget: 5_000_000n,
      status: 'RECRUITING',
    },
  });
  const applied = await request(app)
    .post(`/api/projects/${project.id}/applications`)
    .set(bearer(freelancer))
    .send({
      coverLetter: `지원 ${freelancer.id}`,
      proposedAmount: '2500000',
      proposedDurationDays: 30,
    });
  expect(applied.status).toBe(201);
  expect(
    (
      await request(app)
        .post(`/api/applications/${applied.body.data.id}/accept`)
        .set(bearer(users.client))
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/applications/${applied.body.data.id}/offer`)
        .set(bearer(users.client))
        .send({ offerAmount: '3000000' })
    ).status,
  ).toBe(200);
  const agreed = await request(app)
    .post(`/api/applications/${applied.body.data.id}/offer/agree`)
    .set(bearer(freelancer));
  expect(agreed.status).toBe(201);
  const contractId = agreed.body.data.id;
  expect(
    (
      await request(app)
        .post(`/api/contracts/${contractId}/sign`)
        .set(bearer(users.client))
        .send({ agreed: true })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/contracts/${contractId}/sign`)
        .set(bearer(freelancer))
        .send({ agreed: true })
    ).status,
  ).toBe(200);
  return { projectId: project.id, contractId, amount: '3000000' };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  pgClient = createFakePgClient();
  const paymentService = createPaymentService({ prisma, pgClient, pgConfig });
  app = createApp(config, { prisma, authConfig, pgConfig, pgClient, paymentService });
  stack = await prisma.techStack.create({
    data: { name: `P stack ${runId}`, normalizedName: `pstack${runId}` },
  });
  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('other', 'CLIENT');
  users.fl1 = await signup('fl1', 'FREELANCER');
  await completeClient(users.client);
  await completeClient(users.otherClient);
  await completeFreelancer(users.fl1);
});

afterAll(async () => {
  if (!prisma) return;
  const userIds = Object.values(users)
    .filter(Boolean)
    .map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { OR: [{ payerId: { in: userIds } }, { contract: { clientId: { in: userIds } } }] },
    });
    await prisma.contract.deleteMany({
      where: { OR: [{ clientId: { in: userIds } }, { freelancerId: { in: userIds } }] },
    });
    await prisma.application.deleteMany({
      where: {
        OR: [{ freelancerId: { in: userIds } }, { project: { clientId: { in: userIds } } }],
      },
    });
    await prisma.project.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (stack) await prisma.techStack.deleteMany({ where: { id: stack.id } });
  await prisma.$disconnect();
});

describe('PAY sandbox payments (Fake PG)', () => {
  it('정상 주문 생성·승인·IN_PROGRESS·에스크로 HELD·계약 SIGNED 유지', async () => {
    const { projectId, contractId, amount } = await createSignedContract();
    const prepared = await request(app)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    expect(prepared.status).toBe(201);
    expect(prepared.body.data.amount).toBe(amount);
    expect(prepared.body.data.pg.mode).toBe('mock');

    const confirmed = await request(app)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send({
        paymentKey: `pk_${prepared.body.data.orderId}`,
        orderId: prepared.body.data.orderId,
        amount,
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.payment.status).toBe('PAID');
    expect(confirmed.body.data.payment.escrowStatus).toBe('HELD');
    expect(confirmed.body.data.payment.escrowNote).toMatch(/에스크로 보관 시뮬레이션/);

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(project.status).toBe('IN_PROGRESS');
    expect(contract.status).toBe('SIGNED');
  });

  it('비로그인·프리랜서·타인·서명 전·취소를 차단한다', async () => {
    const { contractId, projectId } = await createSignedContract();
    expect((await request(app).post(`/api/contracts/${contractId}/payments`)).status).toBe(401);
    expect(
      (await request(app).post(`/api/contracts/${contractId}/payments`).set(bearer(users.fl1)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/payments`)
          .set(bearer(users.otherClient))
      ).status,
    ).toBe(404);

    const pending = await createSignedContract();
    await prisma.contract.update({
      where: { id: pending.contractId },
      data: {
        status: 'SIGNATURE_PENDING',
        signedAt: null,
        freelancerSignedAt: null,
      },
    });
    expect(
      (
        await request(app)
          .post(`/api/contracts/${pending.contractId}/payments`)
          .set(bearer(users.client))
      ).status,
    ).toBe(409);

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect(
      (await request(app).post(`/api/contracts/${contractId}/payments`).set(bearer(users.client)))
        .status,
    ).toBe(409);
  });

  it('금액 조작을 막고 READY 주문을 재사용하며 동시 준비도 한 주문만 유지한다', async () => {
    const { contractId, amount } = await createSignedContract();
    const [a, b] = await Promise.all([
      request(app).post(`/api/contracts/${contractId}/payments`).set(bearer(users.client)),
      request(app).post(`/api/contracts/${contractId}/payments`).set(bearer(users.client)),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.orderId).toBe(b.body.data.orderId);
    const readyCount = await prisma.payment.count({
      where: { contractId, status: 'READY' },
    });
    expect(readyCount).toBe(1);

    const mismatch = await request(app)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send({
        paymentKey: 'pk_bad',
        orderId: a.body.data.orderId,
        amount: '1',
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');

    const again = await request(app)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    expect(again.status).toBe(201);
    expect(again.body.data.orderId).not.toBe(a.body.data.orderId);

    const ok = await request(app)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send({
        paymentKey: `pk_${again.body.data.orderId}`,
        orderId: again.body.data.orderId,
        amount,
      });
    expect(ok.status).toBe(200);

    const dup = await request(app)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    expect(dup.status).toBe(409);
  });

  it('동일 승인 재전송은 멱등이고 실패 시 CONTRACTING을 유지한다', async () => {
    const { projectId, contractId, amount } = await createSignedContract();
    const prepared = await request(app)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    const body = {
      paymentKey: `pk_${prepared.body.data.orderId}`,
      orderId: prepared.body.data.orderId,
      amount,
    };
    expect(
      (await request(app).post('/api/payments/confirm').set(bearer(users.client)).send(body))
        .status,
    ).toBe(200);
    const again = await request(app)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send(body);
    expect(again.status).toBe(200);
    expect(again.body.data.idempotent).toBe(true);

    const { projectId: p2, contractId: c2 } = await createSignedContract();
    const prep2 = await request(app)
      .post(`/api/contracts/${c2}/payments`)
      .set(bearer(users.client));
    expect(
      (
        await request(app)
          .post('/api/payments/fail')
          .set(bearer(users.client))
          .send({ orderId: prep2.body.data.orderId, code: 'PAY_PROCESS_CANCELED', message: '취소' })
      ).status,
    ).toBe(200);
    const project = await prisma.project.findUnique({ where: { id: p2 } });
    expect(project.status).toBe('CONTRACTING');
    expect(projectId).toBeTruthy();
  });

  it('결제 내역 권한과 서명 취소를 회귀한다', async () => {
    const { contractId, amount } = await createSignedContract();
    const prepared = await request(app)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    await request(app)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send({
        paymentKey: `pk_${prepared.body.data.orderId}`,
        orderId: prepared.body.data.orderId,
        amount,
      });

    const mine = await request(app).get('/api/me/payments').set(bearer(users.client));
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((row) => row.contractId === contractId)).toBe(true);

    const fl = await request(app).get('/api/me/payments').set(bearer(users.fl1));
    expect(fl.status).toBe(200);
    expect(fl.body.data.every((row) => row.status === 'PAID')).toBe(true);

    const other = await request(app)
      .get(`/api/payments/${prepared.body.data.paymentId}`)
      .set(bearer(users.otherClient));
    expect(other.status).toBe(404);

    const { projectId: openId, contractId: openContract } = await createSignedContract();
    expect(
      (
        await request(app)
          .post(`/api/contracts/${openContract}/sign`)
          .set(bearer(users.client))
          .send({ agreed: true })
      ).status,
    ).toBe(409);
    const cancel = await request(app)
      .post(`/api/projects/${openId}/cancel`)
      .set(bearer(users.client));
    // 이미 SIGNED면 취소 409
    expect(cancel.status).toBe(409);
  });

  it('PG 승인 후 DB 복구 경로와 NOT_DONE 거부를 처리한다', async () => {
    const rejectClient = createFakePgClient({ behavior: 'not_done' });
    const rejectService = createPaymentService({
      prisma,
      pgClient: rejectClient,
      pgConfig,
    });
    const rejectApp = createApp(config, {
      prisma,
      authConfig,
      pgConfig,
      pgClient: rejectClient,
      paymentService: rejectService,
    });
    const { contractId, amount } = await createSignedContract();
    const prepared = await request(rejectApp)
      .post(`/api/contracts/${contractId}/payments`)
      .set(bearer(users.client));
    const bad = await request(rejectApp)
      .post('/api/payments/confirm')
      .set(bearer(users.client))
      .send({
        paymentKey: `pk_${prepared.body.data.orderId}`,
        orderId: prepared.body.data.orderId,
        amount,
      });
    expect(bad.status).toBe(502);

    // recovery: seed PG approved then force FAILED row then recover via confirm path helper
    const { contractId: c3, amount: amt3 } = await createSignedContract();
    const prep3 = await request(app)
      .post(`/api/contracts/${c3}/payments`)
      .set(bearer(users.client));
    const paymentKey = `pk_recover_${prep3.body.data.orderId}`;
    pgClient.seedApproved({
      status: 'DONE',
      totalAmount: Number(amt3),
      orderId: prep3.body.data.orderId,
      paymentKey,
      method: '카드',
      currency: 'KRW',
      approvedAt: new Date().toISOString(),
    });
    await prisma.payment.update({
      where: { id: prep3.body.data.paymentId },
      data: { status: 'FAILED', failCode: 'DB', failReason: 'simulated' },
    });
    const service = createPaymentService({ prisma, pgClient, pgConfig });
    const recovered = await service.recoverPaidFromPg(
      users.client.id,
      paymentKey,
      prep3.body.data.orderId,
    );
    expect(recovered.payment.status).toBe('PAID');
  });
});
