// Google OAuth(AUTH-06~09) 통합 테스트. Google 토큰 엔드포인트는 Mock으로 대체한다.
// 이번 실행에서 만든 사용자(runId 이메일)와 그 시각 이후의 OAuth 상태 행만 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { createAuthenticate } from '../../src/middlewares/authenticate.js';
import { createRequireRole } from '../../src/middlewares/requireRole.js';
import { HttpError } from '../../src/utils/httpError.js';

const ORIGIN = 'http://localhost:5173';
const runId = `g${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const startedAt = new Date();

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

let prisma;
let app;
let google;
let gate;

function createMockGoogle() {
  const exchanged = [];
  const scripts = new Map();
  return {
    exchanged,
    script(code, value) {
      scripts.set(code, value);
    },
    async createAuthorizationRequest() {
      const state = randomBytes(18).toString('base64url');
      const nonce = randomBytes(18).toString('base64url');
      const codeVerifier = randomBytes(18).toString('base64url');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', 'test-challenge');
      url.searchParams.set('code_challenge_method', 'S256');
      return { url: url.toString(), state, nonce, codeVerifier };
    },
    async exchangeCode({ code, codeVerifier, nonce }) {
      exchanged.push({ code, hasVerifier: Boolean(codeVerifier), nonce });
      const script = scripts.get(code);
      if (!script || script.used) {
        throw new HttpError(
          400,
          'OAUTH_FAILED',
          'Google 로그인에 실패했습니다. 다시 시도해 주세요.',
        );
      }
      script.used = true;
      if (script.error) throw script.error;
      if (!codeVerifier) {
        throw new HttpError(
          400,
          'OAUTH_FAILED',
          'Google 로그인에 실패했습니다. 다시 시도해 주세요.',
        );
      }
      return script.identity;
    },
  };
}

function identity(sub, address, extra = {}) {
  return {
    sub: `${sub}-${runId}`,
    email: address,
    emailVerified: true,
    name: '구글유저',
    ...extra,
  };
}

function cookieValue(res, name) {
  const header = (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith(`${name}=`));
  if (!header) return null;
  return {
    header,
    value: decodeURIComponent(header.split(';')[0].slice(name.length + 1)),
  };
}

async function start(returnTo) {
  const req = request(app).get('/api/auth/oauth/google');
  if (returnTo !== undefined) req.query({ returnTo });
  const res = await req;
  return {
    res,
    state: new URL(res.headers.location).searchParams.get('state'),
    oauth: cookieValue(res, 'wb_oauth'),
  };
}

function callback({ state, oauth, code, error, queryState }) {
  const req = request(app)
    .get('/api/auth/oauth/google/callback')
    .query({
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
      state: queryState === undefined ? state : queryState,
    });
  if (oauth) req.set('Cookie', `wb_oauth=${encodeURIComponent(oauth)}`);
  return req;
}

const failed = (code) =>
  new HttpError(400, code, 'Google 로그인에 실패했습니다. 다시 시도해 주세요.');

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  google = createMockGoogle();
  app = createApp(config, { prisma, authConfig, googleOAuth: google });
  gate = express();
  gate.get('/protected', createAuthenticate(authConfig), createRequireRole(prisma), (req, res) => {
    res.json({ data: { role: req.auth.role } });
  });
  gate.use(errorHandler);
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.user.deleteMany({ where: { email: { endsWith: `.${runId}@workbridge.test` } } });
  await prisma.oAuthTransaction.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.$disconnect();
});

describe('GET /api/auth/oauth/google', () => {
  it('reports when Google is not configured and does not redirect', async () => {
    const disabled = createApp(config, { prisma, authConfig });
    const status = await request(disabled).get('/api/auth/oauth/google/status');
    const startRes = await request(disabled).get('/api/auth/oauth/google');

    expect(status.body.data).toEqual({ enabled: false });
    expect(startRes.status).toBe(503);
    expect(startRes.body.error.code).toBe('OAUTH_NOT_CONFIGURED');
    expect(JSON.stringify(startRes.body)).not.toMatch(/CLIENT_SECRET|id_token|access_token/);
  });

  it('redirects only to Google and stores the state in an HttpOnly cookie', async () => {
    const { res, state, oauth } = await start('/me');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('state')).toBe(state);
    expect(oauth.header).toMatch(/HttpOnly/i);
    expect(oauth.header).toMatch(/Path=\/api\/auth\/oauth/);
    expect(oauth.value).toBe(state);
    expect(res.headers.location).not.toMatch(/client_secret|code_verifier/);
  });

  it('does not keep an external return path', async () => {
    google.script('external-code', { identity: identity('ext', email('external')) });
    const begun = await start('https://evil.example/phish');
    const res = await callback({ ...begun, oauth: begun.oauth.value, code: 'external-code' });
    const location = new URL(res.headers.location);

    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe('/select-role');
    expect(location.searchParams.has('returnTo')).toBe(false);
    expect(res.headers.location).not.toContain('evil.example');
  });
});

describe('Google account creation, login and linking', () => {
  it('creates one user for a new Google account and does not put tokens in the redirect', async () => {
    google.script('new-code', { identity: identity('new', email('new'), { name: '새유저' }) });
    const begun = await start('/projects/3');
    const res = await callback({ ...begun, oauth: begun.oauth.value, code: 'new-code' });
    const location = new URL(res.headers.location);
    const refresh = cookieValue(res, 'wb_rt');

    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/select-role`);
    expect(location.searchParams.get('returnTo')).toBe('/projects/3');
    expect(res.headers.location).not.toMatch(/new-code|id_token|access_token|wb_rt/);
    expect(refresh.header).toMatch(/HttpOnly/i);
    expect(refresh.value).not.toContain('.');

    const user = await prisma.user.findUnique({
      where: { email: email('new') },
      include: { socialAccounts: true },
    });
    expect(user).toMatchObject({ name: '새유저', role: null, passwordHash: null });
    expect(user.socialAccounts).toMatchObject([
      { provider: 'GOOGLE', providerUserId: `new-${runId}`, emailAtLink: email('new') },
    ]);

    const again = await callback({ ...begun, oauth: begun.oauth.value, code: 'new-code' });
    expect(new URL(again.headers.location).searchParams.get('error')).toBe('OAUTH_FAILED');
    expect(google.exchanged.filter((call) => call.code === 'new-code')).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: email('new') } })).toBe(1);
  });

  it('logs in an existing Google user without creating another account', async () => {
    google.script('return-code', { identity: identity('new', email('new')) });
    const begun = await start();
    const res = await callback({ ...begun, oauth: begun.oauth.value, code: 'return-code' });

    expect(new URL(res.headers.location).pathname).toBe('/select-role');
    expect(await prisma.user.count({ where: { email: email('new') } })).toBe(1);
    expect(await prisma.socialAccount.count({ where: { providerUserId: `new-${runId}` } })).toBe(1);

    const session = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_rt=${cookieValue(res, 'wb_rt').value}`);
    expect(session.status).toBe(200);
    expect(session.body.data.user.email).toBe(email('new'));
    expect(jwt.decode(session.body.data.accessToken).iss).toBe('workbridge-api');

    const loggedOut = await request(app)
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_rt=${cookieValue(session, 'wb_rt').value}`);
    expect(loggedOut.status).toBe(204);
    expect(
      (
        await request(app)
          .post('/api/auth/refresh')
          .set('Origin', ORIGIN)
          .set('Cookie', `wb_rt=${cookieValue(session, 'wb_rt').value}`)
      ).status,
    ).toBe(401);
  });

  it('does not auto-link the same email and links only after the password matches', async () => {
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', ORIGIN)
      .send({
        name: '기존회원',
        email: email('linked'),
        password: PASSWORD,
        role: 'CLIENT',
      });
    google.script('link-code', {
      identity: identity('link', email('linked'), { name: '다른이름' }),
    });
    const begun = await start('/me');
    const pending = await callback({ ...begun, oauth: begun.oauth.value, code: 'link-code' });
    const pendingUrl = new URL(pending.headers.location);

    expect(pendingUrl.pathname).toBe('/oauth/link');
    expect(pendingUrl.searchParams.get('email')).toBe(`l***@${email('linked').split('@')[1]}`);
    expect(cookieValue(pending, 'wb_rt')).toBeNull();
    expect(cookieValue(pending, 'wb_link').header).toMatch(/HttpOnly/i);
    expect(await prisma.user.count({ where: { email: email('linked') } })).toBe(1);
    expect(await prisma.socialAccount.count({ where: { providerUserId: `link-${runId}` } })).toBe(
      0,
    );

    const wrong = await request(app)
      .post('/api/auth/oauth/link')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_link=${cookieValue(pending, 'wb_link').value}`)
      .send({ password: `${PASSWORD}-no` });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.socialAccount.count({ where: { providerUserId: `link-${runId}` } })).toBe(
      0,
    );

    const linked = await request(app)
      .post('/api/auth/oauth/link')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_link=${cookieValue(pending, 'wb_link').value}`)
      .send({ password: PASSWORD });
    expect(linked.status).toBe(200);
    expect(linked.body.data.user).toMatchObject({
      email: email('linked'),
      name: '기존회원',
      role: 'CLIENT',
      hasPassword: true,
      socialProviders: ['GOOGLE'],
    });
    expect(cookieValue(linked, 'wb_link').header).toMatch(/wb_link=;/);

    const emailLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({
        email: email('linked'),
        password: PASSWORD,
      });
    expect(emailLogin.status).toBe(200);
    expect(emailLogin.body.data.user.id).toBe(linked.body.data.user.id);

    google.script('link-again', { identity: identity('link', email('linked')) });
    const second = await start();
    const direct = await callback({ ...second, oauth: second.oauth.value, code: 'link-again' });
    expect(new URL(direct.headers.location).pathname).toBe('/oauth/complete');
    expect(await prisma.user.count({ where: { email: email('linked') } })).toBe(1);
  });

  it('refuses to link an account that has no password', async () => {
    await prisma.user.create({
      data: { email: email('nopw'), name: '비번없음', role: 'FREELANCER', passwordHash: null },
    });
    google.script('nopw-code', { identity: identity('nopw', email('nopw')) });
    const begun = await start();
    const res = await callback({ ...begun, oauth: begun.oauth.value, code: 'nopw-code' });

    expect(new URL(res.headers.location).searchParams.get('error')).toBe('OAUTH_LINK_UNAVAILABLE');
    expect(cookieValue(res, 'wb_link')).toBeNull();
    expect(await prisma.socialAccount.count({ where: { providerUserId: `nopw-${runId}` } })).toBe(
      0,
    );
    expect(await prisma.user.count({ where: { email: email('nopw') } })).toBe(1);
  });

  it('rejects an unverified email, a bad state, an expired request and a rejected ID token', async () => {
    google.script('unverified', {
      error: new HttpError(
        403,
        'OAUTH_EMAIL_UNVERIFIED',
        'Google 계정의 이메일이 인증되지 않아 로그인할 수 없습니다.',
      ),
    });
    google.script('bad-token', { error: failed('OAUTH_FAILED') });

    const unverified = await start();
    const unverifiedRes = await callback({
      ...unverified,
      oauth: unverified.oauth.value,
      code: 'unverified',
    });
    expect(new URL(unverifiedRes.headers.location).searchParams.get('error')).toBe(
      'OAUTH_EMAIL_UNVERIFIED',
    );

    const badState = await start();
    const badStateRes = await callback({
      ...badState,
      oauth: badState.oauth.value,
      code: 'bad-token',
      queryState: 'not-the-state',
    });
    expect(new URL(badStateRes.headers.location).searchParams.get('error')).toBe('OAUTH_FAILED');
    expect(google.exchanged.some((call) => call.code === 'bad-token')).toBe(false);

    const retry = await callback({ ...badState, oauth: badState.oauth.value, code: 'bad-token' });
    expect(new URL(retry.headers.location).searchParams.get('error')).toBe('OAUTH_FAILED');

    const expired = await start();
    await prisma.oAuthTransaction.updateMany({
      where: { tokenHash: { not: '' }, createdAt: { gte: startedAt }, codeVerifier: { not: null } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredRes = await callback({
      ...expired,
      oauth: expired.oauth.value,
      code: 'bad-token',
    });
    expect(new URL(expiredRes.headers.location).searchParams.get('error')).toBe('OAUTH_EXPIRED');

    expect(await prisma.user.count({ where: { email: email('unverified') } })).toBe(0);
  });

  it('treats a cancelled Google prompt as a cancellation and drops the state', async () => {
    const begun = await start();
    const res = await callback({ ...begun, oauth: begun.oauth.value, error: 'access_denied' });

    expect(new URL(res.headers.location).searchParams.get('error')).toBe('OAUTH_CANCELLED');
    expect(cookieValue(res, 'wb_rt')).toBeNull();
    expect(
      await prisma.oAuthTransaction.count({
        where: {
          createdAt: { gte: startedAt },
          codeVerifier: { not: null },
          expiresAt: { gt: new Date() },
        },
      }),
    ).toBe(0);
  });

  it('creates only one user when the same Google account signs in at the same time', async () => {
    const sub = identity('race', email('race'));
    google.script('race-a', { identity: sub });
    google.script('race-b', { identity: sub });
    const [first, second] = await Promise.all([start(), start()]);
    const results = await Promise.all([
      callback({ ...first, oauth: first.oauth.value, code: 'race-a' }),
      callback({ ...second, oauth: second.oauth.value, code: 'race-b' }),
    ]);

    expect(results.every((res) => res.status === 302)).toBe(true);
    expect(results.some((res) => new URL(res.headers.location).pathname === '/select-role')).toBe(
      true,
    );
    expect(await prisma.user.count({ where: { email: email('race') } })).toBe(1);
    expect(await prisma.socialAccount.count({ where: { providerUserId: `race-${runId}` } })).toBe(
      1,
    );
  });
});

describe('PATCH /api/auth/role', () => {
  it('requires a role for protected APIs and allows them after the choice', async () => {
    google.script('role-code', { identity: identity('role', email('role')) });
    const begun = await start();
    const created = await callback({ ...begun, oauth: begun.oauth.value, code: 'role-code' });
    const session = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `wb_rt=${cookieValue(created, 'wb_rt').value}`);
    const token = session.body.data.accessToken;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    const blocked = await request(gate).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBeNull();
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ROLE_REQUIRED');

    const selected = await request(app)
      .patch('/api/auth/role')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'FREELANCER' });
    expect(selected.status).toBe(200);
    expect(selected.body.data).toMatchObject({ role: 'FREELANCER', email: email('role') });
    expect(selected.body.data.profileCompletion.missingFields).not.toContain('role');

    const allowed = await request(gate).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.role).toBe('FREELANCER');

    const again = await request(app)
      .patch('/api/auth/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'CLIENT' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ROLE_ALREADY_SET');
    expect((await prisma.user.findUnique({ where: { email: email('role') } })).role).toBe(
      'FREELANCER',
    );
  });

  it('rejects a role change for an email account that already chose one', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .set('Origin', ORIGIN)
      .send({
        name: '이메일',
        email: email('email-role'),
        password: PASSWORD,
        role: 'CLIENT',
      });
    const res = await request(app)
      .patch('/api/auth/role')
      .set('Authorization', `Bearer ${signup.body.data.accessToken}`)
      .send({ role: 'FREELANCER' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROLE_ALREADY_SET');
  });
});
