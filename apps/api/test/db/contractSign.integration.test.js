// STEP 09-B 양측 전자서명·계약 체결 통합 테스트(workbridge_test만 사용).
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
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
const sign = (user, id, body = { agreed: true }) =>
  request(app).post(`/api/contracts/${id}/sign`).set(bearer(user)).send(body);
const getContract = (user, id) => request(app).get(`/api/contracts/${id}`).set(bearer(user));
const listContracts = (user, query = {}) =>
  request(app).get('/api/me/contracts').query(query).set(bearer(user));

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `서명${name}`, email: email(name), password: PASSWORD, role });
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
    .send({ companyName: '서명테스트', businessField: 'IT' });
  expect(res.status).toBe(200);
}

function insertProject(data = {}) {
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `서명 대상 ${runId}`,
      description: '서명 테스트용 프로젝트',
      category: 'WEB',
      recruitStartDate: null,
      recruitEndDate: toDbDate(day(14)),
      budget: 5_000_000n,
      status: 'RECRUITING',
      ...data,
    },
  });
}

async function selectOne(freelancer = users.fl1, amount = '2500000') {
  const project = await insertProject();
  const applied = await apply(freelancer, project.id, amount);
  expect(applied.status).toBe(201);
  const accepted = await accept(users.client, applied.body.data.id);
  expect(accepted.status).toBe(200);
  return { projectId: project.id, applicationId: applied.body.data.id, freelancer };
}

async function createPendingContract(freelancer = users.fl1, offerAmount = '3200000') {
  const selected = await selectOne(freelancer);
  expect((await propose(users.client, selected.applicationId, offerAmount)).status).toBe(200);
  const created = await agree(freelancer, selected.applicationId);
  expect(created.status).toBe(201);
  expect(created.body.data.status).toBe('SIGNATURE_PENDING');
  return { ...selected, contractId: created.body.data.id, contract: created.body.data };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `S stack ${runId}`, normalizedName: `sstack${runId}` },
  });
  users.client = await signup('client', 'CLIENT');
  users.fl1 = await signup('fl1', 'FREELANCER');
  users.fl2 = await signup('fl2', 'FREELANCER');
  users.outsider = await signup('out', 'FREELANCER');
  await completeClient(users.client);
  await completeFreelancer(users.fl1);
  await completeFreelancer(users.fl2);
  await completeFreelancer(users.outsider);
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
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (stack) await prisma.techStack.deleteMany({ where: { id: stack.id } });
  await prisma.$disconnect();
});

describe('CTR-05 bilateral contract signatures', () => {
  it('의뢰인만 서명하면 SIGNATURE_PENDING을 유지하고 프로젝트를 WORKING으로 올리지 않는다', async () => {
    const { projectId, contractId } = await createPendingContract();
    const res = await sign(users.client, contractId);
    expect(res.status).toBe(200);
    expect(res.body.data.clientSignedAt).not.toBeNull();
    expect(res.body.data.freelancerSignedAt).toBeNull();
    expect(res.body.data.signedAt).toBeNull();
    expect(res.body.data.status).toBe('SIGNATURE_PENDING');
    expect(res.body.data.isFullySigned).toBe(false);
    expect(res.body.data.displayStatus).toBe('WAITING_FREELANCER_SIGNATURE');
    expect(res.body.data.availableActions).toEqual([]);

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('CONTRACTING');
  });

  it('프리랜서만 서명해도 미체결이며 의뢰인 서명을 기다린다', async () => {
    const { contractId } = await createPendingContract(users.fl2);
    const res = await sign(users.fl2, contractId);
    expect(res.status).toBe(200);
    expect(res.body.data.freelancerSignedAt).not.toBeNull();
    expect(res.body.data.clientSignedAt).toBeNull();
    expect(res.body.data.status).toBe('SIGNATURE_PENDING');
    expect(res.body.data.displayStatus).toBe('WAITING_CLIENT_SIGNATURE');
  });

  it('양측 서명 후 SIGNED·signedAt을 기록하고 프로젝트는 CONTRACTING을 유지한다', async () => {
    const { projectId, contractId } = await createPendingContract();
    expect((await sign(users.client, contractId)).status).toBe(200);
    const second = await sign(users.fl1, contractId);
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('SIGNED');
    expect(second.body.data.signedAt).not.toBeNull();
    expect(second.body.data.isFullySigned).toBe(true);
    expect(second.body.data.displayStatus).toBe('PAYMENT_PENDING');
    expect(second.body.data.availableActions).toEqual([]);

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('CONTRACTING');
    expect(project.status).not.toBe('IN_PROGRESS');
  });

  it('역순(프리랜서→의뢰인)으로도 체결된다', async () => {
    const { contractId } = await createPendingContract(users.fl2, '3300000');
    expect((await sign(users.fl2, contractId)).status).toBe(200);
    const done = await sign(users.client, contractId);
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('SIGNED');
    expect(done.body.data.clientSignedAt).not.toBeNull();
    expect(done.body.data.freelancerSignedAt).not.toBeNull();
  });

  it('비로그인·비동의·비당사자를 차단한다', async () => {
    const { contractId } = await createPendingContract();
    expect(
      (await request(app).post(`/api/contracts/${contractId}/sign`).send({ agreed: true })).status,
    ).toBe(401);
    expect((await sign(users.client, contractId, {})).status).toBe(400);
    expect((await sign(users.client, contractId, { agreed: false })).status).toBe(400);
    expect(
      (await sign(users.client, contractId, { agreed: true, signedAt: '2099-01-01T00:00:00.000Z' }))
        .status,
    ).toBe(400);
    const outsider = await sign(users.outsider, contractId);
    expect(outsider.status).toBe(404);
    expect((await getContract(users.outsider, contractId)).status).toBe(404);
  });

  it('중복 서명은 ALREADY_SIGNED로 막고 원본 시각을 보존한다', async () => {
    const { contractId } = await createPendingContract();
    const first = await sign(users.client, contractId);
    expect(first.status).toBe(200);
    const original = first.body.data.clientSignedAt;
    const again = await sign(users.client, contractId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SIGNED');
    const row = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(row.clientSignedAt.toISOString()).toBe(new Date(original).toISOString());
  });

  it('동일인 연속·동시 서명도 한 번만 반영한다', async () => {
    const { contractId } = await createPendingContract(users.fl2, '3400000');
    const [a, b] = await Promise.all([
      sign(users.client, contractId),
      sign(users.client, contractId),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const row = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(row.clientSignedAt).not.toBeNull();
    expect(row.freelancerSignedAt).toBeNull();
    expect(row.status).toBe('SIGNATURE_PENDING');
  });

  it('양측 동시 서명도 최종 SIGNED와 두 서명 시각이 정확하다', async () => {
    const { contractId, projectId } = await createPendingContract(users.fl1, '3500000');
    const [clientRes, flRes] = await Promise.all([
      sign(users.client, contractId),
      sign(users.fl1, contractId),
    ]);
    expect([clientRes.status, flRes.status].every((s) => s === 200)).toBe(true);
    const row = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(row.status).toBe('SIGNED');
    expect(row.clientSignedAt).not.toBeNull();
    expect(row.freelancerSignedAt).not.toBeNull();
    expect(row.signedAt).not.toBeNull();
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('CONTRACTING');
  });

  it('한 명만 서명한 뒤 프로젝트 취소하면 계약을 CANCELLED로 두고 추가 서명을 막는다', async () => {
    const { projectId, contractId } = await createPendingContract(users.fl2, '3600000');
    expect((await sign(users.client, contractId)).status).toBe(200);
    const cancel = await request(app)
      .post(`/api/projects/${projectId}/cancel`)
      .set(bearer(users.client));
    expect(cancel.status).toBe(200);

    const blocked = await sign(users.fl2, contractId);
    expect(blocked.status).toBe(409);
    const row = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.clientSignedAt).not.toBeNull();
    expect(row.freelancerSignedAt).toBeNull();
    expect(row.cancelledAt).not.toBeNull();
  });

  it('체결(SIGNED) 후 프로젝트 취소는 409이고 계약·서명은 유지된다', async () => {
    const { projectId, contractId } = await createPendingContract(users.fl1, '3700000');
    expect((await sign(users.client, contractId)).status).toBe(200);
    expect((await sign(users.fl1, contractId)).status).toBe(200);

    const cancel = await request(app)
      .post(`/api/projects/${projectId}/cancel`)
      .set(bearer(users.client));
    expect(cancel.status).toBe(409);

    const row = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(row.status).toBe('SIGNED');
    expect(row.signedAt).not.toBeNull();
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project.status).toBe('CONTRACTING');
  });

  it('서명 후 계약 본문·합의 금액·스냅샷은 바뀌지 않는다', async () => {
    const { contractId } = await createPendingContract(users.fl2, '3800000');
    const before = await prisma.contract.findUnique({ where: { id: contractId } });
    expect((await sign(users.client, contractId)).status).toBe(200);
    expect((await sign(users.fl2, contractId)).status).toBe(200);
    const after = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(after.terms).toBe(before.terms);
    expect(after.agreedAmount).toBe(before.agreedAmount);
    expect(after.durationDays).toBe(before.durationDays);
    expect(after.projectTitle).toBe(before.projectTitle);
    expect(after.partiesSnapshot).toEqual(before.partiesSnapshot);
  });

  it('CTR-03 목록은 본인 계약만 보여주고 남의 계약 상세는 404다', async () => {
    const mine = await createPendingContract(users.fl1, '3900000');
    const other = await createPendingContract(users.fl2, '3910000');

    const list = await listContracts(users.fl1);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((row) => row.id);
    expect(ids).toContain(mine.contractId);
    expect(ids).not.toContain(other.contractId);
    expect(list.body.data.every((row) => row.terms === undefined)).toBe(true);

    expect((await getContract(users.fl1, other.contractId)).status).toBe(404);
    expect((await sign(users.fl1, other.contractId)).status).toBe(404);
  });

  it('금액 제안·동의 회귀와 서명 가능 액션을 유지한다', async () => {
    const selected = await selectOne(users.fl2, '2600000');
    const proposed = await propose(users.client, selected.applicationId, '4000000');
    expect(proposed.status).toBe(200);
    expect(proposed.body.data.offerStatus).toBe('PENDING');
    const created = await agree(users.fl2, selected.applicationId);
    expect(created.status).toBe(201);
    expect(created.body.data.availableActions).toEqual(['SIGN']);

    const clientView = await getContract(users.client, created.body.data.id);
    expect(clientView.status).toBe(200);
    expect(clientView.body.data.availableActions).toEqual(['SIGN']);
    expect(clientView.body.data.agreedAmount).toBe('4000000');
  });
});
