// 이메일 인증 API(AUTH-01~05) 통합 테스트. 실제 PostgreSQL(workbridge_test) + Supertest.
// 이번 실행에서 만든 사용자(runId 이메일)만 만들고 지운다. Refresh Token은 사용자 삭제 시 CASCADE로 지워진다.
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';

const ORIGIN = 'http://localhost:5173';
const runId = `a${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authEnv = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
};
const authConfig = loadAuthConfig(authEnv);

let prisma;
let app;

function refreshCookieFrom(res) {
  const header = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('wb_rt='));
  if (!header) return null;
  return { header, value: decodeURIComponent(header.split(';')[0].slice('wb_rt='.length)) };
}

const post = (path, body) => request(app).post(`/api/auth${path}`).set('Origin', ORIGIN).send(body);
const refreshWith = (token) =>
  request(app).post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', `wb_rt=${token}`);
const me = (accessToken) =>
  request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);

function signup(name, overrides = {}) {
  return post('/signup', {
    name,
    email: email(name),
    password: PASSWORD,
    role: 'CLIENT',
    ...overrides,
  });
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.user.deleteMany({ where: { email: { endsWith: `.${runId}@workbridge.test` } } });
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('creates a user, hashes the password, logs in and sets an HttpOnly refresh cookie', async () => {
    const res = await signup('client', {
      name: '  김의뢰 ',
      email: `  CLIENT.${runId}@WorkBridge.test `,
    });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      email: email('client'),
      name: '김의뢰',
      role: 'CLIENT',
      hasPassword: true,
      profileCompletion: { isComplete: false, missingFields: ['companyName', 'businessField'] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const cookie = refreshCookieFrom(res);
    expect(cookie.header).toMatch(/HttpOnly/i);
    expect(cookie.header).toMatch(/SameSite=Lax/i);
    expect(cookie.header).toMatch(/Path=\/api\/auth/);
    expect(cookie.header).not.toMatch(/Secure/i);
    expect(JSON.stringify(res.body)).not.toContain(cookie.value);

    const user = await prisma.user.findUnique({ where: { email: email('client') } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$04\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toBe(hashRefreshToken(cookie.value));
    expect(tokens[0].tokenHash).not.toBe(cookie.value);
  });

  it('stores the FREELANCER role and does not create a profile on signup', async () => {
    const res = await signup('freelancer', { role: 'FREELANCER' });
    const user = await prisma.user.findUnique({
      where: { email: email('freelancer') },
      include: { clientProfile: true, freelancerProfile: true },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('FREELANCER');
    expect(user).toMatchObject({
      role: 'FREELANCER',
      clientProfile: null,
      freelancerProfile: null,
    });
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    await signup('dup');
    const res = await signup('dup', { email: email('dup').toUpperCase() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('lets only one of two simultaneous signups with the same email succeed', async () => {
    const [a, b] = await Promise.all([signup('race'), signup('race')]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email: email('race') } })).toBe(1);
  });

  it('rejects invalid input without creating a user', async () => {
    const res = await post('/signup', {
      name: '',
      email: `bad-${runId}`,
      password: 'short',
      role: 'ADMIN',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual([
      'email',
      'name',
      'password',
      'role',
    ]);
    expect(
      await prisma.user.count({ where: { email: { contains: runId, startsWith: 'bad' } } }),
    ).toBe(0);
  });

  it('rejects requests from an untrusted origin', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://evil.example')
      .send({ name: 'x', email: email('evil'), password: PASSWORD, role: 'CLIENT' });

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: email('evil') } })).toBe(0);
  });
});

describe('POST /api/auth/login and GET /api/auth/me', () => {
  beforeAll(async () => {
    await signup('login', { role: 'FREELANCER' });
  });

  it('issues an access token and refresh cookie, and the token reads the current user', async () => {
    const res = await post('/login', {
      email: `  LOGIN.${runId}@workbridge.test`,
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(refreshCookieFrom(res)).not.toBeNull();
    const profile = await me(res.body.data.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ email: email('login'), role: 'FREELANCER' });
    expect(profile.body.data).not.toHaveProperty('passwordHash');
  });

  it('answers a wrong password and an unknown email with the same 401', async () => {
    const wrong = await post('/login', { email: email('login'), password: `${PASSWORD}x` });
    const unknown = await post('/login', { email: email('nobody'), password: PASSWORD });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
      expect(refreshCookieFrom(res)).toBeNull();
    }
  });

  it('blocks the protected API without, with an invalid, or with an expired access token', async () => {
    const user = await prisma.user.findUnique({ where: { email: email('login') } });
    const expired = jwt.sign({}, authEnv.JWT_ACCESS_SECRET, {
      expiresIn: -1,
      subject: String(user.id),
      issuer: 'workbridge-api',
      audience: 'workbridge-web',
    });

    const none = await request(app).get('/api/auth/me');
    const invalid = await me('not-a-jwt');
    const expiredRes = await me(expired);

    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('UNAUTHENTICATED');
    expect(invalid.body.error.code).toBe('UNAUTHENTICATED');
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rate-limits repeated failed logins', async () => {
    const limitedApp = createApp(config, {
      prisma,
      authConfig: loadAuthConfig({ ...authEnv, LOGIN_RATE_LIMIT_MAX: '2' }),
    });
    const attempt = () =>
      request(limitedApp)
        .post('/api/auth/login')
        .send({ email: email('login'), password: 'wrong-password' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/auth/refresh (rotation) and /api/auth/logout', () => {
  it('rotates the refresh token and revokes the previous one', async () => {
    const login = await signup('rotate');
    const first = refreshCookieFrom(login).value;

    const res = await refreshWith(first);
    const second = refreshCookieFrom(res).value;

    expect(res.status).toBe(200);
    expect(second).not.toBe(first);
    expect((await me(res.body.data.accessToken)).status).toBe(200);
    expect(res.body.data.user.email).toBe(email('rotate'));

    const old = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(first) },
    });
    const current = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(second) },
    });
    expect(old.revokedAt).not.toBeNull();
    expect(current.revokedAt).toBeNull();
  });

  it('treats reuse of a rotated token as theft and revokes every token of that user', async () => {
    const login = await signup('reuse');
    const first = refreshCookieFrom(login).value;
    const second = refreshCookieFrom(await refreshWith(first)).value;

    const reused = await refreshWith(first);
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(refreshCookieFrom(reused).header).toMatch(/wb_rt=;/);

    const afterTheft = await refreshWith(second);
    expect(afterTheft.status).toBe(401);
    const user = await prisma.user.findUnique({ where: { email: email('reuse') } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it('allows only one of two simultaneous refreshes with the same token', async () => {
    const login = await signup('concurrent');
    const token = refreshCookieFrom(login).value;

    const results = await Promise.all([refreshWith(token), refreshWith(token)]);

    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(results.some((r) => r.status === 401)).toBe(true);
  });

  it('rejects missing, unknown and expired refresh tokens', async () => {
    const login = await signup('expired');
    const user = await prisma.user.findUnique({ where: { email: email('expired') } });
    const expiredRaw = `expired-${randomBytes(16).toString('hex')}`;
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(expiredRaw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const missing = await request(app).post('/api/auth/refresh').set('Origin', ORIGIN);
    const unknown = await refreshWith('unknown-token');
    const expired = await refreshWith(expiredRaw);

    for (const res of [missing, unknown, expired]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    }
    expect(refreshCookieFrom(login)).not.toBeNull();
    expect((await refreshWith(refreshCookieFrom(login).value)).status).toBe(200);
  });

  it('logs out by revoking the current refresh token and clearing the cookie', async () => {
    const login = await signup('logout');
    const token = refreshCookieFrom(login).value;

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_rt=${token}`);

    expect(res.status).toBe(204);
    expect(refreshCookieFrom(res).header).toMatch(/wb_rt=;.*Expires=Thu, 01 Jan 1970/);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
    });
    expect(stored.revokedAt).not.toBeNull();

    const afterLogout = await refreshWith(token);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('returns 204 for logout without a cookie (idempotent)', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', ORIGIN);

    expect(res.status).toBe(204);
  });
});
