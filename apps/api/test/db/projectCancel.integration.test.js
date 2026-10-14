// 프로젝트 취소(STAT-02, A-27) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 권한·상태별 허용·지원서 처리·취소 후 화면 데이터·동시 요청·롤백을 Mock 없이 실제 트랜잭션과 행 잠금으로 확인한다.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트·지원·알림·북마크·기술 스택(runId 이름)만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { createProjectService } from '../../src/modules/projects/project.service.js';
import { runRecruitStatusSync } from '../../src/modules/projects/projectClosure.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `x${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
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
const freelancers = [];
const today = todayKst();
const day = (offset) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });
const withAuth = (req, user) => (user ? req.set(bearer(user)) : req);
const cancel = (user, projectId) =>
  withAuth(request(app).post(`/api/projects/${projectId}/cancel`), user);
const apply = (user, projectId) =>
  request(app)
    .post(`/api/projects/${projectId}/applications`)
    .set(bearer(user))
    .send({
      coverLetter: `지원서 ${user.id}`,
      proposedAmount: '2500000',
      proposedDurationDays: 30,
    });
const accept = (user, id) => request(app).post(`/api/applications/${id}/accept`).set(bearer(user));
const reject = (user, id) => request(app).post(`/api/applications/${id}/reject`).set(bearer(user));
const close = (user, projectId) =>
  request(app).post(`/api/projects/${projectId}/close`).set(bearer(user));
const detail = (user, projectId) => withAuth(request(app).get(`/api/projects/${projectId}`), user);

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `취소${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

function insertProject(data = {}) {
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `취소 대상 ${runId}`,
      description: '취소 테스트용 프로젝트',
      category: 'PLANNING',
      recruitEndDate: toDbDate(day(10)),
      budget: 9_007_199_254_740_993n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: [{ techStackId: stack.id }] },
    },
  });
}

/** 모집 중 프로젝트에 프리랜서 n명이 API로 지원한다(알림 ① 포함). 지원 ID를 순서대로 돌려준다. */
async function projectWithApplicants(count, data = {}) {
  const project = await insertProject(data);
  const ids = [];
  for (const freelancer of freelancers.slice(0, count)) {
    const res = await apply(freelancer, project.id);
    expect(res.status).toBe(201);
    ids.push(res.body.data.id);
  }
  return { project, ids };
}

/** API로 지원할 수 없는 상태(마감 지남 등)는 지원 행을 직접 넣는다. */
async function insertApplications(projectId, count, data = {}) {
  const ids = [];
  for (const freelancer of freelancers.slice(0, count)) {
    const row = await prisma.application.create({
      data: {
        projectId,
        freelancerId: freelancer.id,
        coverLetter: '직접 넣은 지원',
        proposedAmount: 1_000_000n,
        proposedDurationDays: 10,
        ...data,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

const rowsOf = (projectId) =>
  prisma.application.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
const projectRow = (id) => prisma.project.findUnique({ where: { id } });
const snapshot = async (projectId) => ({
  project: await projectRow(projectId),
  applications: await rowsOf(projectId),
  notifications: await prisma.notification.count({ where: { projectId } }),
});

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `X stack ${runId}`, normalizedName: `xstack${runId}` },
  });

  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('client2', 'CLIENT');
  for (const client of [users.client, users.otherClient]) {
    const res = await request(app)
      .put('/api/users/me/client-profile')
      .set(bearer(client))
      .send({ companyName: '취소테스트 주식회사', businessField: 'IT' });
    expect(res.status).toBe(200);
  }
  for (let index = 0; index < 4; index += 1) {
    const freelancer = await signup(`freelancer${index}`, 'FREELANCER');
    const res = await request(app)
      .put('/api/users/me/freelancer-profile')
      .set(bearer(freelancer))
      .send({ mainCategory: 'WEB', techStackIds: [stack.id], careerYears: 3, hourlyRate: '50000' });
    expect(res.status).toBe(200);
    freelancers.push(freelancer);
  }
  users.outsider = await signup('outsider', 'FREELANCER');
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  if (!prisma) return;
  const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
  await prisma.application.deleteMany({
    where: { OR: [{ freelancer: runUsers }, { project: { client: runUsers } }] },
  });
  await prisma.project.deleteMany({ where: { client: runUsers } });
  await prisma.user.deleteMany({ where: runUsers });
  await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
  await prisma.$disconnect();
});

describe('STAT-02 permissions', () => {
  it('checks login, role, client, existence and ownership before touching the project', async () => {
    const project = await insertProject();
    const before = await snapshot(project.id);

    expect((await cancel(null, project.id)).status).toBe(401);
    const noRole = await cancel(users.noRole, project.id);
    expect([noRole.status, noRole.body.error.code]).toEqual([403, 'ROLE_REQUIRED']);
    const freelancer = await cancel(freelancers[0], project.id);
    expect([freelancer.status, freelancer.body.error.code]).toEqual([403, 'FORBIDDEN']);
    const other = await cancel(users.otherClient, project.id);
    expect([other.status, other.body.error.code]).toEqual([403, 'FORBIDDEN']);
    for (const id of ['999999999', 'abc', '0']) {
      expect((await cancel(users.client, id)).status).toBe(404);
    }

    expect(await snapshot(project.id)).toEqual(before);
  });

  it('refuses soft-deleted projects and hides someone else’s cancelled project', async () => {
    const deleted = await insertProject({ deletedAt: new Date() });
    const res = await cancel(users.client, deleted.id);
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
    expect((await projectRow(deleted.id)).status).toBe('RECRUITING');

    const cancelled = await insertProject({ status: 'CANCELLED', cancelledAt: new Date() });
    expect((await cancel(users.otherClient, cancelled.id)).status).toBe(404);
  });
});

describe('STAT-02 allowed states (before the contract is signed)', () => {
  it.each([
    ['SCHEDULED', { status: 'SCHEDULED', recruitStartDate: toDbDate(day(3)) }],
    ['RECRUITING', {}],
    ['CLOSED', { status: 'CLOSED', closedAt: new Date() }],
    ['CONTRACTING', { status: 'CONTRACTING', closedAt: new Date() }],
  ])('cancels a %s project and keeps the row', async (_label, data) => {
    const project = await insertProject(data);
    const res = await cancel(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.body.data.project).toMatchObject({
      id: project.id,
      status: 'CANCELLED',
      isCancelled: true,
      publicStatus: 'CLOSED',
      availableActions: [],
      budget: '9007199254740993',
    });
    expect(res.body.data.project.cancelledAt).not.toBeNull();
    const row = await projectRow(project.id);
    expect(row).toMatchObject({ status: 'CANCELLED', deletedAt: null });
    expect(row.cancelledAt).toEqual(new Date(res.body.data.project.cancelledAt));
    expect(row.closedAt).toEqual(project.closedAt);
  });

  it.each(['IN_PROGRESS', 'COMPLETED'])(
    'refuses a %s project (signed contract: complete or refund instead)',
    async (status) => {
      const project = await insertProject({ status, closedAt: new Date() });
      const before = await snapshot(project.id);
      const res = await cancel(users.client, project.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        message:
          '계약이 체결된 프로젝트는 취소할 수 없습니다. 정상 완료 또는 환불 절차를 거쳐야 합니다.',
        details: { currentStatus: status },
      });
      expect(await snapshot(project.id)).toEqual(before);
    },
  );

  it('answers a repeated cancel with 409 and keeps the first cancellation time', async () => {
    const project = await insertProject();
    expect((await cancel(users.client, project.id)).status).toBe(200);
    const first = await projectRow(project.id);
    const again = await cancel(users.client, project.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      message: '이미 취소된 프로젝트입니다.',
      details: { currentStatus: 'CANCELLED' },
    });
    expect(await projectRow(project.id)).toEqual(first);
  });

  it('offers CANCEL to the owner only in cancellable states', async () => {
    const recruiting = await insertProject();
    const contracting = await insertProject({ status: 'CONTRACTING', closedAt: new Date() });
    const working = await insertProject({ status: 'IN_PROGRESS', closedAt: new Date() });
    expect((await detail(users.client, recruiting.id)).body.data.availableActions).toEqual([
      'EDIT',
      'DELETE',
      'CLOSE',
      'CANCEL',
    ]);
    expect((await detail(users.client, contracting.id)).body.data.availableActions).toEqual([
      'CANCEL',
    ]);
    expect((await detail(users.client, working.id)).body.data.availableActions).toEqual([]);
    const visitor = (await detail(freelancers[0], recruiting.id)).body.data;
    expect(visitor).not.toHaveProperty('availableActions');
    expect(visitor).not.toHaveProperty('pendingApplicantCount');
    expect(visitor.isCancelled).toBe(false);
  });
});

describe('STAT-02 applications', () => {
  it('rejects pending applications with PROJECT_CANCELLED and keeps earlier decisions', async () => {
    const { project, ids } = await projectWithApplicants(3);
    const manual = await reject(users.client, ids[0]);
    expect(manual.status).toBe(200);
    const [manualBefore] = await prisma.application.findMany({ where: { id: ids[0] } });
    const ownerView = await detail(users.client, project.id);
    expect(ownerView.body.data.pendingApplicantCount).toBe(2);
    const notificationsBefore = await prisma.notification.count({
      where: { projectId: project.id },
    });

    const res = await cancel(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rejectedCount: 2, keptAcceptedCount: 0 });
    const cancelledAt = (await projectRow(project.id)).cancelledAt;
    const rows = await rowsOf(project.id);
    expect(rows[0]).toEqual(manualBefore);
    for (const row of rows.slice(1)) {
      expect(row).toMatchObject({
        status: 'REJECTED',
        rejectReason: 'PROJECT_CANCELLED',
        decidedAt: cancelledAt,
        coverLetter: expect.stringMatching(/^지원서 /),
        proposedAmount: 2_500_000n,
        proposedDurationDays: 30,
      });
    }
    // 취소 전용 알림은 필수 5종에 없어 만들지 않고, 마감 알림 ⑤로 대신 보내지도 않는다.
    expect(await prisma.notification.count({ where: { projectId: project.id } })).toBe(
      notificationsBefore,
    );
    expect(
      await prisma.notification.count({ where: { projectId: project.id, type: 'PROJECT_CLOSED' } }),
    ).toBe(0);
  });

  it('keeps the selected (ACCEPTED) application of a contracting project as history', async () => {
    const { project, ids } = await projectWithApplicants(3);
    expect((await accept(users.client, ids[1])).status).toBe(200);
    const before = await rowsOf(project.id);

    const res = await cancel(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rejectedCount: 0, keptAcceptedCount: 1 });
    expect(await rowsOf(project.id)).toEqual(before);
    expect((await projectRow(project.id)).status).toBe('CANCELLED');

    // 선정된 지원자는 내 지원 현황과 상세에서 '선정됨' + 프로젝트 취소를 함께 본다.
    const mine = await request(app).get('/api/me/applications').set(bearer(freelancers[1]));
    const item = mine.body.data.find((application) => application.id === ids[1]);
    expect(item).toMatchObject({
      status: 'ACCEPTED',
      project: { id: project.id, isCancelled: true, isDeleted: false, publicStatus: 'CLOSED' },
    });
    const accepted = await detail(freelancers[1], project.id);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({
      isCancelled: true,
      myApplication: { id: ids[1], status: 'ACCEPTED' },
    });
  });

  it('closes an overdue project by its deadline before cancelling it', async () => {
    const project = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    await insertApplications(project.id, 2);
    const res = await cancel(users.client, project.id);
    expect(res.status).toBe(200);
    // 마감일이 지나 이미 마감된 지원은 마감 사유로 남고(알림 ⑤ 포함), 취소로 다시 바뀌지 않는다.
    expect(res.body.data.rejectedCount).toBe(0);
    const row = await projectRow(project.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.closedAt).not.toBeNull();
    expect((await rowsOf(project.id)).map((a) => a.rejectReason)).toEqual([
      'PROJECT_CLOSED',
      'PROJECT_CLOSED',
    ]);
  });
});

describe('after cancellation', () => {
  it('blocks every later change and stays cancelled through GET and the sync job', async () => {
    const { project, ids } = await projectWithApplicants(1);
    expect((await cancel(users.client, project.id)).status).toBe(200);
    const cancelled = await snapshot(project.id);

    const late = await apply(freelancers[2], project.id);
    expect([late.status, late.body.error.code]).toEqual([404, 'NOT_FOUND']);
    for (const res of [await accept(users.client, ids[0]), await reject(users.client, ids[0])]) {
      expect(res.status).toBe(409);
    }
    expect((await close(users.client, project.id)).body.error.message).toBe(
      '취소된 프로젝트는 마감할 수 없습니다.',
    );
    const patch = await request(app)
      .patch(`/api/projects/${project.id}`)
      .set(bearer(users.client))
      .send({ title: '다시 열기' });
    expect(patch.status).toBe(409);
    const remove = await request(app)
      .delete(`/api/projects/${project.id}`)
      .set(bearer(users.client));
    expect(remove.status).toBe(409);

    await runRecruitStatusSync({ prisma });
    for (const viewer of [users.client, freelancers[0], null]) await detail(viewer, project.id);
    expect(await snapshot(project.id)).toEqual(cancelled);
  });

  it('shows the project to the owner and its applicants only', async () => {
    const { project } = await projectWithApplicants(1);
    expect((await cancel(users.client, project.id)).status).toBe(200);

    const owner = await detail(users.client, project.id);
    expect(owner.body.data).toMatchObject({ status: 'CANCELLED', isCancelled: true });
    const applicant = await detail(freelancers[0], project.id);
    expect(applicant.body.data).toMatchObject({
      isCancelled: true,
      myApplication: { status: 'REJECTED', rejectReason: 'PROJECT_CANCELLED' },
    });
    for (const viewer of [null, users.outsider, users.otherClient]) {
      expect((await detail(viewer, project.id)).status).toBe(404);
    }
    const applicants = await request(app)
      .get(`/api/projects/${project.id}/applications`)
      .set(bearer(users.client));
    expect(applicants.status).toBe(200);
    expect(applicants.body.data.every((item) => item.availableActions.length === 0)).toBe(true);
  });

  it('drops out of search and recommendations but keeps bookmark rows', async () => {
    const base = await insertProject({ title: `추천 기준 ${runId}` });
    const target = await insertProject({ title: `취소될 추천 ${runId}` });
    const saved = await request(app)
      .put(`/api/projects/${target.id}/bookmark`)
      .set(bearer(users.outsider));
    expect(saved.status).toBe(204);
    const recommendedIds = async () =>
      (await request(app).get(`/api/projects/${base.id}/recommendations`)).body.data.map(
        (item) => item.id,
      );
    const searchIds = async () =>
      (await request(app).get('/api/projects').query({ q: runId })).body.data.map(
        (item) => item.id,
      );
    expect(await recommendedIds()).toContain(target.id);
    expect(await searchIds()).toContain(target.id);

    expect((await cancel(users.client, target.id)).status).toBe(200);
    expect(await recommendedIds()).not.toContain(target.id);
    expect(await searchIds()).not.toContain(target.id);
    expect((await request(app).get(`/api/projects/${target.id}/recommendations`)).status).toBe(404);
    const list = await request(app).get('/api/me/bookmarks').set(bearer(users.outsider));
    expect(list.body.data.map((item) => item.id)).not.toContain(target.id);
    expect(
      await prisma.bookmark.count({ where: { userId: users.outsider.id, projectId: target.id } }),
    ).toBe(1);
  });
});

describe('STAT-02 concurrency', () => {
  const settle = (promises) => Promise.all(promises);

  it('cancel vs new application: no pending application survives', async () => {
    for (let round = 0; round < 3; round += 1) {
      const project = await insertProject();
      const [cancelled, applied] = await settle([
        cancel(users.client, project.id),
        apply(freelancers[round], project.id),
      ]);
      expect(cancelled.status).toBe(200);
      expect([201, 404]).toContain(applied.status);
      const rows = await rowsOf(project.id);
      expect(rows.filter((row) => row.status === 'PENDING')).toEqual([]);
      if (applied.status === 201) expect(rows[0].rejectReason).toBe('PROJECT_CANCELLED');
    }
  });

  it('cancel vs accept: either the selection is kept as history or it is refused', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { project, ids } = await projectWithApplicants(2);
      const [cancelled, accepted] = await settle([
        cancel(users.client, project.id),
        accept(users.client, ids[0]),
      ]);
      expect(cancelled.status).toBe(200);
      const rows = await rowsOf(project.id);
      expect(rows.filter((row) => row.status === 'PENDING')).toEqual([]);
      expect((await projectRow(project.id)).status).toBe('CANCELLED');
      if (accepted.status === 200) {
        expect(rows.map((row) => [row.status, row.rejectReason])).toEqual([
          ['ACCEPTED', null],
          ['REJECTED', 'OTHER_ACCEPTED'],
        ]);
      } else {
        expect(accepted.status).toBe(409);
        expect(rows.every((row) => row.rejectReason === 'PROJECT_CANCELLED')).toBe(true);
      }
    }
  });

  it('cancel vs direct rejection: the decision that wins keeps its own reason', async () => {
    const { project, ids } = await projectWithApplicants(1);
    const [cancelled, rejected] = await settle([
      cancel(users.client, project.id),
      reject(users.client, ids[0]),
    ]);
    expect(cancelled.status).toBe(200);
    const [row] = await rowsOf(project.id);
    expect(row.status).toBe('REJECTED');
    expect(row.rejectReason).toBe(rejected.status === 200 ? 'MANUAL' : 'PROJECT_CANCELLED');
  });

  it('cancel vs manual close: cancel always ends the project, close may win first', async () => {
    const { project } = await projectWithApplicants(2);
    const [cancelled, closed] = await settle([
      cancel(users.client, project.id),
      close(users.client, project.id),
    ]);
    expect(cancelled.status).toBe(200);
    const rows = await rowsOf(project.id);
    expect(rows.filter((row) => row.status === 'PENDING')).toEqual([]);
    expect((await projectRow(project.id)).status).toBe('CANCELLED');
    const reason = closed.status === 200 ? 'PROJECT_CLOSED' : 'PROJECT_CANCELLED';
    expect(rows.every((row) => row.rejectReason === reason)).toBe(true);
  });

  it('cancel vs the automatic close job on an overdue project', async () => {
    const project = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    await insertApplications(project.id, 2);
    const [cancelled] = await settle([
      cancel(users.client, project.id),
      runRecruitStatusSync({ prisma }),
    ]);
    expect(cancelled.status).toBe(200);
    const rows = await rowsOf(project.id);
    expect(rows.map((row) => row.rejectReason)).toEqual(['PROJECT_CLOSED', 'PROJECT_CLOSED']);
    expect((await projectRow(project.id)).status).toBe('CANCELLED');
    // 같은 이벤트의 마감 알림은 한 번만(event_key UNIQUE + 행 잠금).
    expect(
      await prisma.notification.count({ where: { projectId: project.id, type: 'PROJECT_CLOSED' } }),
    ).toBe(2);
  });

  it('cancels once when the same request arrives many times at once', async () => {
    const { project } = await projectWithApplicants(2);
    const results = await settle(Array.from({ length: 5 }, () => cancel(users.client, project.id)));
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409]);
    const winner = results.find((res) => res.status === 200);
    expect(winner.body.data.rejectedCount).toBe(2);
  });
});

describe('STAT-02 transaction and contract policy', () => {
  it('rolls everything back when a step inside the transaction fails', async () => {
    const { project } = await projectWithApplicants(2);
    const before = await snapshot(project.id);
    const failing = createProjectService({
      prisma,
      contractPolicy: {
        findBlockingContract: async () => null,
        cancelOpenContracts: async () => {
          throw new Error('contract cleanup failed');
        },
      },
    });
    await expect(failing.cancelProject(users.client.id, project.id)).rejects.toThrow(
      'contract cleanup failed',
    );
    expect(await snapshot(project.id)).toEqual(before);
  });

  it('refuses a contracting project once the contract policy reports a signed contract', async () => {
    const project = await insertProject({ status: 'CONTRACTING', closedAt: new Date() });
    const before = await snapshot(project.id);
    const signed = createProjectService({
      prisma,
      contractPolicy: {
        findBlockingContract: async (_tx, target) =>
          target.id === project.id ? { id: 1, status: 'SIGNED' } : null,
        cancelOpenContracts: async () => 0,
      },
    });
    await expect(signed.cancelProject(users.client.id, project.id)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { currentStatus: 'CONTRACTING', contractStatus: 'SIGNED' },
    });
    expect(await snapshot(project.id)).toEqual(before);
  });
});
