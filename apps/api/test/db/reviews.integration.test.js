// STEP 11 상호 리뷰(REV-01~03, B-15~B-19) 통합 테스트 — workbridge_test만 사용.
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
const runId = `r${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
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
    .send({ name: `리뷰${name}`, email: email(name), password: PASSWORD, role });
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
        .send({ companyName: '리뷰테스트', businessField: 'IT' })
    ).status,
  ).toBe(200);
}

async function createPaidContract(amount = '3000000') {
  const project = await prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `리뷰 대상 ${runId}`,
      description: '리뷰 테스트',
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

async function completeDeal(amount = '3000000') {
  const paid = await createPaidContract(amount);
  expect(
    (
      await request(app)
        .post(`/api/contracts/${paid.contractId}/delivery`)
        .set(bearer(users.fl1))
        .send({ note: '납품 완료' })
    ).status,
  ).toBe(200);
  const approved = await request(app)
    .post(`/api/contracts/${paid.contractId}/approve`)
    .set(bearer(users.client));
  expect(approved.status).toBe(200);
  expect(approved.body.data.contract.status).toBe('COMPLETED');
  expect(approved.body.data.settlement.escrowStatus).toBe('RELEASED');
  return paid;
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const pgClient = createFakePgClient();
  const paymentService = createPaymentService({ prisma, pgClient, pgConfig });
  app = createApp(config, { prisma, authConfig, pgConfig, pgClient, paymentService });
  stack = await prisma.techStack.create({
    data: { name: `R stack ${runId}`, normalizedName: `rstack${runId}` },
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
    await prisma.review.deleteMany({
      where: {
        OR: [{ reviewerId: { in: userIds } }, { revieweeId: { in: userIds } }],
      },
    });
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

describe('REV mutual reviews', () => {
  it('의뢰인·프리랜서가 각각 1회 리뷰하고 공개 프로필 평균이 맞다', async () => {
    const { contractId, projectId } = await completeDeal();

    const before = await request(app).get(`/api/contracts/${contractId}`).set(bearer(users.client));
    expect(before.status).toBe(200);
    expect(before.body.data.availableActions).toEqual(['WRITE_REVIEW']);

    const clientReview = await request(app)
      .post(`/api/contracts/${contractId}/reviews`)
      .set(bearer(users.client))
      .send({
        rating: 5,
        content: '책임감 있게 잘 해주셨습니다.',
        tags: ['책임감', '기술력'],
      });
    expect(clientReview.status).toBe(201);
    expect(clientReview.body.data.reviewerId).toBe(users.client.id);
    expect(clientReview.body.data.revieweeId).toBe(users.fl1.id);
    expect(clientReview.body.data.rating).toBe(5);
    expect(clientReview.body.data.tags).toEqual(['책임감', '기술력']);

    const afterClient = await request(app)
      .get(`/api/contracts/${contractId}`)
      .set(bearer(users.client));
    expect(afterClient.body.data.availableActions).toEqual([]);
    expect(afterClient.body.data.hasWrittenReview).toBe(true);

    const flReview = await request(app)
      .post(`/api/contracts/${contractId}/reviews`)
      .set(bearer(users.fl1))
      .send({
        rating: 4,
        content: '요구사항이 명확했고 피드백이 빨랐습니다.',
        tags: ['명확한 요구사항', '신속한 피드백'],
      });
    expect(flReview.status).toBe(201);
    expect(flReview.body.data.reviewerId).toBe(users.fl1.id);
    expect(flReview.body.data.revieweeId).toBe(users.client.id);

    const status = await request(app)
      .get(`/api/contracts/${contractId}/reviews`)
      .set(bearer(users.client));
    expect(status.status).toBe(200);
    expect(status.body.data.myReview.rating).toBe(5);
    expect(status.body.data.counterpartReview.rating).toBe(4);

    const flPublic = await request(app).get(`/api/users/${users.fl1.id}`);
    expect(flPublic.status).toBe(200);
    expect(flPublic.body.data.ratingSummary).toEqual({ average: 5, count: 1 });
    expect(JSON.stringify(flPublic.body)).not.toMatch(/@workbridge\.test/);
    expect(JSON.stringify(flPublic.body)).not.toMatch(/3000000|feeAmount|payoutAmount/);

    const flReviews = await request(app).get(`/api/users/${users.fl1.id}/reviews`);
    expect(flReviews.status).toBe(200);
    expect(flReviews.body.summary).toEqual({ average: 5, count: 1 });
    expect(flReviews.body.data).toHaveLength(1);
    expect(flReviews.body.data[0].projectTitle).toContain('리뷰 대상');
    expect(flReviews.body.data[0].reviewerName).toBe('리뷰client');
    expect(flReviews.body.data[0]).not.toHaveProperty('email');

    const clientPublic = await request(app).get(`/api/users/${users.client.id}/reviews`);
    expect(clientPublic.body.summary).toEqual({ average: 4, count: 1 });

    const payment = await prisma.payment.findFirst({ where: { contractId, status: 'PAID' } });
    expect(payment.escrowStatus).toBe('RELEASED');
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('COMPLETED');
  }, 90_000);

  it('별점·태그·권한·미완료·중복·동시 작성을 막는다', async () => {
    const unpaid = await createPaidContract('2100000');
    expect(
      (
        await request(app)
          .post(`/api/contracts/${unpaid.contractId}/reviews`)
          .set(bearer(users.client))
          .send({ rating: 5, content: '아직', tags: ['책임감'] })
      ).status,
    ).toBe(409);

    await request(app)
      .post(`/api/contracts/${unpaid.contractId}/delivery`)
      .set(bearer(users.fl1))
      .send({ note: '납품' });
    expect(
      (
        await request(app)
          .post(`/api/contracts/${unpaid.contractId}/reviews`)
          .set(bearer(users.client))
          .send({ rating: 5, content: '정산 전', tags: ['책임감'] })
      ).status,
    ).toBe(409);

    const approved = await request(app)
      .post(`/api/contracts/${unpaid.contractId}/approve`)
      .set(bearer(users.client));
    expect(approved.status).toBe(200);
    const contractId = unpaid.contractId;

    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/reviews`)
          .send({ rating: 5, content: '비로그인', tags: ['책임감'] })
      ).status,
    ).toBe(401);

    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/reviews`)
          .set(bearer(users.fl2))
          .send({ rating: 5, content: '제3자', tags: ['책임감'] })
      ).status,
    ).toBe(404);

    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/reviews`)
          .set(bearer(users.client))
          .send({ rating: 0, content: '별점', tags: ['책임감'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/reviews`)
          .set(bearer(users.client))
          .send({ rating: 6, content: '별점', tags: ['책임감'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/contracts/${contractId}/reviews`)
          .set(bearer(users.client))
          .send({ rating: 5, content: '태그', tags: ['명확한 요구사항'] })
      ).status,
    ).toBe(400);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/contracts/${contractId}/reviews`)
        .set(bearer(users.client))
        .send({ rating: 1, content: '동시 A', tags: ['소통'] }),
      request(app)
        .post(`/api/contracts/${contractId}/reviews`)
        .set(bearer(users.client))
        .send({ rating: 5, content: '동시 B', tags: ['품질'] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.review.count({ where: { contractId, reviewerId: users.client.id } })).toBe(
      1,
    );

    const again = await request(app)
      .post(`/api/contracts/${contractId}/reviews`)
      .set(bearer(users.client))
      .send({ rating: 3, content: '재시도', tags: ['책임감'] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');

    expect(
      (
        await request(app)
          .patch(`/api/contracts/${contractId}/reviews/1`)
          .set(bearer(users.client))
          .send({ rating: 2 })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/contracts/${contractId}/reviews/1`)
          .set(bearer(users.client))
      ).status,
    ).toBe(404);

    const empty = await request(app).get(`/api/users/${users.fl2.id}/reviews`);
    expect(empty.status).toBe(200);
    expect(empty.body.summary).toEqual({ average: null, count: 0 });
    expect(empty.body.data).toEqual([]);
  }, 90_000);

  it('취소된 계약에는 리뷰를 쓸 수 없다', async () => {
    const { contractId } = await createPaidContract('1800000');
    await prisma.contract.update({
      where: { id: contractId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    const res = await request(app)
      .post(`/api/contracts/${contractId}/reviews`)
      .set(bearer(users.client))
      .send({ rating: 5, content: '취소', tags: ['책임감'] });
    expect(res.status).toBe(409);
  }, 60_000);

  it('양측이 동시에 서로 리뷰해도 각각 1건씩 저장된다', async () => {
    const { contractId } = await completeDeal('2500000');
    const [clientRes, flRes] = await Promise.all([
      request(app)
        .post(`/api/contracts/${contractId}/reviews`)
        .set(bearer(users.client))
        .send({ rating: 5, content: '동시 의뢰인', tags: ['책임감'] }),
      request(app)
        .post(`/api/contracts/${contractId}/reviews`)
        .set(bearer(users.fl1))
        .send({ rating: 4, content: '동시 프리', tags: ['신속한 피드백'] }),
    ]);
    expect([clientRes.status, flRes.status].sort()).toEqual([201, 201]);
    expect(await prisma.review.count({ where: { contractId } })).toBe(2);
  }, 90_000);
});
