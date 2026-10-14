// 프로젝트 지원(APP-01·03·04)과 지원에 따른 프로젝트 변화(PRJ-02 myApplication·applicantCount, D-06, D-07)
// 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
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
const runId = `a${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const BIG_AMOUNT = '9007199254740993123';

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
const validBody = (overrides = {}) => ({
  coverLetter: '  React와 Node.js로 쇼핑몰을 3건 만들었습니다.  ',
  proposedAmount: '2500000',
  proposedDurationDays: 30,
  ...overrides,
});

const apply = (user, projectId, body = validBody()) => {
  const req = request(app).post(`/api/projects/${projectId}/applications`);
  if (user) req.set(bearer(user));
  return req.send(body);
};
const myApplications = (user, query = {}) =>
  request(app).get('/api/me/applications').set(bearer(user)).query(query);
const getApplication = (user, id) => request(app).get(`/api/applications/${id}`).set(bearer(user));
const getProject = (id, user) => {
  const req = request(app).get(`/api/projects/${id}`);
  if (user) req.set(bearer(user));
  return req;
};

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `지원${name}`, email: email(name), password: PASSWORD, role });
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

/** 날짜가 지났거나 API로 만들 수 없는 상태(거래 단계·취소)는 테스트 DB에 직접 넣는다. */
function insertProject(data = {}) {
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `지원 대상 ${runId}`,
      description: '지원 테스트용 프로젝트',
      category: 'WEB',
      recruitEndDate: toDbDate(day(10)),
      budget: 3_000_000n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: [{ techStackId: stack.id }] },
    },
  });
}

const countFor = (projectId) => prisma.application.count({ where: { projectId } });

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `A stack ${runId}`, normalizedName: `astack${runId}` },
  });

  users.client = await signup('client', 'CLIENT');
  const clientProfile = await request(app)
    .put('/api/users/me/client-profile')
    .set(bearer(users.client))
    .send({ companyName: '지원테스트 주식회사', businessField: 'IT' });
  expect(clientProfile.status).toBe(200);

  users.otherClient = await signup('client2', 'CLIENT');
  users.freelancer = await signup('freelancer', 'FREELANCER');
  users.other = await signup('freelancer2', 'FREELANCER');
  users.racer = await signup('freelancer3', 'FREELANCER');
  users.incomplete = await signup('freelancer4', 'FREELANCER');
  for (const user of [users.freelancer, users.other, users.racer]) await completeFreelancer(user);

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

describe('applications schema', () => {
  it('has the ERD constraints, foreign keys and indexes in the catalog', async () => {
    const constraints = await prisma.$queryRaw`
      SELECT conname, contype::text AS type, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = 'applications'::regclass AND contype <> 'n'
      ORDER BY conname`;
    const byName = Object.fromEntries(constraints.map((c) => [c.conname, c]));
    expect(Object.keys(byName)).toEqual([
      'applications_decided_at_check',
      'applications_freelancer_id_fkey',
      'applications_pkey',
      'applications_project_id_fkey',
      'applications_proposed_amount_check',
      'applications_proposed_duration_days_check',
      'applications_reject_reason_check',
    ]);
    expect(byName.applications_project_id_fkey.def).toMatch(
      /REFERENCES projects\(id\) ON UPDATE CASCADE ON DELETE RESTRICT/,
    );
    expect(byName.applications_freelancer_id_fkey.def).toMatch(
      /REFERENCES users\(id\) ON UPDATE CASCADE ON DELETE RESTRICT/,
    );

    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'applications' ORDER BY indexname`;
    const defs = Object.fromEntries(indexes.map((i) => [i.indexname, i.indexdef]));
    expect(defs.applications_project_id_freelancer_id_key).toMatch(
      /CREATE UNIQUE INDEX .* \(project_id, freelancer_id\)/,
    );
    expect(defs.applications_project_id_status_idx).toMatch(/\(project_id, status\)/);
    expect(defs.applications_freelancer_id_created_at_idx).toMatch(
      /\(freelancer_id, created_at DESC\)/,
    );

    const [types] = await prisma.$queryRaw`
      SELECT
        (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum
          WHERE enumtypid = 'application_status'::regtype) AS statuses,
        (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'applications' AND column_name = 'proposed_amount') AS amount_type`;
    expect(types).toEqual({ statuses: ['PENDING', 'ACCEPTED', 'REJECTED'], amount_type: 'bigint' });

    const projectChecks = await prisma.$queryRaw`
      SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c'
      ORDER BY conname`;
    expect(projectChecks.map((c) => c.conname)).toEqual([
      'projects_budget_check',
      'projects_recruit_dates_check',
    ]);
  });

  it('rejects rows that break the CHECK and foreign key rules', async () => {
    const project = await insertProject();
    const base = {
      projectId: project.id,
      freelancerId: users.other.id,
      coverLetter: 'x',
      proposedAmount: 1n,
      proposedDurationDays: 1,
    };
    const attempts = [
      { ...base, proposedAmount: 0n },
      { ...base, proposedDurationDays: 0 },
      { ...base, rejectReason: 'MANUAL' },
      { ...base, status: 'REJECTED', decidedAt: new Date() },
      { ...base, status: 'ACCEPTED' },
      { ...base, projectId: 2147483000 },
    ];
    for (const data of attempts) {
      await expect(prisma.application.create({ data })).rejects.toThrow();
    }
    expect(await countFor(project.id)).toBe(0);
  });
});

describe('POST /api/projects/:projectId/applications permissions', () => {
  it('checks login, role, freelancer role, profile, project in that order', async () => {
    const project = await insertProject();

    const anonymous = await apply(null, project.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const noRole = await apply(users.noRole, project.id);
    expect(noRole.status).toBe(403);
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');

    const client = await apply(users.client, project.id);
    expect(client.status).toBe(403);
    expect(client.body.error.code).toBe('FORBIDDEN');

    const incomplete = await apply(users.incomplete, project.id);
    expect(incomplete.status).toBe(403);
    expect(incomplete.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incomplete.body.error.details.missingFields).toEqual(
      expect.arrayContaining(['mainCategory', 'techStacks', 'careerYears', 'hourlyRate']),
    );

    // 프로필 확인이 프로젝트 확인보다 먼저다(없는 프로젝트여도 PROFILE_INCOMPLETE).
    const incompleteMissing = await apply(users.incomplete, 2147483000);
    expect(incompleteMissing.body.error.code).toBe('PROFILE_INCOMPLETE');

    for (const id of [2147483000, 'abc', '0', '1e3']) {
      const res = await apply(users.freelancer, id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(await countFor(project.id)).toBe(0);
  });
});

describe('POST /api/projects/:projectId/applications', () => {
  it('creates a PENDING application for the authenticated freelancer only', async () => {
    const project = await insertProject();
    const res = await apply(
      users.freelancer,
      project.id,
      validBody({ proposedAmount: BIG_AMOUNT }),
    );

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({
      projectId: project.id,
      coverLetter: 'React와 Node.js로 쇼핑몰을 3건 만들었습니다.',
      proposedAmount: BIG_AMOUNT,
      proposedDurationDays: 30,
      status: 'PENDING',
      rejectReason: null,
      decidedAt: null,
      project: {
        id: project.id,
        title: project.title,
        budget: '3000000',
        publicStatus: 'RECRUITING',
        isDeleted: false,
      },
    });
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'coverLetter',
        'createdAt',
        'decidedAt',
        'id',
        'project',
        'projectId',
        'proposedAmount',
        'proposedDurationDays',
        'rejectReason',
        'status',
        'updatedAt',
      ].sort(),
    );
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@workbridge.test');
    expect(text).not.toContain('clientId');
    expect(text).not.toContain('freelancerId');

    const row = await prisma.application.findUnique({ where: { id: res.body.data.id } });
    expect(row).toMatchObject({
      freelancerId: users.freelancer.id,
      status: 'PENDING',
      proposedAmount: BigInt(BIG_AMOUNT),
    });
  });

  it('refuses server-only fields and reports invalid input after the permission checks', async () => {
    const project = await insertProject();
    const spoofed = await apply(
      users.freelancer,
      project.id,
      validBody({ freelancerId: users.other.id, status: 'ACCEPTED' }),
    );
    expect(spoofed.status).toBe(400);
    expect(Object.keys(spoofed.body.error.details.fields).sort()).toEqual([
      'freelancerId',
      'status',
    ]);

    const invalid = await apply(users.freelancer, project.id, {
      coverLetter: '   ',
      proposedAmount: '0',
      proposedDurationDays: 1.5,
    });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.error.details.fields).sort()).toEqual([
      'coverLetter',
      'proposedAmount',
      'proposedDurationDays',
    ]);
    expect(await countFor(project.id)).toBe(0);
  });

  it('rejects a second application with 409 ALREADY_APPLIED and keeps one row', async () => {
    const project = await insertProject();
    const first = await apply(users.freelancer, project.id);
    expect(first.status).toBe(201);

    const second = await apply(users.freelancer, project.id, validBody({ proposedAmount: '1' }));
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ALREADY_APPLIED',
      details: { applicationId: first.body.data.id },
    });
    // 이미 지원했다면 입력이 틀려도 중복을 먼저 알린다.
    const invalidAgain = await apply(users.freelancer, project.id, {});
    expect(invalidAgain.body.error.code).toBe('ALREADY_APPLIED');

    const rows = await prisma.application.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].proposedAmount).toBe(2_500_000n);
  });

  it('creates exactly one row when the same freelancer applies concurrently', async () => {
    const project = await insertProject();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => apply(users.racer, project.id)),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) {
      expect(res.body.error.code).toBe('ALREADY_APPLIED');
    }
    expect(await countFor(project.id)).toBe(1);
  });

  it('lets different freelancers apply to the same project', async () => {
    const project = await insertProject();
    expect((await apply(users.freelancer, project.id)).status).toBe(201);
    expect((await apply(users.other, project.id)).status).toBe(201);
    expect(await countFor(project.id)).toBe(2);
  });
});

describe('recruit status is decided by the server at apply time (D-34, D-83)', () => {
  const expectNotRecruiting = (res, currentStatus) => {
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { currentStatus },
    });
  };

  it('rejects scheduled, closed and contract-stage projects with their public status', async () => {
    const scheduled = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(day(1)),
      recruitEndDate: toDbDate(day(5)),
    });
    expectNotRecruiting(await apply(users.freelancer, scheduled.id), 'SCHEDULED');

    const closed = await insertProject({ status: 'CLOSED', closedAt: new Date() });
    expectNotRecruiting(await apply(users.freelancer, closed.id), 'CLOSED');

    for (const status of ['CONTRACTING', 'IN_PROGRESS', 'COMPLETED']) {
      const project = await insertProject({ status });
      expectNotRecruiting(await apply(users.freelancer, project.id), 'CLOSED');
      expect(await countFor(project.id)).toBe(0);
    }
  });

  it('hides cancelled and deleted projects with 404', async () => {
    const cancelled = await insertProject({ status: 'CANCELLED', cancelledAt: new Date() });
    const deleted = await insertProject({ deletedAt: new Date() });
    for (const project of [cancelled, deleted]) {
      const res = await apply(users.freelancer, project.id);
      expect(res.status).toBe(404);
      expect(await countFor(project.id)).toBe(0);
    }
  });

  it('uses the date, not the stored status: past deadline is closed, deadline today is open', async () => {
    const expired = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    expectNotRecruiting(await apply(users.freelancer, expired.id), 'CLOSED');

    const startedToday = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(today),
      recruitEndDate: toDbDate(day(3)),
    });
    expect((await apply(users.freelancer, startedToday.id)).status).toBe(201);

    const endsToday = await insertProject({ recruitEndDate: toDbDate(today) });
    expect((await apply(users.freelancer, endsToday.id)).status).toBe(201);

    // 지원 요청도, 조회(GET)도 저장된 상태를 바꾸지 않는다(D-83).
    await getProject(expired.id, users.freelancer);
    await myApplications(users.freelancer);
    const stored = await prisma.project.findMany({
      where: { id: { in: [expired.id, startedToday.id] } },
      orderBy: { id: 'asc' },
      select: { status: true, closedAt: true, updatedAt: true },
    });
    expect(stored.map((p) => p.status)).toEqual(['RECRUITING', 'SCHEDULED']);
    expect(stored[0].closedAt).toBeNull();
  });

  it('closes at 00:00 KST the day after the deadline regardless of the cron', async () => {
    const project = await insertProject({ recruitEndDate: toDbDate('2030-01-15') });
    const at = (iso) => createApplicationService({ prisma, clock: () => new Date(iso) });

    const late = at('2030-01-15T15:00:00.000Z'); // 2030-01-16 00:00 KST
    await expect(late.apply(users.other.id, project.id, validBody())).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
    });

    const lastMoment = at('2030-01-15T14:59:59.999Z'); // 2030-01-15 23:59:59.999 KST
    const created = await lastMoment.apply(users.other.id, project.id, validBody());
    expect(created.status).toBe('PENDING');
    expect(created.project.publicStatus).toBe('RECRUITING');
  });

  it('waits for a concurrent delete and then refuses the application', async () => {
    const project = await insertProject();
    let pending;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`;
        pending = apply(users.freelancer, project.id).then((res) => res);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tx.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
      },
      { timeout: 10_000 },
    );
    const res = await pending;
    expect(res.status).toBe(404);
    expect(await countFor(project.id)).toBe(0);
  });

  it('waits for a concurrent status change to contract stage and then refuses', async () => {
    const project = await insertProject();
    let pending;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`;
        pending = apply(users.freelancer, project.id).then((res) => res);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tx.project.update({ where: { id: project.id }, data: { status: 'CONTRACTING' } });
      },
      { timeout: 10_000 },
    );
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.error.details.currentStatus).toBe('CLOSED');
    expect(await countFor(project.id)).toBe(0);
  });
});

describe('GET /api/me/applications and /api/applications/:id', () => {
  it('lists only my applications, newest first, with pagination and status filter', async () => {
    const projects = [await insertProject(), await insertProject(), await insertProject()];
    for (const project of projects) {
      expect((await apply(users.other, project.id)).status).toBe(201);
    }
    expect((await apply(users.freelancer, projects[0].id)).status).toBe(201);

    const res = await myApplications(users.other);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 10 });
    const mine = await prisma.application.findMany({
      where: { freelancerId: users.other.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true },
    });
    expect(res.body.data.map((a) => a.id)).toEqual(mine.map((a) => a.id));
    expect(res.body.pagination.totalCount).toBe(
      await prisma.application.count({ where: { freelancerId: users.other.id } }),
    );
    expect(JSON.stringify(res.body)).not.toContain('@workbridge.test');

    const pending = await myApplications(users.other, { status: 'PENDING' });
    expect(pending.body.data.every((a) => a.status === 'PENDING')).toBe(true);
    const rejected = await myApplications(users.other, { status: 'REJECTED' });
    expect(rejected.body.data.every((a) => a.status === 'REJECTED')).toBe(true);

    expect((await myApplications(users.other, { status: 'WITHDRAWN' })).status).toBe(400);
    expect((await myApplications(users.other, { page: '0' })).status).toBe(400);
    const beyond = await myApplications(users.other, { page: '999' });
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual([]);
  });

  it('blocks clients and role-less users from the freelancer list', async () => {
    const client = await myApplications(users.client);
    expect(client.status).toBe(403);
    expect(client.body.error.code).toBe('FORBIDDEN');
    expect((await myApplications(users.noRole)).body.error.code).toBe('ROLE_REQUIRED');
    expect((await request(app).get('/api/me/applications')).status).toBe(401);
  });

  it("returns my application by id and hides other users' applications with 404", async () => {
    const project = await insertProject();
    const created = await apply(users.freelancer, project.id);
    const id = created.body.data.id;

    const own = await getApplication(users.freelancer, id);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ id, status: 'PENDING', projectId: project.id });

    // STEP 06-B부터 프로젝트 소유자도 열람한다(APP-03). 그 밖의 사용자는 그대로 404.
    const owner = await getApplication(users.client, id);
    expect(owner.status).toBe(200);
    expect(owner.body.data.freelancer.id).toBe(users.freelancer.id);
    for (const user of [users.other, users.otherClient]) {
      const res = await getApplication(user, id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await getApplication(users.freelancer, 'abc')).status).toBe(404);
    expect((await request(app).get(`/api/applications/${id}`)).status).toBe(401);
  });
});

describe('project detail and owner rules after applications', () => {
  it('shows myApplication only to freelancers and counts applicants', async () => {
    const project = await insertProject();
    const before = await getProject(project.id, users.freelancer);
    expect(before.body.data).toMatchObject({ applicantCount: 0, myApplication: null });

    const created = await apply(users.freelancer, project.id);
    const after = await getProject(project.id, users.freelancer);
    expect(after.body.data.applicantCount).toBe(1);
    expect(after.body.data.myApplication).toEqual({
      id: created.body.data.id,
      status: 'PENDING',
      rejectReason: null,
      createdAt: created.body.data.createdAt,
    });

    const anonymous = await getProject(project.id);
    expect(anonymous.body.data.applicantCount).toBe(1);
    expect(anonymous.body.data).not.toHaveProperty('myApplication');
    const owner = await getProject(project.id, users.client);
    expect(owner.body.data).not.toHaveProperty('myApplication');
    const otherFreelancer = await getProject(project.id, users.other);
    expect(otherFreelancer.body.data.myApplication).toBeNull();

    const search = await request(app).get('/api/projects').query({ q: runId, sort: 'latest' });
    const item = search.body.data.find((p) => p.id === project.id);
    expect(item?.applicantCount).toBe(1);
  });

  it('locks budget and deadline for the owner while applications are pending (D-06)', async () => {
    const project = await insertProject();
    await apply(users.freelancer, project.id);

    const owner = await getProject(project.id, users.client);
    expect(owner.body.data.lockedFields).toEqual(['budget', 'recruitEndDate']);

    for (const body of [{ budget: '1' }, { recruitEndDate: day(20) }]) {
      const res = await request(app)
        .patch(`/api/projects/${project.id}`)
        .set(bearer(users.client))
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FIELD_LOCKED');
    }
    const sameBudget = await request(app)
      .patch(`/api/projects/${project.id}`)
      .set(bearer(users.client))
      .send({ budget: '3000000', title: `제목 변경 ${runId}` });
    expect(sameBudget.status).toBe(200);
    expect(sameBudget.body.data.lockedFields).toEqual(['budget', 'recruitEndDate']);

    const mine = await request(app).get('/api/me/projects').set(bearer(users.client));
    expect(mine.body.data.find((p) => p.id === project.id).lockedFields).toEqual([
      'budget',
      'recruitEndDate',
    ]);
  });

  it('rejects pending applications when the project is deleted and keeps them visible (D-07, A-35)', async () => {
    const project = await insertProject();
    const created = await apply(users.freelancer, project.id);

    const removed = await request(app)
      .delete(`/api/projects/${project.id}`)
      .set(bearer(users.client));
    expect(removed.status).toBe(204);

    const own = await getApplication(users.freelancer, created.body.data.id);
    expect(own.body.data).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'PROJECT_DELETED',
      project: { id: project.id, isDeleted: true, publicStatus: 'CLOSED' },
    });
    expect(own.body.data.decidedAt).not.toBeNull();
    const list = await myApplications(users.freelancer);
    expect(list.body.data.some((a) => a.id === created.body.data.id)).toBe(true);
    expect((await getProject(project.id, users.freelancer)).status).toBe(404);
  });

  it('lets an applicant still open a cancelled project while others get 404', async () => {
    const project = await insertProject();
    await apply(users.freelancer, project.id);
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const applicant = await getProject(project.id, users.freelancer);
    expect(applicant.status).toBe(200);
    expect(applicant.body.data.publicStatus).toBe('CLOSED');
    expect(applicant.body.data.myApplication.status).toBe('PENDING');
    expect((await getProject(project.id, users.other)).status).toBe(404);
    expect((await getProject(project.id)).status).toBe(404);
  });
});
