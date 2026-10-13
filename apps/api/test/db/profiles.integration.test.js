// 역할별 프로필(PROF-01~04, 06, 07)·완성 판정·프로필 이미지 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 이번 실행에서 만든 사용자(runId 이메일)·기술 스택(runId 이름)·임시 이미지 디렉터리만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { createAuthenticate } from '../../src/middlewares/authenticate.js';
import { createRequireCompleteProfile } from '../../src/middlewares/requireCompleteProfile.js';
import { createRequireRole } from '../../src/middlewares/requireRole.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import { DEFAULT_TECH_STACKS, seedTechStacks } from '../../src/modules/techStacks/techStack.js';
import { createLocalImageStorage } from '../../src/modules/uploads/imageStorage.js';

const ORIGIN = 'http://localhost:5173';
const runId = `p${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const BIG_RATE = '9007199254740993123';
const IMAGE_URL = /^\/api\/uploads\/profile-images\/[a-f0-9]{32}\.webp$/;

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

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `테스트${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const me = (user) => request(app).get('/api/auth/me').set(bearer(user.token));
const patchMe = (user, body) =>
  request(app).patch('/api/users/me').set(bearer(user.token)).send(body);
const putClient = (user, body) =>
  request(app).put('/api/users/me/client-profile').set(bearer(user.token)).send(body);
const putFreelancer = (user, body) =>
  request(app).put('/api/users/me/freelancer-profile').set(bearer(user.token)).send(body);
const upload = (user, buffer, filename, contentType) => {
  const req = request(app).post('/api/uploads/profile-image');
  if (user) req.set(bearer(user.token));
  return req.attach('file', buffer, { filename, contentType });
};

const clientBody = {
  companyName: '  워크브릿지 테스트 ',
  businessField: 'COMMERCE',
  websiteUrl: 'https://example.com',
};
const freelancerBody = () => ({
  mainCategory: 'WEB',
  techStackIds: [stacks[0].id, stacks[1].id],
  careerYears: 3,
  hourlyRate: BIG_RATE,
  portfolioUrl: 'https://portfolio.example.com',
});

const pngImage = (width = 900, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .png()
    .toBuffer();
const storedFiles = async () => (await readdir(imageDir)).sort();
const fileOf = (url) => url.slice('/api/uploads/profile-images/'.length);

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  imageDir = await mkdtemp(path.join(os.tmpdir(), 'wb-profile-images-'));
  const imageStorage = createLocalImageStorage({ directory: imageDir });
  app = createApp(config, { prisma, authConfig, imageStorage });

  stacks = [];
  for (const label of ['alpha', 'beta', 'gamma']) {
    stacks.push(
      await prisma.techStack.create({
        data: { name: `T ${label} ${runId}`, normalizedName: `t${label}${runId}` },
      }),
    );
  }

  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('client2', 'CLIENT');
  users.freelancer = await signup('freelancer', 'FREELANCER');
  users.otherFreelancer = await signup('freelancer2', 'FREELANCER');
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null, passwordHash: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { endsWith: `.${runId}@workbridge.test` } } });
    await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
    await prisma.$disconnect();
  }
  if (imageDir) await rm(imageDir, { recursive: true, force: true });
});

describe('profile completion right after signup', () => {
  it('keeps an incomplete user logged in and able to read and edit common info', async () => {
    const before = await me(users.client);
    expect(before.status).toBe(200);
    expect(before.body.data.profileCompletion).toEqual({
      isComplete: false,
      missingFields: ['companyName', 'businessField'],
    });

    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: email('freelancer'), password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.profileCompletion).toEqual({
      isComplete: false,
      missingFields: ['mainCategory', 'techStacks', 'careerYears', 'hourlyRate'],
    });

    const cookie = (login.headers['set-cookie'] ?? []).find((c) => c.startsWith('wb_rt='));
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie.split(';')[0]);
    expect(refreshed.status).toBe(200);

    const edited = await patchMe(users.freelancer, { name: ' 새 이름 ', bio: '  안녕하세요 ' });
    expect(edited.status).toBe(200);
    expect(edited.headers['cache-control']).toBe('no-store');
    expect(edited.body.data).toMatchObject({ name: '새 이름', bio: '안녕하세요' });
    expect(edited.body.data.profileCompletion.isComplete).toBe(false);
  });
});

describe('PATCH /api/users/me', () => {
  it('rejects email, role and direct image URL changes and keeps the stored values', async () => {
    const res = await patchMe(users.client, {
      email: 'other@workbridge.test',
      role: 'FREELANCER',
      profileImageUrl: 'https://evil.example.com/a.png',
      name: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'email',
      'name',
      'profileImageUrl',
      'role',
    ]);

    const user = await prisma.user.findUnique({ where: { id: users.client.id } });
    expect(user).toMatchObject({ email: email('client'), role: 'CLIENT', profileImageUrl: null });
  });

  it('clears the bio with null and requires login and a role', async () => {
    await patchMe(users.otherClient, { bio: '지울 소개' });
    const cleared = await patchMe(users.otherClient, { bio: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.bio).toBeNull();

    expect((await request(app).patch('/api/users/me').send({ name: 'x' })).status).toBe(401);
    const noRole = await patchMe(users.noRole, { name: '바꿈' });
    expect(noRole.status).toBe(403);
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');
  });
});

describe('PUT /api/users/me/client-profile', () => {
  it('validates required fields without creating a profile', async () => {
    const res = await putClient(users.client, { websiteUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'businessField',
      'companyName',
      'websiteUrl',
    ]);

    const etc = await putClient(users.client, { companyName: '회사', businessField: 'ETC' });
    expect(etc.status).toBe(400);
    expect(etc.body.error.details.fields).toHaveProperty('businessFieldEtc');

    expect(await prisma.clientProfile.count({ where: { userId: users.client.id } })).toBe(0);
  });

  it('creates, reads and updates the profile of the logged-in client only', async () => {
    const created = await putClient(users.client, { ...clientBody, userId: users.otherClient.id });
    expect(created.status).toBe(200);
    expect(created.body.data.id).toBe(users.client.id);
    expect(created.body.data.clientProfile).toEqual({
      companyName: '워크브릿지 테스트',
      businessField: 'COMMERCE',
      businessFieldEtc: null,
      websiteUrl: 'https://example.com',
    });
    expect(created.body.data.profileCompletion).toEqual({ isComplete: true, missingFields: [] });
    expect(await prisma.clientProfile.count({ where: { userId: users.otherClient.id } })).toBe(0);

    const read = await me(users.client);
    expect(read.body.data.clientProfile.companyName).toBe('워크브릿지 테스트');
    expect(read.body.data.profileCompletion.isComplete).toBe(true);

    const updated = await putClient(users.client, {
      companyName: '바뀐 회사',
      businessField: 'ETC',
      businessFieldEtc: '반려동물',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.clientProfile).toEqual({
      companyName: '바뀐 회사',
      businessField: 'ETC',
      businessFieldEtc: '반려동물',
      websiteUrl: null,
    });
    expect(await prisma.clientProfile.count({ where: { userId: users.client.id } })).toBe(1);
  });

  it('forbids other roles, users without a role and anonymous requests', async () => {
    const asFreelancer = await putClient(users.otherFreelancer, clientBody);
    expect(asFreelancer.status).toBe(403);
    expect(asFreelancer.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.clientProfile.count({ where: { userId: users.otherFreelancer.id } })).toBe(
      0,
    );

    const noRole = await putClient(users.noRole, clientBody);
    expect(noRole.status).toBe(403);
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');

    const anonymous = await request(app).put('/api/users/me/client-profile').send(clientBody);
    expect(anonymous.status).toBe(401);
  });
});

describe('PUT /api/users/me/freelancer-profile', () => {
  it('validates required fields, duplicate and unknown tech stacks', async () => {
    const empty = await putFreelancer(users.freelancer, {});
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.error.details.fields).sort()).toEqual([
      'careerYears',
      'hourlyRate',
      'mainCategory',
      'techStackIds',
    ]);

    const duplicate = await putFreelancer(users.freelancer, {
      ...freelancerBody(),
      techStackIds: [stacks[0].id, stacks[0].id],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details.fields.techStackIds).toMatch(/두 번/);

    const { _max } = await prisma.techStack.aggregate({ _max: { id: true } });
    const unknown = await putFreelancer(users.freelancer, {
      ...freelancerBody(),
      techStackIds: [stacks[0].id, _max.id + 100000],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.fields).toHaveProperty('techStackIds');

    const tooBig = await putFreelancer(users.freelancer, {
      ...freelancerBody(),
      hourlyRate: '9223372036854775808',
    });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.details.fields).toHaveProperty('hourlyRate');

    expect(await prisma.freelancerProfile.count({ where: { userId: users.freelancer.id } })).toBe(
      0,
    );
  });

  it('creates the profile with tech stacks and keeps the bigint rate exact', async () => {
    const created = await putFreelancer(users.freelancer, {
      ...freelancerBody(),
      userId: users.otherFreelancer.id,
    });
    expect(created.status).toBe(200);
    expect(created.body.data.id).toBe(users.freelancer.id);
    expect(created.body.data.freelancerProfile).toEqual({
      mainCategory: 'WEB',
      techStacks: expect.arrayContaining([
        { id: stacks[0].id, name: stacks[0].name },
        { id: stacks[1].id, name: stacks[1].name },
      ]),
      careerYears: 3,
      hourlyRate: BIG_RATE,
      portfolioUrl: 'https://portfolio.example.com',
    });
    expect(created.body.data.freelancerProfile.techStacks).toHaveLength(2);
    expect(created.body.data.profileCompletion).toEqual({ isComplete: true, missingFields: [] });

    const stored = await prisma.freelancerProfile.findUnique({
      where: { userId: users.freelancer.id },
    });
    expect(stored.hourlyRate).toBe(BigInt(BIG_RATE));
    expect((await me(users.freelancer)).body.data.freelancerProfile.hourlyRate).toBe(BIG_RATE);
    expect(
      await prisma.freelancerProfile.count({ where: { userId: users.otherFreelancer.id } }),
    ).toBe(0);
  });

  it('replaces the tech stack links and other fields on update', async () => {
    const updated = await putFreelancer(users.freelancer, {
      mainCategory: 'DATA_AI',
      techStackIds: [stacks[2].id],
      careerYears: 0,
      hourlyRate: 45000,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.freelancerProfile).toEqual({
      mainCategory: 'DATA_AI',
      techStacks: [{ id: stacks[2].id, name: stacks[2].name }],
      careerYears: 0,
      hourlyRate: '45000',
      portfolioUrl: null,
    });

    const links = await prisma.freelancerTechStack.findMany({
      where: { freelancerId: users.freelancer.id },
    });
    expect(links.map((link) => link.techStackId)).toEqual([stacks[2].id]);
  });

  it('forbids clients and users without a role', async () => {
    const asClient = await putFreelancer(users.otherClient, freelancerBody());
    expect(asClient.status).toBe(403);
    expect(asClient.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.freelancerProfile.count({ where: { userId: users.otherClient.id } })).toBe(
      0,
    );

    const noRole = await putFreelancer(users.noRole, freelancerBody());
    expect(noRole.status).toBe(403);
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');
  });

  it('serializes concurrent saves of the same user', async () => {
    const results = await Promise.all([
      putFreelancer(users.otherFreelancer, { ...freelancerBody(), techStackIds: [stacks[0].id] }),
      putFreelancer(users.otherFreelancer, { ...freelancerBody(), techStackIds: [stacks[1].id] }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const links = await prisma.freelancerTechStack.count({
      where: { freelancerId: users.otherFreelancer.id },
    });
    expect(links).toBe(1);
  });
});

describe('responses never expose secrets', () => {
  it('omits password hashes, refresh tokens and OAuth identifiers', async () => {
    const res = await me(users.freelancer);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash|\$2[aby]\$|tokenHash|providerUserId|refreshToken/);
    expect(res.body.data.hasPassword).toBe(true);
  });
});

describe('requireCompleteProfile (for future project register/apply)', () => {
  it('blocks incomplete profiles with PROFILE_INCOMPLETE and lets complete ones through', async () => {
    const side = express();
    side.get(
      '/guarded',
      createAuthenticate(authConfig),
      createRequireRole(prisma),
      createRequireCompleteProfile(prisma),
      (_req, res) => res.json({ ok: true }),
    );
    side.use(errorHandler);

    const blocked = await request(side).get('/guarded').set(bearer(users.otherClient.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      details: { missingFields: ['companyName', 'businessField'] },
    });

    const noRole = await request(side).get('/guarded').set(bearer(users.noRole.token));
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');

    const allowed = await request(side).get('/guarded').set(bearer(users.client.token));
    expect(allowed.status).toBe(200);
  });
});

describe('tech stacks (PROF-06, PROF-07)', () => {
  it('searches by name or normalized name without login', async () => {
    const res = await request(app)
      .get('/api/tech-stacks')
      .query({ q: `beta ${runId}` });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: stacks[1].id, name: stacks[1].name, isCustom: false }]);

    const normalized = await request(app)
      .get('/api/tech-stacks')
      .query({ q: `T.ALPHA-${runId}` });
    expect(normalized.body.data.map((s) => s.id)).toEqual([stacks[0].id]);
  });

  it('adds a custom stack once and returns the existing one for the same normalized name', async () => {
    const created = await request(app)
      .post('/api/tech-stacks')
      .set(bearer(users.freelancer.token))
      .send({ name: `  My   Stack ${runId} ` });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: `My Stack ${runId}`, isCustom: true });

    const again = await request(app)
      .post('/api/tech-stacks')
      .set(bearer(users.client.token))
      .send({ name: `my.stack-${runId.toUpperCase()}` });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(created.body.data.id);

    const stored = await prisma.techStack.findUnique({ where: { id: created.body.data.id } });
    expect(stored).toMatchObject({ createdById: users.freelancer.id, isCustom: true });

    const invalid = await request(app)
      .post('/api/tech-stacks')
      .set(bearer(users.freelancer.token))
      .send({ name: ' . - ' });
    expect(invalid.status).toBe(400);
    expect((await request(app).post('/api/tech-stacks').send({ name: 'x' })).status).toBe(401);
    const noRole = await request(app)
      .post('/api/tech-stacks')
      .set(bearer(users.noRole.token))
      .send({ name: `none ${runId}` });
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');
  });

  it('seeds the default stacks idempotently', async () => {
    await seedTechStacks(prisma);
    expect(await seedTechStacks(prisma)).toBe(0);
    const names = DEFAULT_TECH_STACKS.map((name) => name);
    expect(await prisma.techStack.count({ where: { name: { in: names } } })).toBeGreaterThanOrEqual(
      DEFAULT_TECH_STACKS.length,
    );
  });
});

describe('profile images (PROF-04)', () => {
  it('re-encodes an upload to a random WebP, sets it and serves it safely', async () => {
    const res = await upload(users.client, await pngImage(), '../../etc/passwd.png', 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(users.client.id);
    expect(res.body.data.profileImageUrl).toMatch(IMAGE_URL);
    expect(JSON.stringify(res.body)).not.toContain(imageDir);
    expect(JSON.stringify(res.body)).not.toContain('passwd');
    expect(await storedFiles()).toEqual([fileOf(res.body.data.profileImageUrl)]);

    const served = await request(app)
      .get(res.body.data.profileImageUrl)
      .buffer(true)
      .parse((r, done) => {
        const chunks = [];
        r.on('data', (chunk) => chunks.push(chunk));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    const meta = await sharp(served.body).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 341 });
  });

  it('replaces the previous file and removes it on delete', async () => {
    const first = (await me(users.client)).body.data.profileImageUrl;
    const replaced = await upload(users.client, await pngImage(200, 200), 'a.png', 'image/png');
    expect(replaced.status).toBe(201);
    const next = replaced.body.data.profileImageUrl;
    expect(next).not.toBe(first);
    expect(await storedFiles()).toEqual([fileOf(next)]);

    const removed = await patchMe(users.client, { profileImageUrl: null });
    expect(removed.status).toBe(200);
    expect(removed.body.data.profileImageUrl).toBeNull();
    expect(await storedFiles()).toEqual([]);
    expect((await request(app).get(next)).status).toBe(404);
  });

  it('rejects SVG, disguised files, oversized files and anonymous uploads', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const svgRes = await upload(users.freelancer, svg, 'a.svg', 'image/svg+xml');
    expect(svgRes.status).toBe(415);
    expect(svgRes.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const executable = Buffer.concat([Buffer.from('MZ'), randomBytes(64)]);
    const disguised = await upload(users.freelancer, executable, 'a.png', 'image/png');
    expect(disguised.status).toBe(415);
    expect(disguised.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const png = await pngImage(50, 50);
    const broken = Buffer.concat([png.subarray(0, 16), randomBytes(64)]);
    const brokenRes = await upload(users.freelancer, broken, 'a.png', 'image/png');
    expect(brokenRes.status).toBe(400);
    expect(brokenRes.body.error.code).toBe('INVALID_IMAGE');

    const huge = Buffer.concat([await pngImage(10, 10), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const hugeRes = await upload(users.freelancer, huge, 'big.png', 'image/png');
    expect(hugeRes.status).toBe(413);
    expect(hugeRes.body.error.code).toBe('FILE_TOO_LARGE');

    expect((await upload(null, await pngImage(10, 10), 'a.png', 'image/png')).status).toBe(401);
    const noRole = await upload(users.noRole, await pngImage(10, 10), 'a.png', 'image/png');
    expect(noRole.body.error.code).toBe('ROLE_REQUIRED');

    const missing = await request(app)
      .post('/api/uploads/profile-image')
      .set(bearer(users.freelancer.token));
    expect(missing.status).toBe(400);

    expect(await storedFiles()).toEqual([]);
    const user = await prisma.user.findUnique({ where: { id: users.freelancer.id } });
    expect(user.profileImageUrl).toBeNull();
  });

  it('serves only stored file names', async () => {
    for (const name of ['..%2F..%2Fpackage.json', 'abc.webp', `${'a'.repeat(32)}.png`]) {
      const res = await request(app).get(`/api/uploads/profile-images/${name}`);
      expect(res.status).toBe(404);
    }
  });
});
