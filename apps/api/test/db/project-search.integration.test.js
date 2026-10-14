// 프로젝트 검색·필터·정렬·페이지네이션(SRCH-01) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 다른 테스트의 행과 섞이지 않게 검색어에 이번 실행의 runId를 넣고, 만든 사용자·프로젝트·기술 스택만 지운다.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const runId = `s${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
// 서로 포함하지 않는 두 검색어: 기본 데이터 묶음(m)과 페이지 테스트 묶음(p).
const MAIN = `m${runId}`;
const PAGED = `p${runId}`;
const BIG = '9007199254740993';

const config = loadConfig({ CORS_ORIGIN: 'http://localhost:5173' });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomUUID().repeat(2),
  BCRYPT_ROUNDS: '4',
});

let prisma;
let app;
let client;
let stacks;
const rows = {};
const today = todayKst();
const day = (offset) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const base = Date.now();
const hoursAgo = (hours) => new Date(base - hours * 3_600_000);

const search = (query = {}) => request(app).get('/api/projects').query(query);
const titles = (res) => res.body.data.map((project) => project.title.split(' ')[0]);
const sortedTitles = (res) => titles(res).sort();

function insert(key, { stackIndexes = [0], start = null, end, ...data }) {
  return prisma.project.create({
    data: {
      clientId: client.id,
      title: `${key} ${MAIN}`,
      description: `${key} 설명`,
      category: 'WEB',
      budget: 1000n,
      status: 'RECRUITING',
      recruitStartDate: start === null ? null : toDbDate(day(start)),
      recruitEndDate: toDbDate(day(end)),
      ...data,
      techStacks: { create: stackIndexes.map((index) => ({ techStackId: stacks[index].id })) },
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

  client = await prisma.user.create({
    data: { email: `client.${runId}@workbridge.test`, name: '검색의뢰인', role: 'CLIENT' },
  });
  stacks = [];
  for (const label of ['alpha', 'beta', 'gamma']) {
    stacks.push(
      await prisma.techStack.create({
        data: { name: `S ${label} ${runId}`, normalizedName: `s${label}${runId}` },
      }),
    );
  }

  // 제목 첫 단어가 이름이다. 만든 시각은 정렬 비교를 위해 일부러 다르게 둔다.
  rows.shop = await insert('shop', {
    end: 5,
    budget: 3_000_000n,
    stackIndexes: [0, 1],
    description: '반응형 쇼핑몰 프론트엔드',
    createdAt: hoursAgo(5),
  });
  rows.mobile = await insert('mobile', {
    category: 'MOBILE',
    status: 'SCHEDULED',
    start: 3,
    end: 20,
    budget: BigInt(BIG),
    stackIndexes: [1],
    createdAt: hoursAgo(4),
  });
  rows.design = await insert('design', {
    category: 'DESIGN',
    end: 2,
    budget: 500_000n,
    stackIndexes: [2],
    description: 'Figma로 만드는 쇼핑몰 배너',
    createdAt: hoursAgo(3),
  });
  // 저장된 상태는 모집 중이지만 마감일이 지났다 → 공개 상태는 모집 마감.
  rows.expired = await insert('expired', {
    category: 'DATA_AI',
    start: -10,
    end: -1,
    budget: 3_000_000n,
    createdAt: hoursAgo(2),
  });
  rows.contract = await insert('contract', {
    status: 'CONTRACTING',
    end: 10,
    budget: 8_000_000n,
    createdAt: hoursAgo(1),
  });
  // 저장된 상태는 모집 예정이지만 시작일이 지났다 → 공개 상태는 모집 중.
  rows.started = await insert('started', {
    category: 'PLANNING',
    status: 'SCHEDULED',
    start: -1,
    end: 7,
    budget: 1_000_000n,
    createdAt: hoursAgo(6),
  });
  rows.sale = await insert('sale', {
    category: 'MARKETING',
    title: `sale 100%할인_이벤트 ${MAIN}`,
    end: 5,
    budget: 2_000_000n,
    createdAt: hoursAgo(7),
  });
  rows.cancelled = await insert('cancelled', {
    status: 'CANCELLED',
    cancelledAt: new Date(),
    end: 5,
  });
  rows.deleted = await insert('deleted', { end: 5, deletedAt: new Date() });
});

afterAll(async () => {
  if (prisma) {
    await prisma.project.deleteMany({ where: { clientId: client?.id } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `.${runId}@workbridge.test` } } });
    await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
    await prisma.$disconnect();
  }
});

const PUBLIC = ['contract', 'design', 'expired', 'mobile', 'sale', 'shop', 'started'];

describe('GET /api/projects (SRCH-01) public scope', () => {
  it('lists public projects to anonymous users, newest first, without private fields', async () => {
    const res = await search({ q: MAIN });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(titles(res)).toEqual([
      'contract',
      'expired',
      'design',
      'mobile',
      'shop',
      'started',
      'sale',
    ]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, totalCount: 7, totalPages: 1 });

    const item = res.body.data.find((project) => project.title.startsWith('shop'));
    expect(Object.keys(item).sort()).toEqual(
      [
        'applicantCount',
        'budget',
        'category',
        'createdAt',
        'descriptionPreview',
        'id',
        'publicStatus',
        'recruitEndDate',
        'recruitStartDate',
        'techStacks',
        'title',
        'updatedAt',
      ].sort(),
    );
    expect(item).toMatchObject({
      budget: '3000000',
      recruitEndDate: day(5),
      descriptionPreview: '반응형 쇼핑몰 프론트엔드',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/email|clientId|idempotency|availableActions/i);
  });

  it('hides deleted and cancelled projects and shows deal stages as CLOSED (A-26)', async () => {
    const res = await search({ q: MAIN });
    const byTitle = Object.fromEntries(
      res.body.data.map((project) => [project.title.split(' ')[0], project.publicStatus]),
    );
    expect(Object.keys(byTitle).sort()).toEqual(PUBLIC);
    expect(byTitle).toMatchObject({
      contract: 'CLOSED',
      expired: 'CLOSED',
      started: 'RECRUITING',
      mobile: 'SCHEDULED',
    });
  });

  it('does not write to the database while searching (D-83)', async () => {
    await Promise.all([search({ q: MAIN }), search({ q: MAIN, status: 'CLOSED' })]);
    const stored = await prisma.project.findMany({
      where: { id: { in: [rows.expired.id, rows.started.id] } },
      orderBy: { id: 'asc' },
    });
    expect(stored.map((p) => [p.status, p.closedAt, p.updatedAt])).toEqual([
      ['RECRUITING', null, rows.expired.updatedAt],
      ['SCHEDULED', null, rows.started.updatedAt],
    ]);
  });

  it('links each result to a public detail page with the same status', async () => {
    const res = await search({ q: MAIN });
    for (const item of res.body.data) {
      const detail = await request(app).get(`/api/projects/${item.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id: item.id, publicStatus: item.publicStatus });
    }
  });
});

describe('keyword (A-20)', () => {
  it('matches title or description, ignores case and requires every word', async () => {
    expect(sortedTitles(await search({ q: `쇼핑몰 ${MAIN}` }))).toEqual(['design', 'shop']);
    expect(sortedTitles(await search({ q: `fIgMa ${MAIN.toUpperCase()}` }))).toEqual(['design']);
    expect((await search({ q: `없는단어 ${MAIN}` })).body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 10, totalCount: 0, totalPages: 0 },
    });
  });

  it('treats % and _ as plain characters', async () => {
    expect(sortedTitles(await search({ q: `% ${MAIN}` }))).toEqual(['sale']);
    expect(sortedTitles(await search({ q: `_ ${MAIN}` }))).toEqual(['sale']);
    expect(sortedTitles(await search({ q: `100%할인 ${MAIN}` }))).toEqual(['sale']);
    expect(sortedTitles(await search({ q: `' OR 1=1 -- ${MAIN}` }))).toEqual([]);
  });
});

describe('filters (A-21)', () => {
  it('filters by category', async () => {
    expect(sortedTitles(await search({ q: MAIN, category: 'WEB' }))).toEqual(['contract', 'shop']);
    expect(sortedTitles(await search({ q: MAIN, category: 'ETC' }))).toEqual([]);
  });

  it('filters by an inclusive budget range without losing bigint precision', async () => {
    expect(sortedTitles(await search({ q: MAIN, budgetMin: '3000000' }))).toEqual([
      'contract',
      'expired',
      'mobile',
      'shop',
    ]);
    expect(sortedTitles(await search({ q: MAIN, budgetMax: '3000000' }))).toEqual([
      'design',
      'expired',
      'sale',
      'shop',
      'started',
    ]);
    expect(
      sortedTitles(await search({ q: MAIN, budgetMin: '3000000', budgetMax: '3000000' })),
    ).toEqual(['expired', 'shop']);

    const big = await search({ q: MAIN, budgetMin: BIG });
    expect(titles(big)).toEqual(['mobile']);
    expect(big.body.data[0].budget).toBe(BIG);
    expect(titles(await search({ q: MAIN, budgetMin: '9007199254740994' }))).toEqual([]);
    expect(titles(await search({ q: MAIN, budgetMax: '9223372036854775807' }))).toHaveLength(7);
  });

  it('matches any selected tech stack (OR) and returns nothing for unknown IDs', async () => {
    expect(sortedTitles(await search({ q: MAIN, techStackIds: String(stacks[2].id) }))).toEqual([
      'design',
    ]);
    expect(
      sortedTitles(await search({ q: MAIN, techStackIds: `${stacks[1].id},${stacks[2].id}` })),
    ).toEqual(['design', 'mobile', 'shop']);
    const unknown = await search({ q: MAIN, techStackIds: '2147483647' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.pagination.totalCount).toBe(0);
  });

  it('filters by projects that close on or before the KST deadline date (D-32)', async () => {
    expect(sortedTitles(await search({ q: MAIN, deadline: day(5) }))).toEqual([
      'design',
      'expired',
      'sale',
      'shop',
    ]);
    expect(sortedTitles(await search({ q: MAIN, deadline: day(4) }))).toEqual([
      'design',
      'expired',
    ]);
    expect(sortedTitles(await search({ q: MAIN, deadline: day(-2) }))).toEqual([]);
  });

  it('filters by the date-based public status, and the statuses split the results', async () => {
    const counts = {};
    for (const status of ['SCHEDULED', 'RECRUITING', 'CLOSED']) {
      const res = await search({ q: MAIN, status });
      expect(res.body.data.every((project) => project.publicStatus === status)).toBe(true);
      counts[status] = sortedTitles(res);
    }
    expect(counts).toEqual({
      SCHEDULED: ['mobile'],
      RECRUITING: ['design', 'sale', 'shop', 'started'],
      CLOSED: ['contract', 'expired'],
    });
  });

  it('combines different filters with AND', async () => {
    expect(
      titles(
        await search({
          q: MAIN,
          category: 'WEB',
          status: 'RECRUITING',
          techStackIds: String(stacks[1].id),
          budgetMax: '3000000',
          deadline: day(5),
        }),
      ),
    ).toEqual(['shop']);
    expect(titles(await search({ q: MAIN, category: 'WEB', status: 'SCHEDULED' }))).toEqual([]);
  });

  it('shows the whole list for an empty or blank keyword', async () => {
    const all = await search({ q: '   ', status: 'RECRUITING' });
    expect(all.status).toBe(200);
    const ids = new Set();
    for (let page = 1; page <= all.body.pagination.totalPages; page += 1) {
      const res = await search({ q: '   ', status: 'RECRUITING', page });
      for (const project of res.body.data) ids.add(project.id);
    }
    expect(ids.size).toBe(all.body.pagination.totalCount);
    for (const key of ['shop', 'design', 'sale', 'started'])
      expect(ids.has(rows[key].id)).toBe(true);
    expect(ids.has(rows.cancelled.id) || ids.has(rows.deleted.id)).toBe(false);
  });
});

describe('sorting (A-22)', () => {
  it('sorts by budget high to low, newest first on ties', async () => {
    expect(titles(await search({ q: MAIN, sort: 'budget' }))).toEqual([
      'mobile',
      'contract',
      'expired',
      'shop',
      'sale',
      'started',
      'design',
    ]);
  });

  it('sorts by nearest deadline among open projects, then closed ones', async () => {
    expect(titles(await search({ q: MAIN, sort: 'deadline' }))).toEqual([
      'design',
      'shop',
      'sale',
      'started',
      'mobile',
      'contract',
      'expired',
    ]);
  });
});

describe('pagination (A-23)', () => {
  let paged;
  beforeAll(async () => {
    // 12개 모두 같은 시각에 만들어 최신순 동률을 id로만 가르게 한다.
    const createdAt = hoursAgo(10);
    paged = [];
    for (let index = 0; index < 12; index += 1) {
      paged.push(
        await insert('paged', {
          title: `paged${index} ${PAGED}`,
          end: 30,
          budget: 1_000_000n,
          createdAt,
        }),
      );
    }
  });

  it('shows 10 per page, then the rest on page 2, with the same total on both', async () => {
    const first = await search({ q: PAGED });
    const second = await search({ q: PAGED, page: 2 });
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 10, totalCount: 12, totalPages: 2 });
    expect(second.body.pagination).toEqual({
      page: 2,
      pageSize: 10,
      totalCount: 12,
      totalPages: 2,
    });
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(2);

    const ids = [...first.body.data, ...second.body.data].map((project) => project.id);
    expect(ids).toEqual(paged.map((project) => project.id).sort((a, b) => b - a));
  });

  it('keeps a stable order for ties across pages and sorts', async () => {
    for (const sort of ['latest', 'budget', 'deadline']) {
      const pages = await Promise.all([1, 2].map((page) => search({ q: PAGED, sort, page })));
      const ids = pages.flatMap((res) => res.body.data.map((project) => project.id));
      expect(new Set(ids).size).toBe(12);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    }
  });

  it('splits the deadline sort across pages at the open/closed boundary', async () => {
    const all = [];
    for (const page of [1, 2]) {
      const res = await search({ q: runId, sort: 'deadline', page });
      expect(res.body.pagination.totalCount).toBe(19);
      all.push(...res.body.data);
    }
    expect(all).toHaveLength(19);
    const statuses = all.map((project) => project.publicStatus);
    expect(statuses.slice(-2)).toEqual(['CLOSED', 'CLOSED']);
    expect(statuses.slice(0, -2).every((status) => status !== 'CLOSED')).toBe(true);
  });

  it('returns an empty page beyond the last one and rejects invalid pages', async () => {
    const beyond = await search({ q: PAGED, page: 3 });
    expect(beyond.status).toBe(200);
    expect(beyond.body).toEqual({
      data: [],
      pagination: { page: 3, pageSize: 10, totalCount: 12, totalPages: 2 },
    });
    for (const page of ['0', '-1', 'abc', '1.5']) {
      expect((await search({ q: PAGED, page })).status).toBe(400);
    }
  });
});

describe('invalid queries', () => {
  it('answers 400 with the field for each bad value', async () => {
    const res = await search({
      category: 'GAME',
      budgetMin: '-5',
      techStackIds: 'x',
      deadline: '2026-02-30',
      status: 'CONTRACTING',
      sort: 'popular',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'budgetMin',
      'category',
      'deadline',
      'sort',
      'status',
      'techStackIds',
    ]);

    const reversed = await search({ budgetMin: '2000', budgetMax: '1000' });
    expect(reversed.body.error.details.fields).toHaveProperty('budgetMax');
    const repeated = await request(app).get('/api/projects?status=RECRUITING&status=CLOSED');
    expect(repeated.status).toBe(400);
    expect((await search({ q: 'x'.repeat(101) })).status).toBe(400);
  });
});

describe('GET /api/tech-stacks?ids= (filter labels)', () => {
  it('returns the requested stacks by ID and validates the list', async () => {
    const res = await request(app)
      .get('/api/tech-stacks')
      .query({ ids: `${stacks[2].id},${stacks[0].id},2147483647` });
    expect(res.status).toBe(200);
    expect(res.body.data.map((stack) => stack.id).sort()).toEqual(
      [stacks[0].id, stacks[2].id].sort(),
    );
    expect((await request(app).get('/api/tech-stacks').query({ ids: 'a,b' })).status).toBe(400);
  });

  it('treats % in the name search as a plain character', async () => {
    const res = await request(app).get('/api/tech-stacks').query({ q: '%', limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.every((stack) => stack.name.includes('%'))).toBe(true);
  });
});
