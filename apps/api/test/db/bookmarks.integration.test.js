// 북마크(BMK-01~03)·PRJ-02 isBookmarked·추천 프로젝트(SRCH-02) 통합 테스트.
// 실제 PostgreSQL(workbridge_test) + Supertest. 중복·동시 요청은 Mock 없이 실제 제약·트랜잭션으로 확인한다.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트·지원·알림·북마크·기술 스택만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { rankRecommendations } from '../../src/modules/projects/projectRecommendations.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `b${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const PRECISE_BUDGET = 9_007_199_254_740_993n;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

let prisma;
let app;
const users = {};
const stacks = {};
const today = todayKst();
const day = (offset) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });
const withAuth = (req, user) => (user ? req.set(bearer(user)) : req);
const bookmark = (user, projectId) =>
  withAuth(request(app).put(`/api/projects/${projectId}/bookmark`), user);
const unbookmark = (user, projectId) =>
  withAuth(request(app).delete(`/api/projects/${projectId}/bookmark`), user);
const myBookmarks = (user, query = {}) =>
  withAuth(request(app).get('/api/me/bookmarks'), user).query(query);
const detail = (user, projectId) => withAuth(request(app).get(`/api/projects/${projectId}`), user);
const recommendations = (projectId, user) =>
  withAuth(request(app).get(`/api/projects/${projectId}/recommendations`), user);

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `북마크${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken, name: `북마크${name}` };
}

let projectSeq = 0;
/**
 * 상태·날짜·등록 시각을 정확히 맞추기 위해 테스트 DB에 직접 넣는다.
 * 기본은 기술 스택 없음: 북마크용 프로젝트가 추천 후보에 섞이지 않게 한다.
 */
function insertProject({ stackIds = [], ...data } = {}) {
  projectSeq += 1;
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `북마크 대상 ${projectSeq} ${runId}`,
      description: `북마크·추천 테스트용 프로젝트 ${projectSeq}`,
      category: 'WEB',
      recruitEndDate: toDbDate(day(10)),
      budget: 3_000_000n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: stackIds.map((techStackId) => ({ techStackId })) },
    },
  });
}

const bookmarkRows = (where = {}) =>
  prisma.bookmark.findMany({ where: { user: runUsers, ...where }, orderBy: { projectId: 'asc' } });
const runProjects = () =>
  prisma.project.findMany({
    where: { client: runUsers },
    select: {
      id: true,
      status: true,
      closedAt: true,
      deletedAt: true,
      updatedAt: true,
      budget: true,
    },
    orderBy: { id: 'asc' },
  });

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
  for (const key of ['a', 'b', 'c', 'd']) {
    stacks[key] = await prisma.techStack.create({
      data: { name: `B${key} ${runId}`, normalizedName: `b${key}${runId}` },
    });
  }

  users.client = await signup('client', 'CLIENT');
  const res = await request(app)
    .put('/api/users/me/client-profile')
    .set(bearer(users.client))
    .send({ companyName: '북마크테스트 주식회사', businessField: 'IT' });
  expect(res.status).toBe(200);
  // 프로필을 채우지 않은 프리랜서: 북마크에는 프로필 완성이 필요 없다.
  users.freelancer = await signup('freelancer', 'FREELANCER');
  users.other = await signup('freelancer2', 'FREELANCER');
  const profile = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(users.other))
    .send({
      mainCategory: 'WEB',
      techStackIds: [stacks.a.id],
      careerYears: 3,
      hourlyRate: '50000',
    });
  expect(profile.status).toBe(200);
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.notification.deleteMany({ where: { user: runUsers } });
  await prisma.application.deleteMany({
    where: { OR: [{ freelancer: runUsers }, { project: { client: runUsers } }] },
  });
  await prisma.bookmark.deleteMany({
    where: { OR: [{ user: runUsers }, { project: { client: runUsers } }] },
  });
  await prisma.project.deleteMany({ where: { client: runUsers } });
  await prisma.user.deleteMany({ where: runUsers });
  await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
  await prisma.$disconnect();
});

describe('bookmarks table', () => {
  it('has a composite primary key, so the same user cannot save a project twice', async () => {
    const project = await insertProject();
    await prisma.bookmark.create({ data: { userId: users.freelancer.id, projectId: project.id } });
    await expect(
      prisma.bookmark.create({ data: { userId: users.freelancer.id, projectId: project.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const indexes = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes WHERE tablename = 'bookmarks' ORDER BY indexname`;
    expect(indexes.map((index) => index.indexname)).toEqual([
      'bookmarks_pkey',
      'bookmarks_project_id_idx',
      'bookmarks_user_id_created_at_project_id_idx',
    ]);
  });
});

describe('BMK-01·02 add and remove', () => {
  it('blocks guests (401), users without a role (ROLE_REQUIRED) and clients (403)', async () => {
    const project = await insertProject();
    for (const send of [bookmark, unbookmark]) {
      expect((await send(null, project.id)).status).toBe(401);
      const noRole = await send(users.noRole, project.id);
      expect([noRole.status, noRole.body.error.code]).toEqual([403, 'ROLE_REQUIRED']);
      const client = await send(users.client, project.id);
      expect([client.status, client.body.error.code]).toEqual([403, 'FORBIDDEN']);
    }
    expect(await bookmarkRows({ projectId: project.id })).toEqual([]);
  });

  it('lets a freelancer with an incomplete profile save, and repeats change nothing', async () => {
    const project = await insertProject();
    expect((await bookmark(users.freelancer, project.id)).status).toBe(204);
    const [first] = await bookmarkRows({ projectId: project.id });
    expect(first.userId).toBe(users.freelancer.id);

    expect((await bookmark(users.freelancer, project.id)).status).toBe(204);
    expect(await bookmarkRows({ projectId: project.id })).toEqual([first]);
  });

  it('stores exactly one row for concurrent saves of the same project', async () => {
    const project = await insertProject();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => bookmark(users.freelancer, project.id)),
    );
    expect(results.map((res) => res.status)).toEqual(Array(6).fill(204));
    expect(await bookmarkRows({ projectId: project.id })).toHaveLength(1);
  });

  it('removes idempotently: removing an already removed bookmark is still 204', async () => {
    const project = await insertProject();
    await bookmark(users.freelancer, project.id);
    expect((await unbookmark(users.freelancer, project.id)).status).toBe(204);
    expect(await bookmarkRows({ projectId: project.id })).toEqual([]);
    expect((await unbookmark(users.freelancer, project.id)).status).toBe(204);
    const concurrent = await Promise.all([
      unbookmark(users.freelancer, project.id),
      unbookmark(users.freelancer, project.id),
    ]);
    expect(concurrent.map((res) => res.status)).toEqual([204, 204]);
  });

  it('only touches the caller’s own row', async () => {
    const project = await insertProject();
    await bookmark(users.freelancer, project.id);
    await bookmark(users.other, project.id);
    expect((await unbookmark(users.other, project.id)).status).toBe(204);
    const rows = await bookmarkRows({ projectId: project.id });
    expect(rows.map((row) => row.userId)).toEqual([users.freelancer.id]);
  });

  it('refuses deleted, cancelled, missing and malformed projects like the public detail (404)', async () => {
    const deleted = await insertProject({ deletedAt: new Date() });
    const cancelled = await insertProject({ status: 'CANCELLED' });
    for (const id of [deleted.id, cancelled.id, 999_999_999, 'abc', 0]) {
      const res = await bookmark(users.freelancer, id);
      expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
    }
    expect(await bookmarkRows({ projectId: { in: [deleted.id, cancelled.id] } })).toEqual([]);
  });

  it('allows saving a closed project, which the public can still view', async () => {
    const closed = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    expect((await bookmark(users.freelancer, closed.id)).status).toBe(204);
  });
});

describe('PRJ-02 isBookmarked', () => {
  it('tells only the signed-in freelancer whether they saved the project', async () => {
    const project = await insertProject();
    await bookmark(users.freelancer, project.id);

    expect((await detail(users.freelancer, project.id)).body.data.isBookmarked).toBe(true);
    expect((await detail(users.other, project.id)).body.data.isBookmarked).toBe(false);
    expect((await detail(null, project.id)).body.data).not.toHaveProperty('isBookmarked');
    expect((await detail(users.client, project.id)).body.data).not.toHaveProperty('isBookmarked');

    await unbookmark(users.freelancer, project.id);
    expect((await detail(users.freelancer, project.id)).body.data.isBookmarked).toBe(false);
  });
});

describe('BMK-03 my bookmarks', () => {
  it('blocks guests, users without a role and clients', async () => {
    expect((await myBookmarks(null)).status).toBe(401);
    expect((await myBookmarks(users.noRole)).body.error.code).toBe('ROLE_REQUIRED');
    expect((await myBookmarks(users.client)).body.error.code).toBe('FORBIDDEN');
  });

  it('pages newest first (ties by project id) and returns an empty page past the end', async () => {
    const owner = await signup('pager', 'FREELANCER');
    const projects = [];
    for (let index = 0; index < 12; index += 1) projects.push(await insertProject());
    const base = Date.parse('2026-01-01T00:00:00Z');
    await prisma.bookmark.createMany({
      data: projects.map((project, index) => ({
        userId: owner.id,
        projectId: project.id,
        // 마지막 두 개는 같은 시각: project id가 큰 쪽이 먼저
        createdAt: new Date(base + Math.min(index, 10) * 60_000),
      })),
    });
    const expected = projects.map((project) => project.id).reverse();

    const page1 = await myBookmarks(owner);
    expect(page1.status).toBe(200);
    expect(page1.headers['cache-control']).toBe('no-store');
    expect(page1.body.data.map((item) => item.id)).toEqual(expected.slice(0, 10));
    expect(page1.body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalCount: 12,
      totalPages: 2,
    });
    const page2 = await myBookmarks(owner, { page: 2 });
    expect(page2.body.data.map((item) => item.id)).toEqual(expected.slice(10));
    const page3 = await myBookmarks(owner, { page: 3 });
    expect([page3.status, page3.body.data]).toEqual([200, []]);
    expect((await myBookmarks(owner, { page: 0 })).status).toBe(400);
  });

  it('never shows another freelancer’s bookmarks, even when asked by query', async () => {
    const mine = await insertProject();
    await bookmark(users.freelancer, mine.id);
    const res = await myBookmarks(users.other, { userId: users.freelancer.id });
    expect(res.body.data.map((item) => item.id)).not.toContain(mine.id);
  });

  it('shows the current status, exact budget and the freelancer’s own application', async () => {
    const owner = await signup('viewer', 'FREELANCER');
    const closed = await insertProject({
      recruitEndDate: toDbDate(day(-2)),
      budget: PRECISE_BUDGET,
    });
    const startedToday = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(today),
    });
    const scheduled = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(day(3)),
    });
    const contracting = await insertProject({ status: 'CONTRACTING' });
    for (const project of [closed, startedToday, scheduled, contracting]) {
      await prisma.bookmark.create({ data: { userId: owner.id, projectId: project.id } });
    }
    await prisma.application.create({
      data: {
        projectId: closed.id,
        freelancerId: owner.id,
        coverLetter: '비공개 자기소개',
        proposedAmount: 1_000_000n,
        proposedDurationDays: 10,
      },
    });
    const before = await runProjects();

    const res = await myBookmarks(owner);
    const byId = new Map(res.body.data.map((item) => [item.id, item]));
    expect(byId.get(closed.id)).toMatchObject({
      publicStatus: 'CLOSED',
      budget: '9007199254740993',
      isBookmarked: true,
      myApplication: { status: 'PENDING' },
    });
    expect(byId.get(startedToday.id).publicStatus).toBe('RECRUITING');
    expect(byId.get(scheduled.id).publicStatus).toBe('SCHEDULED');
    expect(byId.get(contracting.id)).toMatchObject({ publicStatus: 'CLOSED', myApplication: null });
    for (const item of res.body.data) {
      for (const key of ['status', 'client', 'clientId', 'description', 'coverLetter']) {
        expect(item).not.toHaveProperty(key);
      }
    }
    expect(JSON.stringify(res.body)).not.toContain('비공개 자기소개');
    // GET은 저장된 상태를 바꾸지 않는다(D-83).
    expect(await runProjects()).toEqual(before);
  });

  it('hides deleted and cancelled projects but keeps their bookmark rows', async () => {
    const owner = await signup('keeper', 'FREELANCER');
    const kept = await insertProject();
    const toDelete = await insertProject();
    const toCancel = await insertProject();
    for (const project of [kept, toDelete, toCancel]) {
      expect((await bookmark(owner, project.id)).status).toBe(204);
    }
    expect(
      (await request(app).delete(`/api/projects/${toDelete.id}`).set(bearer(users.client))).status,
    ).toBe(204);
    await prisma.project.update({ where: { id: toCancel.id }, data: { status: 'CANCELLED' } });

    const res = await myBookmarks(owner);
    expect(res.body.data.map((item) => item.id)).toEqual([kept.id]);
    expect(res.body.pagination.totalCount).toBe(1);
    const rows = await prisma.bookmark.findMany({ where: { userId: owner.id } });
    expect(rows.map((row) => row.projectId).sort((a, b) => a - b)).toEqual(
      [kept.id, toDelete.id, toCancel.id].sort((a, b) => a - b),
    );
    expect((await detail(owner, toDelete.id)).status).toBe(404);
    // 본인이 직접 해제하는 것은 허용한다(멱등).
    expect((await unbookmark(owner, toDelete.id)).status).toBe(204);
  });

  it('leaves projects, applications and notifications untouched', async () => {
    const project = await insertProject();
    const applied = await request(app)
      .post(`/api/projects/${project.id}/applications`)
      .set(bearer(users.other))
      .send({ coverLetter: '지원합니다', proposedAmount: '2500000', proposedDurationDays: 30 });
    expect(applied.status).toBe(201);
    const snapshot = () =>
      Promise.all([
        prisma.project.findUnique({ where: { id: project.id } }),
        prisma.application.findMany({ where: { projectId: project.id } }),
        prisma.notification.findMany({ where: { projectId: project.id } }),
      ]);
    const before = await snapshot();
    expect(before[2]).toHaveLength(1);

    await bookmark(users.other, project.id);
    await unbookmark(users.other, project.id);
    await bookmark(users.other, project.id);
    await bookmark(users.freelancer, project.id);
    await myBookmarks(users.other);

    expect(await snapshot()).toEqual(before);
    const item = (await myBookmarks(users.other)).body.data.find((row) => row.id === project.id);
    expect(item.myApplication).toEqual({ id: applied.body.data.id, status: 'PENDING' });
  });
});

describe('SRCH-02 recommendations', () => {
  const fixtures = {};
  const at = (minutes) => new Date(Date.parse('2026-02-01T00:00:00Z') + minutes * 60_000);

  beforeAll(async () => {
    const foreign = await prisma.project.count({
      where: { category: 'PLANNING', deletedAt: null, NOT: { client: runUsers } },
    });
    if (foreign > 0) {
      throw new Error('workbridge_test has PLANNING projects from another run; clean them first');
    }
    const ab = [stacks.a.id, stacks.b.id];
    const plan = (data) => insertProject({ category: 'PLANNING', ...data });
    fixtures.base = await plan({ stackIds: ab, createdAt: at(0) });
    fixtures.twoShared = await plan({ stackIds: ab, createdAt: at(1), budget: PRECISE_BUDGET });
    // 저장 상태는 SCHEDULED지만 시작일이 지나 실제로는 모집 중
    fixtures.startedScheduled = await plan({
      stackIds: ab,
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(day(-1)),
      createdAt: at(2),
    });
    fixtures.oneShared = await plan({ stackIds: [stacks.a.id], createdAt: at(3) });
    fixtures.oneSharedTie = await plan({ stackIds: [stacks.b.id], createdAt: at(3) });
    fixtures.categoryOnly = await plan({ stackIds: [], createdAt: at(9) });
    fixtures.otherCategory = await insertProject({
      category: 'DESIGN',
      stackIds: ab,
      createdAt: at(10),
    });
    fixtures.unrelated = await insertProject({ category: 'DESIGN', stackIds: [stacks.c.id] });
    fixtures.excluded = [
      await plan({ stackIds: ab, deletedAt: new Date() }),
      await plan({ stackIds: ab, status: 'CANCELLED' }),
      await plan({ stackIds: ab, recruitEndDate: toDbDate(day(-1)) }),
      await plan({ stackIds: ab, status: 'SCHEDULED', recruitStartDate: toDbDate(day(2)) }),
      await plan({ stackIds: ab, status: 'CONTRACTING' }),
      await plan({ stackIds: ab, status: 'CLOSED' }),
    ];
  });

  it('ranks by category, then shared tech stacks, then recency and id, at most 4', async () => {
    const res = await recommendations(fixtures.base.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.map((item) => item.id)).toEqual([
      fixtures.startedScheduled.id,
      fixtures.twoShared.id,
      fixtures.oneSharedTie.id,
      fixtures.oneShared.id,
    ]);
    expect(res.body.data.map((item) => item.match)).toEqual([
      { sameCategory: true, sharedTechStackCount: 2 },
      { sameCategory: true, sharedTechStackCount: 2 },
      { sameCategory: true, sharedTechStackCount: 1 },
      { sameCategory: true, sharedTechStackCount: 1 },
    ]);

    const full = await rankRecommendations(prisma, {
      projectId: fixtures.base.id,
      category: 'PLANNING',
      techStackIds: [stacks.a.id, stacks.b.id],
      today: toDbDate(today),
      limit: 50,
    });
    expect(full.map((item) => item.id)).toEqual([
      fixtures.startedScheduled.id,
      fixtures.twoShared.id,
      fixtures.oneSharedTie.id,
      fixtures.oneShared.id,
      fixtures.categoryOnly.id,
      fixtures.otherCategory.id,
    ]);
  });

  it('excludes itself, deleted, cancelled, closed, scheduled and trade-stage projects', async () => {
    const res = await recommendations(fixtures.base.id);
    const ids = res.body.data.map((item) => item.id);
    for (const project of [fixtures.base, fixtures.unrelated, ...fixtures.excluded]) {
      expect(ids).not.toContain(project.id);
    }
    expect(res.body.data.every((item) => item.publicStatus === 'RECRUITING')).toBe(true);
  });

  it('returns public summaries only, with exact budgets, and the same order every time', async () => {
    const first = await recommendations(fixtures.base.id);
    const second = await recommendations(fixtures.base.id, users.freelancer);
    expect(second.body).toEqual(first.body);
    const item = first.body.data.find((row) => row.id === fixtures.twoShared.id);
    expect(item.budget).toBe('9007199254740993');
    for (const row of first.body.data) {
      for (const key of [
        'status',
        'client',
        'clientId',
        'description',
        'isOwner',
        'isBookmarked',
      ]) {
        expect(row).not.toHaveProperty(key);
      }
    }
    const body = JSON.stringify(first.body);
    expect(body).not.toContain(email('client'));
    expect(body).not.toContain(users.client.name);
  });

  it('works with few or no matches', async () => {
    const lone = await insertProject({ category: 'ETC', stackIds: [stacks.c.id] });
    const few = await recommendations(lone.id);
    expect(few.body.data.map((item) => [item.id, item.match])).toEqual([
      [fixtures.unrelated.id, { sameCategory: false, sharedTechStackCount: 1 }],
    ]);
    const isolated = await insertProject({ category: 'MARKETING', stackIds: [stacks.d.id] });
    const none = await recommendations(isolated.id);
    expect([none.status, none.body]).toEqual([200, { data: [] }]);
  });

  it('answers 404 for a deleted, cancelled or missing base project, but works for a closed one', async () => {
    const [deleted, cancelled, closed] = fixtures.excluded;
    for (const id of [deleted.id, cancelled.id, 999_999_999, 'abc']) {
      expect((await recommendations(id)).status).toBe(404);
    }
    const res = await recommendations(closed.id);
    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => item.id)).not.toContain(closed.id);
  });

  it('does not write to the database', async () => {
    const before = await runProjects();
    const bookmarksBefore = await prisma.bookmark.count();
    await recommendations(fixtures.base.id);
    await recommendations(fixtures.excluded[2].id);
    expect(await runProjects()).toEqual(before);
    expect(await prisma.bookmark.count()).toBe(bookmarksBefore);
    const stored = await prisma.project.findUnique({ where: { id: fixtures.startedScheduled.id } });
    expect(stored.status).toBe('SCHEDULED');
  });
});
