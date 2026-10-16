// 지원자 관리·선정·거절(APP-02·03, DEC-01·02) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 동시성은 Mock 없이 실제 트랜잭션·행 잠금·부분 UNIQUE로 확인한다.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트와 지원·기술 스택(runId 이름)만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { createApplicationService } from '../../src/modules/applications/application.service.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `d${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
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
const apply = (user, projectId, amount = '2500000') =>
  request(app)
    .post(`/api/projects/${projectId}/applications`)
    .set(bearer(user))
    .send({ coverLetter: `지원서 ${user.id}`, proposedAmount: amount, proposedDurationDays: 30 });
const listApplicants = (user, projectId, query = {}) =>
  withAuth(request(app).get(`/api/projects/${projectId}/applications`), user).query(query);
const accept = (user, id, body) => {
  const req = withAuth(request(app).post(`/api/applications/${id}/accept`), user);
  return body === undefined ? req : req.send(body);
};
const reject = (user, id) => withAuth(request(app).post(`/api/applications/${id}/reject`), user);
const getApplication = (user, id) => request(app).get(`/api/applications/${id}`).set(bearer(user));

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `선정${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

async function completeFreelancer(user) {
  const res = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(user))
    .send({ mainCategory: 'WEB', techStackIds: [stack.id], careerYears: 3, hourlyRate: '50000' });
  expect(res.status).toBe(200);
}

/** 날짜가 지났거나 API로 만들 수 없는 상태는 테스트 DB에 직접 넣는다. */
function insertProject(data = {}) {
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `선정 대상 ${runId}`,
      description: '선정 테스트용 프로젝트',
      category: 'WEB',
      recruitEndDate: toDbDate(day(10)),
      budget: 3_000_000n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: [{ techStackId: stack.id }] },
    },
  });
}

/** 모집 중 프로젝트에 프리랜서 n명이 API로 지원한다. 지원 ID를 지원 순서대로 돌려준다. */
async function projectWithApplicants(count, data = {}) {
  const project = await insertProject(data);
  const ids = [];
  for (const [index, freelancer] of freelancers.slice(0, count).entries()) {
    const res = await apply(freelancer, project.id, String(1_000_000 + index));
    expect(res.status).toBe(201);
    ids.push(res.body.data.id);
  }
  return { project, ids };
}

/** 마감이 지난 프로젝트처럼 API로 지원할 수 없는 경우는 지원 행을 직접 넣는다. */
async function insertApplications(projectId, count) {
  const ids = [];
  for (const freelancer of freelancers.slice(0, count)) {
    const row = await prisma.application.create({
      data: {
        projectId,
        freelancerId: freelancer.id,
        coverLetter: '직접 넣은 지원',
        proposedAmount: 1_000_000n,
        proposedDurationDays: 10,
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
});

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `D stack ${runId}`, normalizedName: `dstack${runId}` },
  });

  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('client2', 'CLIENT');
  for (const client of [users.client, users.otherClient]) {
    const res = await request(app)
      .put('/api/users/me/client-profile')
      .set(bearer(client))
      .send({ companyName: '선정테스트 주식회사', businessField: 'IT' });
    expect(res.status).toBe(200);
  }
  for (let index = 0; index < 5; index += 1) {
    const freelancer = await signup(`freelancer${index}`, 'FREELANCER');
    await completeFreelancer(freelancer);
    freelancers.push(freelancer);
  }
  users.outsider = await signup('outsider', 'FREELANCER');
  await completeFreelancer(users.outsider);

  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  if (!prisma) return;
  const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
  await prisma.contract.deleteMany({
    where: { OR: [{ client: runUsers }, { freelancer: runUsers }] },
  });
  await prisma.application.deleteMany({
    where: { OR: [{ freelancer: runUsers }, { project: { client: runUsers } }] },
  });
  await prisma.project.deleteMany({ where: { client: runUsers } });
  await prisma.user.deleteMany({ where: runUsers });
  await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
  await prisma.$disconnect();
});

describe('one accepted application per project in the database', () => {
  it('has the partial UNIQUE index and it refuses a second ACCEPTED row', async () => {
    const [index] = await prisma.$queryRaw`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'applications' AND indexname = 'applications_one_accepted_per_project'`;
    expect(index.indexdef).toMatch(
      /CREATE UNIQUE INDEX applications_one_accepted_per_project ON public\.applications USING btree \(project_id\) WHERE \(status = 'ACCEPTED'::application_status\)/,
    );

    const project = await insertProject();
    const [first, second] = await insertApplications(project.id, 2);
    const decidedAt = new Date();
    await prisma.application.update({
      where: { id: first },
      data: { status: 'ACCEPTED', decidedAt },
    });
    await expect(
      prisma.application.update({ where: { id: second }, data: { status: 'ACCEPTED', decidedAt } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // 다른 프로젝트의 ACCEPTED와 같은 프로젝트의 여러 REJECTED는 막지 않는다.
    const other = await insertProject();
    const [otherId] = await insertApplications(other.id, 1);
    await prisma.application.update({
      where: { id: otherId },
      data: { status: 'ACCEPTED', decidedAt },
    });
    expect((await rowsOf(project.id)).map((a) => a.status)).toEqual(['ACCEPTED', 'PENDING']);
  });
});

describe('GET /api/projects/:projectId/applications (APP-02)', () => {
  it('lists applicants for the owner with public profiles, counts and stable paging', async () => {
    const { project, ids } = await projectWithApplicants(3);
    expect((await reject(users.client, ids[0])).status).toBe(200);

    const res = await listApplicants(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.counts).toEqual({ total: 3, PENDING: 2, ACCEPTED: 0, REJECTED: 1 });
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, totalCount: 3, totalPages: 1 });
    expect(res.body.data.map((a) => a.id)).toEqual([...ids].reverse());

    const newest = res.body.data[0];
    expect(newest).toMatchObject({
      id: ids[2],
      projectId: project.id,
      coverLetter: `지원서 ${freelancers[2].id}`,
      proposedAmount: '1000002',
      proposedDurationDays: 30,
      status: 'PENDING',
      availableActions: ['ACCEPT', 'REJECT'],
      freelancer: {
        id: freelancers[2].id,
        role: 'FREELANCER',
        profileComplete: true,
        freelancerProfile: { mainCategory: 'WEB', careerYears: 3 },
      },
    });
    expect(res.body.data[2]).toMatchObject({
      id: ids[0],
      status: 'REJECTED',
      rejectReason: 'MANUAL',
      availableActions: [],
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@workbridge.test');
    expect(text).not.toContain('hourlyRate');
    expect(text).not.toContain('passwordHash');

    const pending = await listApplicants(users.client, project.id, { status: 'PENDING' });
    expect(pending.body.data.map((a) => a.id)).toEqual([ids[2], ids[1]]);
    expect(pending.body.pagination.totalCount).toBe(2);
    expect(pending.body.counts.total).toBe(3);
    const beyond = await listApplicants(users.client, project.id, { page: '2' });
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual([]);
    expect((await listApplicants(users.client, project.id, { status: 'DONE' })).status).toBe(400);
  });

  it('pages ten at a time newest first with the id as a tiebreaker', async () => {
    const project = await insertProject();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    // 같은 시각에 생긴 지원 5건 + 다른 시각 지원: 정렬은 created_at DESC, id DESC.
    const rows = [];
    for (const freelancer of freelancers) {
      rows.push(
        await prisma.application.create({
          data: {
            projectId: project.id,
            freelancerId: freelancer.id,
            coverLetter: 'x',
            proposedAmount: 1n,
            proposedDurationDays: 1,
            createdAt,
          },
        }),
      );
    }
    const res = await listApplicants(users.client, project.id);
    expect(res.body.data.map((a) => a.id)).toEqual(rows.map((r) => r.id).sort((a, b) => b - a));
  });

  it('allows only the owning client and hides missing, deleted or private projects', async () => {
    const { project } = await projectWithApplicants(1);

    const anonymous = await listApplicants(null, project.id);
    expect(anonymous.status).toBe(401);
    expect((await listApplicants(users.noRole, project.id)).body.error.code).toBe('ROLE_REQUIRED');
    for (const user of [freelancers[0], users.outsider]) {
      const res = await listApplicants(user, project.id);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const otherClient = await listApplicants(users.otherClient, project.id);
    expect(otherClient.status).toBe(403);
    expect(otherClient.body.error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(otherClient.body)).not.toContain('지원서');

    for (const id of [2147483000, 'abc']) {
      expect((await listApplicants(users.client, id)).status).toBe(404);
    }
    const deleted = await insertProject({ deletedAt: new Date() });
    expect((await listApplicants(users.client, deleted.id)).status).toBe(404);

    const cancelled = await insertProject();
    await insertApplications(cancelled.id, 1);
    await prisma.project.update({
      where: { id: cancelled.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    const ownerView = await listApplicants(users.client, cancelled.id);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data[0].availableActions).toEqual([]);
    expect((await listApplicants(users.otherClient, cancelled.id)).status).toBe(404);
  });

  it('does not write to the database even when the deadline has passed (D-83)', async () => {
    const project = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    await insertApplications(project.id, 2);
    const before = await snapshot(project.id);
    const res = await listApplicants(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.body.data.every((a) => a.availableActions.length === 0)).toBe(true);
    expect(res.body.data[0].project.publicStatus).toBe('CLOSED');
    expect(await snapshot(project.id)).toEqual(before);
  });
});

describe('GET /api/applications/:id for the owner (APP-03)', () => {
  it('shows the applicant view to the author and the owner view to the owner only', async () => {
    const { project, ids } = await projectWithApplicants(2);

    const author = await getApplication(freelancers[0], ids[0]);
    expect(author.status).toBe(200);
    expect(author.body.data).not.toHaveProperty('freelancer');
    expect(author.body.data).not.toHaveProperty('availableActions');

    const owner = await getApplication(users.client, ids[0]);
    expect(owner.status).toBe(200);
    expect(owner.body.data).toMatchObject({
      id: ids[0],
      projectId: project.id,
      freelancer: { id: freelancers[0].id },
      availableActions: ['ACCEPT', 'REJECT'],
    });

    for (const user of [freelancers[1], users.otherClient, users.outsider]) {
      const res = await getApplication(user, ids[0]);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    expect((await getApplication(users.client, ids[0])).status).toBe(404);
    expect((await getApplication(freelancers[0], ids[0])).status).toBe(200);
  });
});

describe('POST /api/applications/:id/accept (DEC-01)', () => {
  it('accepts one, auto-rejects the other pending ones and keeps earlier rejections', async () => {
    const { project, ids } = await projectWithApplicants(4);
    const manual = await reject(users.client, ids[3]);
    expect(manual.status).toBe(200);
    const manualRow = (await rowsOf(project.id)).find((a) => a.id === ids[3]);
    const before = await rowsOf(project.id);

    const res = await accept(users.client, ids[1]);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.autoRejectedCount).toBe(2);
    expect(res.body.data.application).toMatchObject({
      id: ids[1],
      status: 'ACCEPTED',
      rejectReason: null,
      proposedAmount: '1000001',
      availableActions: ['PROPOSE_OFFER'],
      offerAmount: null,
      offerStatus: null,
      contractId: null,
      project: { id: project.id, publicStatus: 'CLOSED' },
    });

    const rows = await rowsOf(project.id);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    const decidedAt = byId[ids[1]].decidedAt;
    expect(decidedAt).not.toBeNull();
    expect(byId[ids[1]].status).toBe('ACCEPTED');
    for (const id of [ids[0], ids[2]]) {
      expect(byId[id]).toMatchObject({ status: 'REJECTED', rejectReason: 'OTHER_ACCEPTED' });
      expect(byId[id].decidedAt).toEqual(decidedAt);
    }
    expect(byId[ids[3]]).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'MANUAL',
      decidedAt: manualRow.decidedAt,
    });
    // 지원서 내용(금액·기간·자기소개)은 그대로 남는다.
    for (const row of before) {
      expect(byId[row.id]).toMatchObject({
        coverLetter: row.coverLetter,
        proposedAmount: row.proposedAmount,
        proposedDurationDays: row.proposedDurationDays,
      });
    }
    const stored = await projectRow(project.id);
    expect(stored).toMatchObject({ status: 'CONTRACTING', closedAt: decidedAt });
    expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(0);
  });

  it('closes the project for applying, deciding, editing and deleting after the selection', async () => {
    const marker = `완료${randomUUID().slice(0, 8)}`;
    const { project, ids } = await projectWithApplicants(2, { title: `선정 ${marker}` });
    expect((await accept(users.client, ids[0])).status).toBe(200);
    const after = await snapshot(project.id);

    const late = await apply(users.outsider, project.id);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { currentStatus: 'CLOSED' },
    });

    for (const res of [
      await accept(users.client, ids[0]),
      await accept(users.client, ids[1]),
      await reject(users.client, ids[0]),
      await reject(users.client, ids[1]),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        details: { projectStatus: 'CONTRACTING' },
      });
    }

    for (const body of [{ budget: '1' }, { recruitEndDate: day(20) }, { title: '바꾼 제목' }]) {
      const res = await request(app)
        .patch(`/api/projects/${project.id}`)
        .set(bearer(users.client))
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FIELD_LOCKED');
    }
    const removed = await request(app)
      .delete(`/api/projects/${project.id}`)
      .set(bearer(users.client));
    expect(removed.status).toBe(409);
    expect(await snapshot(project.id)).toEqual(after);

    const owner = await request(app).get(`/api/projects/${project.id}`).set(bearer(users.client));
    // 계약 대기는 수정·삭제·마감할 수 없고, 계약 체결 전이라 취소(STAT-02)만 남는다.
    expect(owner.body.data).toMatchObject({ status: 'CONTRACTING', availableActions: ['CANCEL'] });
    const publicView = await request(app).get(`/api/projects/${project.id}`);
    expect(publicView.body.data.publicStatus).toBe('CLOSED');
    expect(publicView.body.data).not.toHaveProperty('status');
    const recruiting = await request(app)
      .get('/api/projects')
      .query({ q: marker, status: 'RECRUITING' });
    expect(recruiting.body.pagination.totalCount).toBe(0);
    const closed = await request(app).get('/api/projects').query({ q: marker, status: 'CLOSED' });
    expect(closed.body.data.map((p) => p.id)).toEqual([project.id]);
    expect(closed.body.data[0].publicStatus).toBe('CLOSED');
  });

  it('shows each freelancer only their own result', async () => {
    const { project, ids } = await projectWithApplicants(3);
    await reject(users.client, ids[2]);
    await accept(users.client, ids[0]);

    const expected = [
      [freelancers[0], { status: 'ACCEPTED', rejectReason: null }],
      [freelancers[1], { status: 'REJECTED', rejectReason: 'OTHER_ACCEPTED' }],
      [freelancers[2], { status: 'REJECTED', rejectReason: 'MANUAL' }],
    ];
    for (const [freelancer, result] of expected) {
      const mine = await request(app)
        .get('/api/me/applications')
        .set(bearer(freelancer))
        .query({ status: result.status });
      const item = mine.body.data.find((a) => a.projectId === project.id);
      expect(item).toMatchObject({ ...result, proposedDurationDays: 30 });
      expect(item.decidedAt).not.toBeNull();
      expect(item).not.toHaveProperty('freelancer');
      for (const other of freelancers.filter((f) => f !== freelancer)) {
        expect(JSON.stringify(mine.body)).not.toContain(`지원서 ${other.id}"`);
      }

      const detail = await request(app).get(`/api/projects/${project.id}`).set(bearer(freelancer));
      expect(detail.body.data.myApplication).toMatchObject(result);
      expect(detail.body.data.publicStatus).toBe('CLOSED');
    }
    // 다른 지원자의 지원서는 볼 수 없다.
    expect((await getApplication(freelancers[1], ids[0])).status).toBe(404);
  });

  it('checks login, client role, ownership, project and application in that order', async () => {
    const { project, ids } = await projectWithApplicants(2);
    const before = await snapshot(project.id);

    expect((await accept(null, ids[0])).status).toBe(401);
    expect((await accept(users.noRole, ids[0])).body.error.code).toBe('ROLE_REQUIRED');
    const applicant = await accept(freelancers[0], ids[0]);
    expect(applicant.status).toBe(403);
    expect(applicant.body.error.code).toBe('FORBIDDEN');
    const otherClient = await accept(users.otherClient, ids[0]);
    expect(otherClient.status).toBe(404);
    expect(otherClient.body.error.code).toBe('NOT_FOUND');
    for (const id of [2147483000, 'abc', '0']) {
      expect((await accept(users.client, id)).status).toBe(404);
    }
    const offer = await accept(users.client, ids[0], { offerAmount: '2800000' });
    expect(offer.status).toBe(400);
    expect(offer.body.error.details.fields).toHaveProperty('offerAmount');
    expect((await reject(users.otherClient, ids[0])).status).toBe(404);
    expect((await reject(freelancers[0], ids[0])).status).toBe(403);

    expect(await snapshot(project.id)).toEqual(before);
  });
});

describe('POST /api/applications/:id/reject (DEC-02)', () => {
  it('rejects one pending application manually and leaves the rest untouched', async () => {
    const { project, ids } = await projectWithApplicants(3);
    const res = await reject(users.client, ids[1]);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: ids[1],
      status: 'REJECTED',
      rejectReason: 'MANUAL',
      availableActions: [],
    });
    expect(res.body.data.decidedAt).not.toBeNull();

    const rows = await rowsOf(project.id);
    expect(rows.map((row) => row.status)).toEqual(['PENDING', 'REJECTED', 'PENDING']);
    expect((await projectRow(project.id)).status).toBe('RECRUITING');

    const again = await reject(users.client, ids[1]);
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ applicationStatus: 'REJECTED' });
    const acceptRejected = await accept(users.client, ids[1]);
    expect(acceptRejected.status).toBe(409);
    expect(acceptRejected.body.error.details).toEqual({ applicationStatus: 'REJECTED' });
    expect(await rowsOf(project.id)).toEqual(rows);

    // 직접 거절 뒤에도 남은 지원자를 선정할 수 있다.
    const selected = await accept(users.client, ids[0]);
    expect(selected.status).toBe(200);
    expect(selected.body.data.autoRejectedCount).toBe(1);
  });
});

describe('project state rules for deciding (D-34 RFP, D-83)', () => {
  const expectRefused = (res, projectStatus) => {
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { projectStatus },
    });
  };

  it('refuses closed, past-deadline, cancelled and deleted projects without writing', async () => {
    const expired = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    const storedClosed = await insertProject({ status: 'CLOSED', closedAt: new Date() });
    const cancelled = await insertProject({ status: 'CANCELLED', cancelledAt: new Date() });
    const cases = [
      [expired, 'CLOSED'],
      [storedClosed, 'CLOSED'],
      [cancelled, 'CANCELLED'],
    ];
    for (const [project, status] of cases) {
      const [id] = await insertApplications(project.id, 1);
      const before = await snapshot(project.id);
      expectRefused(await accept(users.client, id), status);
      expectRefused(await reject(users.client, id), status);
      expect(await snapshot(project.id)).toEqual(before);
    }

    const deleted = await insertProject();
    const [deletedId] = await insertApplications(deleted.id, 1);
    await prisma.project.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    expect((await accept(users.client, deletedId)).status).toBe(404);
    expect((await reject(users.client, deletedId)).status).toBe(404);
    expect((await rowsOf(deleted.id))[0].status).toBe('PENDING');
  });

  it('allows deciding on the deadline day and when a scheduled project has started', async () => {
    const endsToday = await projectWithApplicants(2, { recruitEndDate: toDbDate(today) });
    expect((await accept(users.client, endsToday.ids[0])).status).toBe(200);

    const started = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(today),
      recruitEndDate: toDbDate(day(3)),
    });
    const [id] = await insertApplications(started.id, 1);
    expect((await accept(users.client, id)).status).toBe(200);
    expect((await projectRow(started.id)).status).toBe('CONTRACTING');
  });

  it('stops deciding at 00:00 KST the day after the deadline', async () => {
    const project = await insertProject({ recruitEndDate: toDbDate('2030-01-15') });
    const [first, second] = await insertApplications(project.id, 2);
    const at = (iso) => createApplicationService({ prisma, clock: () => new Date(iso) });

    await expect(
      at('2030-01-15T15:00:00.000Z').reject(users.client.id, first),
    ).rejects.toMatchObject({ status: 409, details: { projectStatus: 'CLOSED' } });
    await expect(
      at('2030-01-15T15:00:00.000Z').accept(users.client.id, first),
    ).rejects.toMatchObject({ status: 409, details: { projectStatus: 'CLOSED' } });

    const result = await at('2030-01-15T14:59:59.999Z').accept(users.client.id, second);
    expect(result).toMatchObject({ application: { id: second, status: 'ACCEPTED' } });
    expect(result.autoRejectedCount).toBe(1);
    const stored = await projectRow(project.id);
    expect(stored.closedAt.toISOString()).toBe('2030-01-15T14:59:59.999Z');
  });
});

describe('concurrency on real PostgreSQL transactions', () => {
  it('lets exactly one of two concurrent accepts win and rejects the other', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { project, ids } = await projectWithApplicants(3);
      const results = await Promise.all([
        accept(users.client, ids[0]),
        accept(users.client, ids[1]),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const loser = results.find((res) => res.status === 409);
      expect(loser.body.error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        details: { projectStatus: 'CONTRACTING' },
      });
      const winnerId = results.find((res) => res.status === 200).body.data.application.id;

      const rows = await rowsOf(project.id);
      expect(rows.filter((row) => row.status === 'ACCEPTED').map((row) => row.id)).toEqual([
        winnerId,
      ]);
      expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(0);
      const decidedAt = rows.find((row) => row.id === winnerId).decidedAt;
      for (const row of rows.filter((r) => r.id !== winnerId)) {
        expect(row).toMatchObject({ status: 'REJECTED', rejectReason: 'OTHER_ACCEPTED' });
        expect(row.decidedAt).toEqual(decidedAt);
      }
      expect(await projectRow(project.id)).toMatchObject({
        status: 'CONTRACTING',
        closedAt: decidedAt,
      });
    }
  });

  it('keeps one winner when five different applicants are accepted at once', async () => {
    const { project, ids } = await projectWithApplicants(5);
    const results = await Promise.all(ids.map((id) => accept(users.client, id)));
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(4);
    const counts = await prisma.application.groupBy({
      by: ['status'],
      where: { projectId: project.id },
      _count: { _all: true },
    });
    expect(Object.fromEntries(counts.map((c) => [c.status, c._count._all]))).toEqual({
      ACCEPTED: 1,
      REJECTED: 4,
    });
  });

  it('accepts the same application once when the request is repeated concurrently', async () => {
    const { project, ids } = await projectWithApplicants(2);
    const results = await Promise.all([1, 2, 3].map(() => accept(users.client, ids[0])));
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409]);
    expect(results.find((res) => res.status === 200).body.data.autoRejectedCount).toBe(1);
    const rows = await rowsOf(project.id);
    expect(rows.map((row) => row.status)).toEqual(['ACCEPTED', 'REJECTED']);
  });

  it('serializes an accept and a reject of different applicants into a consistent result', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { project, ids } = await projectWithApplicants(3);
      const [accepted, rejected] = await Promise.all([
        accept(users.client, ids[0]),
        reject(users.client, ids[1]),
      ]);
      expect(accepted.status).toBe(200);
      const rows = await rowsOf(project.id);
      const target = rows.find((row) => row.id === ids[1]);
      if (rejected.status === 200) {
        // 거절이 먼저 끝났다: 직접 거절이 남고 자동 거절은 나머지 1건뿐.
        expect(target.rejectReason).toBe('MANUAL');
        expect(accepted.body.data.autoRejectedCount).toBe(1);
      } else {
        expect(rejected.status).toBe(409);
        expect(target.rejectReason).toBe('OTHER_ACCEPTED');
        expect(accepted.body.data.autoRejectedCount).toBe(2);
      }
      expect(rows.map((row) => row.status)).toEqual(['ACCEPTED', 'REJECTED', 'REJECTED']);
    }
  });

  it('never leaves a pending application when someone applies during a selection', async () => {
    const { project, ids } = await projectWithApplicants(2);
    const [accepted, late] = await Promise.all([
      accept(users.client, ids[0]),
      apply(users.outsider, project.id),
    ]);
    expect(accepted.status).toBe(200);
    expect([201, 409]).toContain(late.status);
    const rows = await rowsOf(project.id);
    expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(0);
    expect(rows.filter((row) => row.status === 'ACCEPTED')).toHaveLength(1);
    expect(accepted.body.data.autoRejectedCount).toBe(rows.length - 1);
  });

  it('waits for a concurrent delete holding the project lock and then refuses', async () => {
    const { project, ids } = await projectWithApplicants(1);
    let pending;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`;
        pending = accept(users.client, ids[0]).then((res) => res);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tx.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
      },
      { timeout: 10_000 },
    );
    const res = await pending;
    expect(res.status).toBe(404);
    expect((await rowsOf(project.id))[0].status).toBe('PENDING');
  });
});

describe('rollback when a step inside the decision transaction fails (D-54)', () => {
  const failing = () =>
    createApplicationService({
      prisma,
      afterDecision: async () => {
        throw new Error('simulated notification failure');
      },
    });

  it('rolls back the selection, the auto-rejections and the project status together', async () => {
    const { project, ids } = await projectWithApplicants(3);
    await reject(users.client, ids[2]);
    const before = await snapshot(project.id);

    await expect(failing().accept(users.client.id, ids[0])).rejects.toThrow(
      'simulated notification failure',
    );
    expect(await snapshot(project.id)).toEqual(before);

    // 실패 뒤에도 정상 요청은 처리된다.
    expect((await accept(users.client, ids[0])).status).toBe(200);
  });

  it('rolls back a manual rejection too', async () => {
    const { project, ids } = await projectWithApplicants(1);
    const before = await snapshot(project.id);
    await expect(failing().reject(users.client.id, ids[0])).rejects.toThrow();
    expect(await snapshot(project.id)).toEqual(before);
  });

  it('turns a partial UNIQUE violation into 409 instead of a server error', async () => {
    const { project, ids } = await projectWithApplicants(2);
    // 잠금을 거치지 않는 쓰기가 끼어든 상황을 흉내 낸다: afterDecision에서 다른 지원을 ACCEPTED로 바꾼다.
    const sneaky = createApplicationService({
      prisma,
      afterDecision: async (tx) => {
        await tx.application.update({
          where: { id: ids[1] },
          data: { status: 'ACCEPTED', rejectReason: null, decidedAt: new Date() },
        });
      },
    });
    const before = await snapshot(project.id);
    await expect(sneaky.accept(users.client.id, ids[0])).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
    });
    expect(await snapshot(project.id)).toEqual(before);
  });
});
