// 사용자 공개 프로필(PROF-05, A-14) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트·기술 스택(runId 이름)·임시 이미지 디렉터리만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { findPublicUser } from '../../src/modules/profiles/publicProfile.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';
import { createLocalImageStorage } from '../../src/modules/uploads/imageStorage.js';

const ORIGIN = 'http://localhost:5173';
const runId = `u${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const BIG_RATE = '9007199254740993123';
const GOOGLE_SUB = `sub-${runId}`;
const IMAGE_URL = /^\/api\/uploads\/profile-images\/[a-f0-9]{32}\.webp$/;

/** 공개 응답 어디에도 나오면 안 되는 키(중첩 포함). */
const PRIVATE_KEYS = [
  'email',
  'passwordHash',
  'hasPassword',
  'socialProviders',
  'socialAccounts',
  'providerUserId',
  'emailAtLink',
  'accessToken',
  'refreshToken',
  'refreshTokens',
  'tokenHash',
  'oauthTransactions',
  'hourlyRate',
  'profileCompletion',
  'missingFields',
  'createdAt',
  'updatedAt',
  'normalizedName',
  'isCustom',
  'createdById',
  'createdTechStacks',
  'projects',
];

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

let prisma;
let app;
let imageDir;
let stacks;
const users = {};

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `테스트${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

const inDays = (offset) => {
  const date = new Date(`${todayKst()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const getPublic = (id, headers = {}) => request(app).get(`/api/users/${id}`).set(headers);

function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysOf(child, found);
    }
  }
  return found;
}

/** 공개 응답이 비공개 키·값을 담지 않았는지 본다. */
function expectNoPrivateData(res, user) {
  const keys = keysOf(res.body);
  for (const key of PRIVATE_KEYS) expect(keys.has(key), key).toBe(false);
  for (const secret of ['@workbridge.test', BIG_RATE, GOOGLE_SUB, user.token, PASSWORD, '$2']) {
    expect(res.text).not.toContain(secret);
  }
}

const pngImage = () =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 90, b: 60 } } })
    .png()
    .toBuffer();

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  imageDir = await mkdtemp(path.join(os.tmpdir(), 'wb-public-images-'));
  app = createApp(config, {
    prisma,
    authConfig,
    imageStorage: createLocalImageStorage({ directory: imageDir }),
  });

  stacks = [];
  for (const label of ['beta', 'alpha']) {
    stacks.push(
      await prisma.techStack.create({
        data: { name: `U ${label} ${runId}`, normalizedName: `u${label}${runId}` },
      }),
    );
  }

  users.client = await signup('client', 'CLIENT');
  users.freelancer = await signup('freelancer', 'FREELANCER');
  users.incompleteClient = await signup('client2', 'CLIENT');
  users.incompleteFreelancer = await signup('freelancer2', 'FREELANCER');
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };

  const client = await request(app)
    .put('/api/users/me/client-profile')
    .set(bearer(users.client))
    .send({
      companyName: '공개 테스트 주식회사',
      businessField: 'ETC',
      businessFieldEtc: '교육',
      websiteUrl: 'https://client.example.com',
    });
  expect(client.status).toBe(200);
  const bio = await request(app)
    .patch('/api/users/me')
    .set(bearer(users.client))
    .send({ bio: '의뢰인 소개입니다.' });
  expect(bio.status).toBe(200);

  const freelancer = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(users.freelancer))
    .send({
      mainCategory: 'WEB',
      techStackIds: stacks.map((stack) => stack.id),
      careerYears: 5,
      hourlyRate: BIG_RATE,
      portfolioUrl: 'https://portfolio.example.com',
    });
  expect(freelancer.status).toBe(200);
  // Google 연결 계정이어도 연결 식별자는 공개 응답에 나오지 않아야 한다.
  await prisma.socialAccount.create({
    data: {
      userId: users.freelancer.id,
      provider: 'GOOGLE',
      providerUserId: GOOGLE_SUB,
      emailAtLink: email('freelancer'),
    },
  });
});

afterAll(async () => {
  if (prisma) {
    const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
    await prisma.project.deleteMany({ where: { client: runUsers } });
    await prisma.user.deleteMany({ where: runUsers });
    await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
    await prisma.$disconnect();
  }
  if (imageDir) await rm(imageDir, { recursive: true, force: true });
});

describe('GET /api/users/:userId (PROF-05)', () => {
  it('shows a client profile to anonymous visitors without private data', async () => {
    const res = await getPublic(users.client.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      id: users.client.id,
      name: '테스트client',
      role: 'CLIENT',
      profileImageUrl: null,
      bio: '의뢰인 소개입니다.',
      profileComplete: true,
      ratingSummary: { average: null, count: 0 },
      clientProfile: {
        companyName: '공개 테스트 주식회사',
        businessField: 'ETC',
        businessFieldEtc: '교육',
        websiteUrl: 'https://client.example.com',
      },
      freelancerProfile: null,
    });
    expectNoPrivateData(res, users.client);
  });

  it('shows a freelancer profile with linked tech stacks but no hourly rate or OAuth data', async () => {
    const res = await getPublic(users.freelancer.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: users.freelancer.id,
      name: '테스트freelancer',
      role: 'FREELANCER',
      profileImageUrl: null,
      bio: null,
      profileComplete: true,
      ratingSummary: { average: null, count: 0 },
      clientProfile: null,
      freelancerProfile: {
        mainCategory: 'WEB',
        techStacks: [
          { id: stacks[1].id, name: stacks[1].name },
          { id: stacks[0].id, name: stacks[0].name },
        ],
        careerYears: 5,
        portfolioUrl: 'https://portfolio.example.com',
      },
    });
    expectNoPrivateData(res, users.freelancer);
    // DB에는 BigInt 단가가 그대로 있다. 공개 응답에서만 빠진다.
    const stored = await prisma.freelancerProfile.findUnique({
      where: { userId: users.freelancer.id },
    });
    expect(stored.hourlyRate.toString()).toBe(BIG_RATE);
  });

  it('returns the same public view to any logged-in user and ignores a bad token', async () => {
    const anonymous = await getPublic(users.freelancer.id);
    const owner = await getPublic(users.freelancer.id, bearer(users.freelancer));
    const other = await getPublic(users.freelancer.id, bearer(users.client));
    const broken = await getPublic(users.freelancer.id, { Authorization: 'Bearer not-a-token' });
    for (const res of [owner, other, broken]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(anonymous.body);
    }
  });

  it('shows incomplete profiles with profileComplete=false and only what was filled in', async () => {
    const client = await getPublic(users.incompleteClient.id);
    expect(client.status).toBe(200);
    expect(client.body.data).toMatchObject({
      role: 'CLIENT',
      profileComplete: false,
      clientProfile: null,
      freelancerProfile: null,
    });

    // 저장 API는 전체 값을 요구하므로, 일부만 남은 행(예: 기술 스택이 빠진 기존 데이터)은 직접 만든다.
    await prisma.freelancerProfile.create({
      data: { userId: users.incompleteFreelancer.id, mainCategory: 'DESIGN' },
    });
    const freelancer = await getPublic(users.incompleteFreelancer.id);
    expect(freelancer.body.data).toMatchObject({
      profileComplete: false,
      freelancerProfile: {
        mainCategory: 'DESIGN',
        techStacks: [],
        careerYears: null,
        portfolioUrl: null,
      },
    });
    expectNoPrivateData(freelancer, users.incompleteFreelancer);
  });

  it('answers 404 for users without a role, unknown IDs and malformed IDs', async () => {
    const missing = await prisma.user.aggregate({ _max: { id: true } });
    for (const id of [users.noRole.id, missing._max.id + 1000, 2147483647]) {
      const res = await getPublic(id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.text).not.toContain('역할없음');
    }
    for (const id of ['0', '-1', 'abc', '1.5', '2147483648', 'me', '%2e%2e']) {
      const res = await getPublic(id);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('reads a profile with a fixed number of queries regardless of tech stack count', async () => {
    const queries = [];
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getDatabaseConfig('test').url }),
      log: [{ emit: 'event', level: 'query' }],
    });
    counting.$on('query', (event) => queries.push(event.query));
    try {
      const countFor = async (userId) => {
        queries.length = 0;
        await findPublicUser(counting, userId);
        return queries.length;
      };
      // 관계 단계마다 한 번(users·두 프로필·연결·기술 스택) + 별점 aggregate 1회. 기술 스택 수와 무관하다.
      const twoStacks = await countFor(users.freelancer.id);
      const noStacks = await countFor(users.incompleteFreelancer.id);
      expect(twoStacks).toBeLessThanOrEqual(6);
      expect(noStacks).toBe(twoStacks);
      expect(await countFor(users.incompleteClient.id)).toBeLessThanOrEqual(twoStacks);
      expect(queries.every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
    } finally {
      await counting.$disconnect();
    }
  });

  it('does not write to the database when read', async () => {
    const snapshot = async () => ({
      users: await prisma.user.findMany({
        where: { email: { endsWith: `.${runId}@workbridge.test` } },
        select: { id: true, updatedAt: true },
        orderBy: { id: 'asc' },
      }),
      clients: await prisma.clientProfile.findMany({
        where: { userId: users.client.id },
        select: { updatedAt: true },
      }),
      freelancers: await prisma.freelancerProfile.findMany({
        where: { userId: users.freelancer.id },
        select: { updatedAt: true },
      }),
      stacks: await prisma.techStack.count(),
      links: await prisma.freelancerTechStack.count({
        where: { freelancerId: users.freelancer.id },
      }),
      tokens: await prisma.refreshToken.count({ where: { userId: users.freelancer.id } }),
    });
    const before = await snapshot();
    for (const user of [users.client, users.freelancer, users.incompleteClient, users.noRole]) {
      await getPublic(user.id);
      await getPublic(user.id, bearer(users.freelancer));
    }
    expect(await snapshot()).toEqual(before);
  });

  it('reflects edits and profile image changes made through /me', async () => {
    const renamed = await request(app)
      .patch('/api/users/me')
      .set(bearer(users.freelancer))
      .send({ name: '바뀐 프리랜서', bio: '새 자기소개' });
    expect(renamed.status).toBe(200);
    const changed = await request(app)
      .put('/api/users/me/freelancer-profile')
      .set(bearer(users.freelancer))
      .send({
        mainCategory: 'MOBILE',
        techStackIds: [stacks[0].id],
        careerYears: 6,
        hourlyRate: BIG_RATE,
        portfolioUrl: null,
      });
    expect(changed.status).toBe(200);

    const uploaded = await request(app)
      .post('/api/uploads/profile-image')
      .set(bearer(users.freelancer))
      .attach('file', await pngImage(), { filename: 'me.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);

    const res = await getPublic(users.freelancer.id);
    expect(res.body.data).toMatchObject({
      name: '바뀐 프리랜서',
      bio: '새 자기소개',
      freelancerProfile: {
        mainCategory: 'MOBILE',
        techStacks: [{ id: stacks[0].id, name: stacks[0].name }],
        careerYears: 6,
        portfolioUrl: null,
      },
    });
    expect(res.body.data.profileImageUrl).toMatch(IMAGE_URL);
    expect(res.body.data.profileImageUrl).toBe(uploaded.body.data.profileImageUrl);
    const image = await request(app).get(res.body.data.profileImageUrl);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');

    const removed = await request(app)
      .patch('/api/users/me')
      .set(bearer(users.freelancer))
      .send({ profileImageUrl: null });
    expect(removed.status).toBe(200);
    expect((await getPublic(users.freelancer.id)).body.data.profileImageUrl).toBeNull();
  });

  it('hides a stored image path that is not a file of this storage', async () => {
    await prisma.user.update({
      where: { id: users.incompleteClient.id },
      data: { profileImageUrl: '/api/uploads/profile-images/../../secret.webp' },
    });
    const res = await getPublic(users.incompleteClient.id);
    expect(res.body.data.profileImageUrl).toBeNull();
  });

  it('cannot be used to edit a profile', async () => {
    for (const method of ['patch', 'put', 'post', 'delete']) {
      const agent = request(app);
      const res = await agent[method](`/api/users/${users.client.id}`)
        .set(bearer(users.freelancer))
        .send({ name: '탈취' });
      expect(res.status, method).toBe(404);
    }
    expect((await getPublic(users.client.id)).body.data.name).toBe('테스트client');
  });
});

describe('project detail → client public profile', () => {
  it('exposes only the client ID needed for the link, not new personal data in search', async () => {
    const project = await prisma.project.create({
      data: {
        clientId: users.client.id,
        title: `공개 프로필 연결 ${runId}`,
        description: '설명',
        category: 'WEB',
        recruitEndDate: toDbDate(inDays(10)),
        budget: 1000n,
        status: 'RECRUITING',
        techStacks: { create: [{ techStackId: stacks[0].id }] },
      },
    });

    const detail = await request(app).get(`/api/projects/${project.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.client.id).toBe(users.client.id);
    expect(keysOf(detail.body.data.client)).toEqual(
      new Set(['id', 'name', 'profileImageUrl', 'companyName']),
    );
    expect((await getPublic(detail.body.data.client.id)).body.data.role).toBe('CLIENT');

    const search = await request(app).get('/api/projects').query({ q: runId });
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    const searchKeys = keysOf(search.body.data);
    for (const key of ['client', 'clientId', 'email', 'companyName', 'profileImageUrl', 'bio']) {
      expect(searchKeys.has(key), key).toBe(false);
    }
  });
});
