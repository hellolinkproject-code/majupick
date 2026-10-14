// 프로젝트 등록·조회·수정·소프트 삭제(PRJ-01~05) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트·기술 스택(runId 이름)만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `j${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const BIG_BUDGET = '9007199254740993123';

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

let prisma;
let app;
let stacks;
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
    .send({ name: `테스트${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

const projectBody = (overrides = {}) => ({
  title: `  쇼핑몰 리뉴얼 ${runId} `,
  description: ' 반응형 쇼핑몰 프론트엔드와 관리자 화면 개발 ',
  category: 'WEB',
  recruitStartDate: today,
  recruitEndDate: day(21),
  budget: BIG_BUDGET,
  techStackIds: [stacks[0].id, stacks[1].id],
  ...overrides,
});

const create = (user, body = projectBody(), key = randomUUID()) => {
  const req = request(app).post('/api/projects');
  if (user) req.set(bearer(user));
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};
const getProject = (id, user) => {
  const req = request(app).get(`/api/projects/${id}`);
  if (user) req.set(bearer(user));
  return req;
};
const patch = (user, id, body) =>
  request(app).patch(`/api/projects/${id}`).set(bearer(user)).send(body);
const remove = (user, id) => request(app).delete(`/api/projects/${id}`).set(bearer(user));
const myProjects = (user, query = {}) =>
  request(app).get('/api/me/projects').set(bearer(user)).query(query);

/** API로 만들 수 없는 상태(거래 단계·날짜 경과)는 테스트 DB에 직접 넣는다. */
function insertProject(clientId, data = {}) {
  return prisma.project.create({
    data: {
      clientId,
      title: `직접 생성 ${runId}`,
      description: '설명',
      category: 'DESIGN',
      recruitEndDate: toDbDate(day(10)),
      budget: 1000n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: [{ techStackId: stacks[0].id }] },
    },
  });
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });

  stacks = [];
  for (const label of ['alpha', 'beta', 'gamma']) {
    stacks.push(
      await prisma.techStack.create({
        data: { name: `P ${label} ${runId}`, normalizedName: `p${label}${runId}` },
      }),
    );
  }

  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('client2', 'CLIENT');
  users.incompleteClient = await signup('client3', 'CLIENT');
  users.freelancer = await signup('freelancer', 'FREELANCER');
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };

  for (const user of [users.client, users.otherClient]) {
    const res = await request(app)
      .put('/api/users/me/client-profile')
      .set(bearer(user))
      .send({ companyName: '워크브릿지', businessField: 'IT' });
    expect(res.status).toBe(200);
  }
  const freelancer = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(users.freelancer))
    .send({
      mainCategory: 'WEB',
      techStackIds: [stacks[0].id],
      careerYears: 3,
      hourlyRate: '50000',
    });
  expect(freelancer.status).toBe(200);
});

afterAll(async () => {
  if (prisma) {
    const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
    await prisma.project.deleteMany({ where: { client: runUsers } });
    await prisma.user.deleteMany({ where: runUsers });
    await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
    await prisma.$disconnect();
  }
});

const countOwn = (user) => prisma.project.count({ where: { clientId: user.id } });

describe('POST /api/projects permissions (login → role → client → profile)', () => {
  it('checks login, role selection, client role and profile completion in order', async () => {
    const anonymous = await create(null);
    expect(anonymous.status).toBe(401);

    const noRole = await create(users.noRole, {});
    expect(noRole.status).toBe(403);
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');

    const freelancer = await create(users.freelancer);
    expect(freelancer.status).toBe(403);
    expect(freelancer.body.error.code).toBe('FORBIDDEN');

    const incomplete = await create(users.incompleteClient, {});
    expect(incomplete.status).toBe(403);
    expect(incomplete.body.error).toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      details: { missingFields: ['companyName', 'businessField'] },
    });

    expect(await countOwn(users.freelancer)).toBe(0);
    expect(await countOwn(users.incompleteClient)).toBe(0);
  });

  it('validates the body and the idempotency key before saving', async () => {
    const invalid = await create(users.client, {
      ...projectBody(),
      recruitStartDate: day(-1),
      recruitEndDate: day(-2),
      budget: '0',
    });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.details.fields).sort()).toEqual([
      'budget',
      'recruitEndDate',
      'recruitStartDate',
    ]);

    const noKey = await create(users.client, projectBody(), null);
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.details.fields).toHaveProperty('idempotencyKey');

    const { _max } = await prisma.techStack.aggregate({ _max: { id: true } });
    const unknown = await create(users.client, projectBody({ techStackIds: [_max.id + 100000] }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.fields).toHaveProperty('techStackIds');

    expect(await countOwn(users.client)).toBe(0);
  });
});

describe('POST /api/projects (PRJ-01)', () => {
  it('stores the project in PostgreSQL with the exact bigint budget and tech stack links', async () => {
    const res = await create(users.client, { ...projectBody(), clientId: users.otherClient.id });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({
      title: `쇼핑몰 리뉴얼 ${runId}`,
      description: '반응형 쇼핑몰 프론트엔드와 관리자 화면 개발',
      category: 'WEB',
      budget: BIG_BUDGET,
      recruitStartDate: today,
      recruitEndDate: day(21),
      publicStatus: 'RECRUITING',
      status: 'RECRUITING',
      isOwner: true,
      availableActions: ['EDIT', 'DELETE', 'CLOSE', 'CANCEL'],
      applicantCount: 0,
      client: { id: users.client.id, companyName: '워크브릿지' },
    });
    expect(res.body.data.techStacks.map((s) => s.id).sort()).toEqual(
      [stacks[0].id, stacks[1].id].sort(),
    );

    const stored = await prisma.project.findUnique({
      where: { id: res.body.data.id },
      include: { techStacks: true },
    });
    expect(stored).toMatchObject({
      clientId: users.client.id,
      budget: BigInt(BIG_BUDGET),
      status: 'RECRUITING',
      deletedAt: null,
    });
    expect(stored.techStacks).toHaveLength(2);
    expect(await countOwn(users.otherClient)).toBe(0);
  });

  it('schedules a project whose start date is in the future and accepts no start date', async () => {
    const scheduled = await create(users.client, projectBody({ recruitStartDate: day(3) }));
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data).toMatchObject({ status: 'SCHEDULED', publicStatus: 'SCHEDULED' });

    const immediate = await create(users.client, projectBody({ recruitStartDate: null }));
    expect(immediate.body.data).toMatchObject({ status: 'RECRUITING', recruitStartDate: null });
  });

  it('does not create duplicates for the same idempotency key, even concurrently', async () => {
    const key = randomUUID();
    const before = await countOwn(users.client);
    const [first, second] = await Promise.all([
      create(users.client, projectBody(), key),
      create(users.client, projectBody(), key),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);

    const retry = await create(users.client, projectBody({ title: '다른 제목' }), key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await countOwn(users.client)).toBe(before + 1);

    const otherUserSameKey = await create(users.otherClient, projectBody(), key);
    expect(otherUserSameKey.status).toBe(201);
    expect(otherUserSameKey.body.data.id).not.toBe(first.body.data.id);
  });
});

describe('GET /api/projects/:id (PRJ-02)', () => {
  let project;
  beforeAll(async () => {
    project = (await create(users.client)).body.data;
  });

  it('shows the public view without login and the owner view to the owner', async () => {
    const anonymous = await getProject(project.id);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data).toMatchObject({
      id: project.id,
      isOwner: false,
      budget: BIG_BUDGET,
    });
    expect(anonymous.body.data).not.toHaveProperty('status');
    expect(JSON.stringify(anonymous.body)).not.toMatch(/email|passwordHash|idempotency/i);

    const other = await getProject(project.id, users.otherClient);
    expect(other.body.data.isOwner).toBe(false);
    expect(other.body.data).not.toHaveProperty('availableActions');

    const owner = await getProject(project.id, users.client);
    expect(owner.body.data).toMatchObject({ isOwner: true, status: 'RECRUITING' });
  });

  it('returns 404 for unknown or malformed IDs and 401 for a bad token', async () => {
    expect((await getProject(2147483647)).status).toBe(404);
    expect((await getProject('abc')).status).toBe(404);
    const badToken = await request(app)
      .get(`/api/projects/${project.id}`)
      .set('Authorization', 'Bearer not-a-token');
    expect(badToken.status).toBe(401);
  });

  it('shows the date-based status on read without writing, and stores it on the next edit (D-83)', async () => {
    const started = await insertProject(users.client.id, {
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(today),
    });
    const expired = await insertProject(users.client.id, {
      recruitStartDate: toDbDate(day(-10)),
      recruitEndDate: toDbDate(day(-1)),
    });

    expect((await getProject(started.id, users.client)).body.data.status).toBe('RECRUITING');
    expect((await getProject(started.id)).body.data.publicStatus).toBe('RECRUITING');
    const closed = await getProject(expired.id, users.client);
    expect(closed.body.data).toMatchObject({
      status: 'CLOSED',
      publicStatus: 'CLOSED',
      lockedFields: ['recruitStartDate', 'recruitEndDate'],
    });
    const mine = await myProjects(users.client);
    expect(mine.body.data.find((p) => p.id === expired.id)?.status).toBe('CLOSED');

    const unchanged = await prisma.project.findMany({
      where: { id: { in: [started.id, expired.id] } },
      orderBy: { id: 'asc' },
    });
    expect(unchanged.map((p) => [p.status, p.closedAt, p.updatedAt])).toEqual([
      ['SCHEDULED', null, started.updatedAt],
      ['RECRUITING', null, expired.updatedAt],
    ]);

    expect((await patch(users.client, started.id, { title: '시작일 도래' })).status).toBe(200);
    expect((await patch(users.client, expired.id, { title: '마감일 경과' })).status).toBe(200);
    const stored = await prisma.project.findMany({
      where: { id: { in: [started.id, expired.id] } },
      orderBy: { id: 'asc' },
    });
    expect(stored.map((p) => p.status)).toEqual(['RECRUITING', 'CLOSED']);
    expect(stored[1].closedAt).toBeInstanceOf(Date);
  });

  it('hides cancelled projects from everyone but the owner', async () => {
    const cancelled = await insertProject(users.client.id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    });
    expect((await getProject(cancelled.id)).status).toBe(404);
    expect((await getProject(cancelled.id, users.otherClient)).status).toBe(404);
    const owner = await getProject(cancelled.id, users.client);
    expect(owner.body.data).toMatchObject({ status: 'CANCELLED', availableActions: [] });
  });
});

describe('PATCH /api/projects/:id (PRJ-03)', () => {
  let project;
  beforeAll(async () => {
    project = (await create(users.client)).body.data;
  });

  it('lets only the owning client edit', async () => {
    const other = await patch(users.otherClient, project.id, { title: '탈취' });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('FORBIDDEN');

    const freelancer = await patch(users.freelancer, project.id, { title: '탈취' });
    expect(freelancer.status).toBe(403);

    const anonymous = await request(app).patch(`/api/projects/${project.id}`).send({ title: 'x' });
    expect(anonymous.status).toBe(401);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored.title).toBe(project.title);
  });

  it('updates fields, keeps the bigint budget exact and replaces the tech stack links', async () => {
    const res = await patch(users.client, project.id, {
      title: ' 수정한 제목 ',
      category: 'MOBILE',
      budget: '9223372036854775807',
      techStackIds: [stacks[2].id],
      status: undefined,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: '수정한 제목',
      category: 'MOBILE',
      budget: '9223372036854775807',
      techStacks: [{ id: stacks[2].id, name: stacks[2].name }],
      description: project.description,
    });

    const links = await prisma.projectTechStack.findMany({ where: { projectId: project.id } });
    expect(links.map((link) => link.techStackId)).toEqual([stacks[2].id]);
    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored.budget).toBe(9223372036854775807n);
  });

  it('recalculates the status from the start date and validates dates', async () => {
    const scheduled = await patch(users.client, project.id, { recruitStartDate: day(2) });
    expect(scheduled.body.data).toMatchObject({ status: 'SCHEDULED', recruitStartDate: day(2) });

    const recruiting = await patch(users.client, project.id, { recruitStartDate: null });
    expect(recruiting.body.data).toMatchObject({ status: 'RECRUITING', recruitStartDate: null });

    const past = await patch(users.client, project.id, { recruitStartDate: day(-1) });
    expect(past.status).toBe(400);
    expect(past.body.error.details.fields).toHaveProperty('recruitStartDate');

    const order = await patch(users.client, project.id, {
      recruitStartDate: day(5),
      recruitEndDate: day(4),
    });
    expect(order.status).toBe(400);
    expect(order.body.error.details.fields).toHaveProperty('recruitEndDate');

    const status = await patch(users.client, project.id, { status: 'COMPLETED' });
    expect(status.status).toBe(400);

    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored.status).toBe('RECRUITING');
  });

  it('keeps an unchanged past start date valid while editing other fields', async () => {
    const running = await insertProject(users.client.id, {
      recruitStartDate: toDbDate(day(-3)),
    });
    const res = await patch(users.client, running.id, {
      recruitStartDate: day(-3),
      recruitEndDate: day(30),
      description: '새 설명',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ recruitStartDate: day(-3), recruitEndDate: day(30) });
  });

  it('locks the recruiting period after closing and everything after contracting', async () => {
    const closed = await insertProject(users.client.id, { status: 'CLOSED', closedAt: new Date() });
    const dates = await patch(users.client, closed.id, { recruitEndDate: day(40) });
    expect(dates.status).toBe(409);
    expect(dates.body.error).toMatchObject({
      code: 'FIELD_LOCKED',
      details: { currentStatus: 'CLOSED' },
    });
    expect((await patch(users.client, closed.id, { title: '마감 후 제목' })).status).toBe(200);

    const contracting = await insertProject(users.client.id, { status: 'CONTRACTING' });
    const locked = await patch(users.client, contracting.id, { title: '계약 중 수정' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('FIELD_LOCKED');

    const cancelled = await insertProject(users.client.id, { status: 'CANCELLED' });
    const cancelledRes = await patch(users.client, cancelled.id, { title: '취소 후 수정' });
    expect(cancelledRes.status).toBe(409);
    expect(cancelledRes.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('DELETE /api/projects/:id (PRJ-04 soft delete)', () => {
  it('blocks other users and keeps the row', async () => {
    const project = (await create(users.client)).body.data;
    expect((await remove(users.otherClient, project.id)).status).toBe(403);
    expect((await remove(users.freelancer, project.id)).status).toBe(403);
    const stored = await prisma.project.findUnique({ where: { id: project.id } });
    expect(stored.deletedAt).toBeNull();
  });

  it('soft deletes: the row stays, but detail, edit and my list no longer show it', async () => {
    const project = (await create(users.client)).body.data;
    const res = await remove(users.client, project.id);
    expect(res.status).toBe(204);

    const stored = await prisma.project.findUnique({
      where: { id: project.id },
      include: { techStacks: true },
    });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect(stored.techStacks).toHaveLength(2);

    expect((await getProject(project.id, users.client)).status).toBe(404);
    expect((await patch(users.client, project.id, { title: '삭제 후' })).status).toBe(404);
    expect((await remove(users.client, project.id)).status).toBe(404);
    const list = await myProjects(users.client, { page: 1 });
    expect(list.body.data.map((p) => p.id)).not.toContain(project.id);
  });

  it('refuses to delete projects in the deal stage', async () => {
    const contracting = await insertProject(users.client.id, { status: 'CONTRACTING' });
    const res = await remove(users.client, contracting.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { currentStatus: 'CONTRACTING' },
    });
    const stored = await prisma.project.findUnique({ where: { id: contracting.id } });
    expect(stored.deletedAt).toBeNull();
  });
});

describe('GET /api/me/projects (PRJ-05)', () => {
  it('lists only my projects, newest first, 10 per page, with the internal status', async () => {
    const total = await prisma.project.count({
      where: { clientId: users.client.id, deletedAt: null },
    });
    const first = await myProjects(users.client);
    expect(first.status).toBe(200);
    expect(first.body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalCount: total,
      totalPages: Math.ceil(total / 10),
    });
    expect(first.body.data).toHaveLength(Math.min(total, 10));
    expect(first.body.data[0]).toHaveProperty('status');
    const times = first.body.data.map((p) => p.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const second = await myProjects(users.client, { page: 2 });
    const ids = new Set(first.body.data.map((p) => p.id));
    expect(second.body.data.every((p) => !ids.has(p.id))).toBe(true);

    const others = await myProjects(users.otherClient);
    const own = await prisma.project.findMany({
      where: { clientId: users.otherClient.id },
      select: { id: true },
    });
    expect(others.body.data.map((p) => p.id).sort()).toEqual(own.map((p) => p.id).sort());
  });

  it('is for clients only and validates the page', async () => {
    expect((await myProjects(users.freelancer)).status).toBe(403);
    expect((await myProjects(users.noRole)).body.error.code).toBe('ROLE_REQUIRED');
    expect((await myProjects(users.client, { page: 0 })).status).toBe(400);
    expect((await request(app).get('/api/me/projects')).status).toBe(401);
  });
});
