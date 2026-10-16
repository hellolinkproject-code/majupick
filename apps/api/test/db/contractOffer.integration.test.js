// STEP 09-A 합의 금액 제안·동의·거부·계약서 생성 통합 테스트(workbridge_test만 사용).
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `c${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

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
const apply = (user, projectId, amount = '2500000') =>
  request(app)
    .post(`/api/projects/${projectId}/applications`)
    .set(bearer(user))
    .send({ coverLetter: `지원 ${user.id}`, proposedAmount: amount, proposedDurationDays: 30 });
const accept = (user, id) => request(app).post(`/api/applications/${id}/accept`).set(bearer(user));
const propose = (user, id, offerAmount) =>
  request(app).post(`/api/applications/${id}/offer`).set(bearer(user)).send({ offerAmount });
const agree = (user, id) =>
  request(app).post(`/api/applications/${id}/offer/agree`).set(bearer(user));
const decline = (user, id) =>
  request(app).post(`/api/applications/${id}/offer/decline`).set(bearer(user));
const getContract = (user, id) => request(app).get(`/api/contracts/${id}`).set(bearer(user));

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `계약${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

async function completeFreelancer(user) {
  const res = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(user))
    .send({ mainCategory: 'WEB', techStackIds: [stack.id], careerYears: 2, hourlyRate: '40000' });
  expect(res.status).toBe(200);
}

async function completeClient(user) {
  const res = await request(app)
    .put('/api/users/me/client-profile')
    .set(bearer(user))
    .send({ companyName: '합의테스트', businessField: 'IT' });
  expect(res.status).toBe(200);
}

function insertProject(data = {}) {
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `계약 대상 ${runId}`,
      description: '계약 테스트용 프로젝트',
      category: 'WEB',
      recruitStartDate: null,
      recruitEndDate: toDbDate(day(14)),
      budget: 5_000_000n,
      status: 'RECRUITING',
      ...data,
    },
  });
}

/** 모집 중 프로젝트에 지원·선정까지 만든 뒤 applicationId·projectId를 돌려준다. */
async function selectOne(freelancer = users.fl1, amount = '2500000') {
  const project = await insertProject();
  const applied = await apply(freelancer, project.id, amount);
  expect(applied.status).toBe(201);
  const accepted = await accept(users.client, applied.body.data.id);
  expect(accepted.status).toBe(200);
  expect(accepted.body.data.application.status).toBe('ACCEPTED');
  return { projectId: project.id, applicationId: applied.body.data.id, freelancer };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `C stack ${runId}`, normalizedName: `cstack${runId}` },
  });
  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('other', 'CLIENT');
  users.fl1 = await signup('fl1', 'FREELANCER');
  users.fl2 = await signup('fl2', 'FREELANCER');
  await completeClient(users.client);
  await completeClient(users.otherClient);
  await completeFreelancer(users.fl1);
  await completeFreelancer(users.fl2);
});

afterAll(async () => {
  if (!prisma) return;
  const userIds = Object.values(users)
    .filter(Boolean)
    .map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.contract.deleteMany({
      where: { OR: [{ clientId: { in: userIds } }, { freelancerId: { in: userIds } }] },
    });
    await prisma.application.deleteMany({
      where: {
        OR: [{ freelancerId: { in: userIds } }, { project: { clientId: { in: userIds } } }],
      },
    });
    await prisma.project.deleteMany({ where: { clientId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.freelancerTechStack.deleteMany({
      where: { freelancerId: { in: userIds } },
    });
    await prisma.clientProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.freelancerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
  await prisma.$disconnect();
});

describe('STEP 09-A contract amount agreement', () => {
  it('의뢰인이 합의 금액을 제안하고 프리랜서가 확인한다', async () => {
    const { applicationId } = await selectOne();
    const big = '9007199254740993';
    const proposed = await propose(users.client, applicationId, big);
    expect(proposed.status).toBe(200);
    expect(proposed.body.data.offerAmount).toBe(big);
    expect(proposed.body.data.offerStatus).toBe('PENDING');
    expect(proposed.body.data.proposedAmount).toBe('2500000');

    const mine = await request(app).get('/api/me/applications').set(bearer(users.fl1));
    expect(mine.status).toBe(200);
    const row = mine.body.data.find((item) => item.id === applicationId);
    expect(row.offerAmount).toBe(big);
    expect(row.offerStatus).toBe('PENDING');
    expect(row.availableActions).toEqual(expect.arrayContaining(['AGREE_OFFER', 'DECLINE_OFFER']));
  });

  it('다른 의뢰인은 금액 제안을 할 수 없다', async () => {
    const { applicationId } = await selectOne();
    const res = await propose(users.otherClient, applicationId, '3000000');
    expect(res.status).toBe(404);
  });

  it('중복 금액 제안을 거부한다', async () => {
    const { applicationId } = await selectOne();
    expect((await propose(users.client, applicationId, '3000000')).status).toBe(200);
    const again = await propose(users.client, applicationId, '3100000');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('프리랜서 동의 시 계약서를 만들고 합의 금액이 일치한다', async () => {
    const { applicationId, projectId } = await selectOne(users.fl1, '2800000');
    expect((await propose(users.client, applicationId, '3200000')).status).toBe(200);
    const agreed = await agree(users.fl1, applicationId);
    expect(agreed.status).toBe(201);
    expect(agreed.body.data.agreedAmount).toBe('3200000');
    expect(agreed.body.data.projectId).toBe(projectId);
    expect(agreed.body.data.applicationId).toBe(applicationId);
    expect(agreed.body.data.status).toBe('SIGNATURE_PENDING');
    expect(agreed.body.data.signedAt).toBeNull();
    expect(agreed.body.data.isFullySigned).toBe(false);
    expect(agreed.body.data.durationDays).toBe(30);
    expect(agreed.body.data.projectTitle).toContain(runId);
    expect(agreed.body.data.partiesSnapshot.client.companyName).toBe('합의테스트');
    expect(agreed.body.data.terms).toContain('합의 금액');

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('CONTRACTING');

    const detail = await getContract(users.fl1, agreed.body.data.id);
    expect(detail.status).toBe(200);
    expect(detail.body.data.agreedAmount).toBe('3200000');
    expect((await getContract(users.otherClient, agreed.body.data.id)).status).toBe(404);
  });

  it('동시 동의해도 계약서가 한 건만 생긴다', async () => {
    const { applicationId, projectId } = await selectOne();
    expect((await propose(users.client, applicationId, '4000000')).status).toBe(200);
    const [a, b] = await Promise.all([
      agree(users.fl1, applicationId),
      agree(users.fl1, applicationId),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = await prisma.contract.count({ where: { projectId } });
    expect(count).toBe(1);
  });

  it('프리랜서 거부 시 모집 기간이 남으면 RECRUITING으로 복귀하고 재선정할 수 있다', async () => {
    const project = await insertProject();
    const a1 = await apply(users.fl1, project.id, '2500000');
    const a2 = await apply(users.fl2, project.id, '2600000');
    expect(a1.status).toBe(201);
    expect(a2.status).toBe(201);
    expect((await accept(users.client, a1.body.data.id)).status).toBe(200);
    const applicationId = a1.body.data.id;
    const projectId = project.id;
    expect((await propose(users.client, applicationId, '3000000')).status).toBe(200);
    const declined = await decline(users.fl1, applicationId);
    expect(declined.status).toBe(200);
    expect(declined.body.data.status).toBe('REJECTED');
    expect(declined.body.data.rejectReason).toBe('NEGOTIATION_FAILED');
    expect(declined.body.data.offerStatus).toBe('DECLINED');
    expect(declined.body.data.reopenedRecruiting).toBe(true);
    expect(declined.body.data.projectStatusAfter).toBe('RECRUITING');

    const after = await prisma.project.findUnique({ where: { id: projectId } });
    expect(after.status).toBe('RECRUITING');
    expect(after.closedAt).toBeNull();

    const others = await prisma.application.findMany({
      where: { projectId, freelancerId: users.fl2.id },
    });
    expect(others[0].rejectReason).toBe('OTHER_ACCEPTED');

    // 새 지원자 선정(부분 UNIQUE 해제 확인)
    const fl3 = await signup('fl3', 'FREELANCER');
    users.fl3 = fl3;
    await completeFreelancer(fl3);
    const newApp = await apply(fl3, projectId, '2700000');
    expect(newApp.status).toBe(201);
    const reAccept = await accept(users.client, newApp.body.data.id);
    expect(reAccept.status).toBe(200);
  });

  it('모집 기간이 끝난 뒤 거부하면 CLOSED로 두고 재모집하지 않는다', async () => {
    const project = await insertProject({
      recruitEndDate: toDbDate(day(-1)),
      status: 'RECRUITING',
    });
    // 모집 종료된 프로젝트는 API 지원이 막히므로 테스트 DB에 직접 넣는다.
    const application = await prisma.application.create({
      data: {
        projectId: project.id,
        freelancerId: users.fl1.id,
        coverLetter: '기간 종료 후 거부',
        proposedAmount: 2_000_000n,
        proposedDurationDays: 20,
        status: 'ACCEPTED',
        decidedAt: new Date(),
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'CONTRACTING', closedAt: new Date() },
    });
    expect((await propose(users.client, application.id, '2100000')).status).toBe(200);
    const declined = await decline(users.fl1, application.id);
    expect(declined.status).toBe(200);
    expect(declined.body.data.reopenedRecruiting).toBe(false);
    expect(declined.body.data.projectStatusAfter).toBe('CLOSED');
    const after = await prisma.project.findUnique({ where: { id: project.id } });
    expect(after.status).toBe('CLOSED');
  });

  it('취소된 프로젝트에서는 제안·동의를 막는다', async () => {
    const { applicationId, projectId } = await selectOne();
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect((await propose(users.client, applicationId, '3000000')).status).toBe(409);

    const { applicationId: id2, projectId: p2 } = await selectOne(users.fl2);
    expect((await propose(users.client, id2, '3000000')).status).toBe(200);
    await prisma.project.update({
      where: { id: p2 },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect((await agree(users.fl2, id2)).status).toBe(409);
  });

  it('프로젝트 취소 시 서명 전 계약을 CANCELLED로 정리하고 SIGNED면 취소를 막는다', async () => {
    const { applicationId, projectId } = await selectOne();
    expect((await propose(users.client, applicationId, '3500000')).status).toBe(200);
    const agreed = await agree(users.fl1, applicationId);
    expect(agreed.status).toBe(201);

    const cancelOpen = await request(app)
      .post(`/api/projects/${projectId}/cancel`)
      .set(bearer(users.client));
    expect(cancelOpen.status).toBe(200);
    const cancelled = await prisma.contract.findUnique({ where: { id: agreed.body.data.id } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).not.toBeNull();

    const { applicationId: id2, projectId: p2 } = await selectOne(users.fl2);
    expect((await propose(users.client, id2, '3600000')).status).toBe(200);
    const c2 = await agree(users.fl2, id2);
    expect(c2.status).toBe(201);
    await prisma.contract.update({
      where: { id: c2.body.data.id },
      data: {
        status: 'SIGNED',
        clientSignedAt: new Date(),
        freelancerSignedAt: new Date(),
        signedAt: new Date(),
      },
    });
    const block = await request(app).post(`/api/projects/${p2}/cancel`).set(bearer(users.client));
    expect(block.status).toBe(409);
  });
});
