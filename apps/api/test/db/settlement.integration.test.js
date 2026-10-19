// STEP 10-B 납품·모의 에스크로 정산 통합 테스트 — workbridge_test만 사용.
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
const runId = `s${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
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
    .send({ name: `정산${name}`, email: email(name), password: PASSWORD, role });
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
        .send({ companyName: '정산테스트', businessField: 'IT' })
    ).status,
  ).toBe(200);
}

async function createPaidContract(amount = '3000000') {
  const project = await prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `정산 대상 ${runId}`,
      description: '정산 테스트',
      category: 'WEB',
      recruitStartDate: null,
      recruitEndDate: toDbDate(day(14)),
      budget: 5_000_000n,
      status: 'RECRUITING',
    },
  });
  const applied = await request(app)
    .post(`/api/projects/${project.id}/applications`)
    .set(bearer(users.fl1))
    .send({
      coverLetter: `지원 ${users.fl1.id}`,
      proposedAmount: amount,
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
        .send({ offerAmount: amount })
    ).status,
  ).toBe(200);
  const agreed = await request(app)
    .post(`/api/applications/${applied.body.data.id}/offer/agree`)
    .set(bearer(users.fl1));
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
        .set(bearer(users.fl1))
        .send({ agreed: true })
    ).status,
  ).toBe(200);

  const prepared = await request(app)
    .post(`/api/contracts/${contractId}/payments`)
    .set(bearer(users.client));
  expect(prepared.status).toBe(201);
  const confirmed = await request(app)
    .post('/api/payments/confirm')
    .set(bearer(users.client))
    .send({
      paymentKey: `pk_${prepared.body.data.orderId}`,
      orderId: prepared.body.data.orderId,
      amount,
    });
  expect(confirmed.status).toBe(200);
  return { projectId: project.id, contractId, amount };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const pgClient = createFakePgClient();
  const paymentService = createPaymentService({ prisma, pgClient, pgConfig });
  app = createApp(config, { prisma, authConfig, pgConfig, pgClient, paymentService });
  stack = await prisma.techStack.create({
    data: { name: `S stack ${runId}`, normalizedName: `sstack${runId}` },
  });
  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('other', 'CLIENT');
  users.fl1 = await signup('fl1', 'FREELANCER');
  users.fl2 = await signup('fl2', 'FREELANCER');
  await completeClient(users.client);
  await completeClient(users.otherClient);
  await completeFreelancer(users.fl1);
  await completeFreelancer(users.fl2);
}, 120_000);

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

describe('ESC delivery and mock escrow settlement', () => {
  it('납품 → 승인 → RELEASED·수수료 10%·프로젝트 COMPLETED', async () => {
    const { projectId, contractId, amount } = await createPaidContract();

    const detail = await request(app).get(`/api/contracts/${contractId}`).set(bearer(users.fl1));
    expect(detail.status).toBe(200);
    expect(detail.body.data.displayStatus).toBe('IN_PROGRESS');
    expect(detail.body.data.availableActions).toEqual(['REQUEST_DELIVERY']);

    const beforeApprove = await request(app)
      .post(`/api/contracts/${contractId}/approve`)
      .set(bearer(users.client));
    expect(beforeApprove.status).toBe(409);

    const delivered = await request(app)
      .post(`/api/contracts/${contractId}/delivery`)
      .set(bearer(users.fl1))
      .send({
        note: '최종 산출물을 전달합니다.',
        url: 'https://example.com/work.zip',
      });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe('DELIVERY_REQUESTED');
    expect(delivered.body.data.delivery.note).toBe('최종 산출물을 전달합니다.');

    const dupDelivery = await request(app)
      .post(`/api/contracts/${contractId}/delivery`)
      .set(bearer(users.fl1))
      .send({ note: '다시' });
    expect(dupDelivery.status).toBe(409);

    const preview = await request(app)
      .get(`/api/contracts/${contractId}/settlement`)
      .set(bearer(users.client));
    expect(preview.status).toBe(200);
    expect(preview.body.data.amount).toBe(amount);
    expect(preview.body.data.feeAmount).toBe('300000');
    expect(preview.body.data.payoutAmount).toBe('2700000');
    expect(preview.body.data.escrowStatus).toBe('HELD');

    const approved = await request(app)
      .post(`/api/contracts/${contractId}/approve`)
      .set(bearer(users.client));
    expect(approved.status).toBe(200);
    expect(approved.body.data.contract.status).toBe('COMPLETED');
    expect(approved.body.data.settlement.escrowStatus).toBe('RELEASED');
    expect(approved.body.data.settlement.feeAmount).toBe('300000');
    expect(approved.body.data.settlement.payoutAmount).toBe('2700000');

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    const payment = await prisma.payment.findFirst({
      where: { contractId, status: 'PAID' },
    });
    expect(project.status).toBe('COMPLETED');
    expect(contract.status).toBe('COMPLETED');
    expect(payment.escrowStatus).toBe('RELEASED');
    expect(payment.feeAmount + payment.payoutAmount).toBe(payment.amount);

    const dupApprove = await request(app)
      .post(`/api/contracts/${contractId}/approve`)
      .set(bearer(users.client));
    expect(dupApprove.status).toBe(409);

    const settled = await request(app)
      .get(`/api/contracts/${contractId}/settlement`)
      .set(bearer(users.fl1));
    expect(settled.status).toBe(200);
    expect(settled.body.data.escrowStatus).toBe('RELEASED');
  }, 60_000);

  it('권한·상태 오류와 동시 승인 경쟁을 막는다', async () => {
    const { contractId } = await createPaidContract('1500000');

    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/delivery`)
          .set(bearer(users.client))
          .send({ note: '의뢰인 시도' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/delivery`)
          .set(bearer(users.fl2))
          .send({ note: '타인 시도' })
      ).status,
    ).toBe(404);

    expect(
      (await request(app).post(`/api/contracts/${contractId}/delivery`).set(bearer(users.fl1)))
        .status,
    ).toBe(400);

    await request(app)
      .post(`/api/contracts/${contractId}/delivery`)
      .set(bearer(users.fl1))
      .send({ note: '납품 완료' });

    expect(
      (await request(app).post(`/api/contracts/${contractId}/approve`).set(bearer(users.fl1)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/approve`)
          .set(bearer(users.otherClient))
      ).status,
    ).toBe(404);

    const [a, b] = await Promise.all([
      request(app).post(`/api/contracts/${contractId}/approve`).set(bearer(users.client)),
      request(app).post(`/api/contracts/${contractId}/approve`).set(bearer(users.client)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const payment = await prisma.payment.findFirst({
      where: { contractId, status: 'PAID' },
    });
    expect(payment.escrowStatus).toBe('RELEASED');
    expect(payment.feeAmount).toBe(150_000n);
    expect(payment.payoutAmount).toBe(1_350_000n);
  }, 60_000);

  it('동시 납품 요청은 한 건만 성공한다', async () => {
    const { contractId } = await createPaidContract('999999');
    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/contracts/${contractId}/delivery`)
        .set(bearer(users.fl1))
        .send({ note: '동시 A' }),
      request(app)
        .post(`/api/contracts/${contractId}/delivery`)
        .set(bearer(users.fl1))
        .send({ note: '동시 B' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(contract.status).toBe('DELIVERY_REQUESTED');
    expect(contract.deliveryRequestedAt).not.toBeNull();
  }, 60_000);
});
