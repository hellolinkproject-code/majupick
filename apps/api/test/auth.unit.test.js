import { randomBytes } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from '../src/config/auth.js';
import { createAuthenticate } from '../src/middlewares/authenticate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { createTrustedOriginGuard } from '../src/middlewares/trustedOrigin.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../src/modules/auth/tokens.js';
import { validateLogin, validateSignup } from '../src/modules/auth/validation.js';
import { getMissingProfileFields, toUserMe } from '../src/modules/users/userMe.js';

const secret = randomBytes(32).toString('hex');
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: secret,
  BCRYPT_ROUNDS: '4',
});

describe('loadAuthConfig', () => {
  it('uses documented defaults and an HttpOnly-friendly cookie policy outside production', () => {
    expect(authConfig).toMatchObject({
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 14,
      bcryptRounds: 4,
      cookieSecure: false,
      cookieSameSite: 'lax',
      ephemeralSecret: false,
    });
  });

  it('requires a long secret in production and forces Secure cookies there', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(
      /JWT_ACCESS_SECRET is required/,
    );
    expect(() => loadAuthConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short' })).toThrow(
      /at least 32/,
    );
    const prod = loadAuthConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: secret });
    expect(prod.cookieSecure).toBe(true);
    expect(prod.cookieSameSite).toBe('lax');
    expect(() =>
      loadAuthConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: secret, BCRYPT_ROUNDS: '4' }),
    ).toThrow(/BCRYPT_ROUNDS/);
  });

  it('allows SameSite=None only with Secure cookies', () => {
    expect(() =>
      loadAuthConfig({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: secret,
        COOKIE_SAME_SITE: 'none',
      }),
    ).toThrow(/COOKIE_SAME_SITE=none requires Secure/);
    const crossSite = loadAuthConfig({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: secret,
      COOKIE_SAME_SITE: 'none',
      COOKIE_SECURE: 'true',
    });
    expect(crossSite).toMatchObject({ cookieSameSite: 'none', cookieSecure: true });
  });

  it('generates a temporary secret in development when none is configured', () => {
    const dev = loadAuthConfig({ NODE_ENV: 'development' });
    expect(dev.ephemeralSecret).toBe(true);
    expect(dev.accessTokenSecret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('validateSignup / validateLogin', () => {
  it('normalizes email and trims the name', () => {
    expect(
      validateSignup({
        name: '  홍길동 ',
        email: '  Hong@Example.COM ',
        password: 'abcd1234',
        role: 'CLIENT',
      }),
    ).toEqual({ name: '홍길동', email: 'hong@example.com', password: 'abcd1234', role: 'CLIENT' });
  });

  it('reports every invalid field at once', () => {
    try {
      validateSignup({ name: ' ', email: 'not-an-email', password: 'short', role: 'ADMIN' });
      expect.unreachable();
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(error.details.fields).sort()).toEqual([
        'email',
        'name',
        'password',
        'role',
      ]);
    }
  });

  it('only requires 8+ characters (no extra composition rules) and rejects passwords bcrypt would truncate', () => {
    expect(() =>
      validateSignup({ name: 'a', email: 'a@b.co', password: 'aaaaaaaa', role: 'FREELANCER' }),
    ).not.toThrow();
    expect(() =>
      validateSignup({ name: 'a', email: 'a@b.co', password: '가'.repeat(25), role: 'CLIENT' }),
    ).toThrow(expect.objectContaining({ details: { fields: { password: expect.any(String) } } }));
  });

  it('requires email and password on login', () => {
    expect(validateLogin({ email: ' A@B.CO ', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
    expect(() => validateLogin({})).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('tokens', () => {
  it('signs and verifies an access token carrying only the user id', () => {
    const token = signAccessToken(42, authConfig);
    const decoded = jwt.decode(token);

    expect(verifyAccessToken(token, authConfig)).toBe(42);
    expect(decoded).toMatchObject({ sub: '42', iss: 'workbridge-api', aud: 'workbridge-web' });
    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it('distinguishes expired tokens from invalid ones', () => {
    const expired = jwt.sign({}, secret, {
      expiresIn: -10,
      subject: '1',
      issuer: 'workbridge-api',
      audience: 'workbridge-web',
    });
    const forged = jwt.sign({}, 'another-secret-another-secret-123', {
      subject: '1',
      issuer: 'workbridge-api',
      audience: 'workbridge-web',
    });
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: '1',
      iss: 'workbridge-api',
      aud: 'workbridge-web',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;

    expect(() => verifyAccessToken(expired, authConfig)).toThrow(
      expect.objectContaining({ status: 401, code: 'TOKEN_EXPIRED' }),
    );
    for (const token of [forged, unsigned, 'garbage']) {
      expect(() => verifyAccessToken(token, authConfig)).toThrow(
        expect.objectContaining({ status: 401, code: 'UNAUTHENTICATED' }),
      );
    }
  });

  it('creates random refresh tokens and stores only a SHA-256 hex hash', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();

    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).not.toContain(a);
  });
});

describe('middlewares', () => {
  function appWith(...middlewares) {
    const app = express();
    app.use(...middlewares);
    app.all('/x', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  it('blocks state-changing requests from untrusted origins', async () => {
    const app = appWith(createTrustedOriginGuard(['http://localhost:5173']));

    expect((await request(app).post('/x').set('Origin', 'http://evil.example')).status).toBe(403);
    expect((await request(app).post('/x').set('Origin', 'http://localhost:5173')).status).toBe(200);
    expect((await request(app).post('/x')).status).toBe(200);
    expect((await request(app).get('/x').set('Origin', 'http://evil.example')).status).toBe(200);
  });

  it('requires a Bearer access token', async () => {
    const app = appWith(createAuthenticate(authConfig));

    const missing = await request(app).get('/x');
    const ok = await request(app)
      .get('/x')
      .set('Authorization', `Bearer ${signAccessToken(7, authConfig)}`);

    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');
    expect(ok.status).toBe(200);
  });
});

describe('UserMe', () => {
  const base = {
    id: 1,
    email: 'a@b.co',
    name: 'A',
    role: 'FREELANCER',
    passwordHash: '$2b$04$hash',
    profileImageUrl: null,
    bio: null,
    socialAccounts: [],
    clientProfile: null,
    freelancerProfile: null,
  };

  it('never exposes the password hash and reports missing profile fields', () => {
    const me = toUserMe(base);

    expect(JSON.stringify(me)).not.toContain('$2b$');
    expect(me).not.toHaveProperty('passwordHash');
    expect(me.hasPassword).toBe(true);
    expect(me.profileCompletion).toEqual({
      isComplete: false,
      missingFields: ['mainCategory', 'techStacks', 'careerYears', 'hourlyRate'],
    });
  });

  it('serializes bigint money as a string and evaluates client profiles', () => {
    const freelancer = toUserMe({
      ...base,
      freelancerProfile: {
        mainCategory: 'WEB',
        careerYears: 0,
        hourlyRate: 9_007_199_254_740_993n,
        portfolioUrl: null,
        techStacks: [{ techStack: { id: 3, name: 'React' } }],
      },
    });

    expect(freelancer.freelancerProfile.hourlyRate).toBe('9007199254740993');
    expect(freelancer.profileCompletion.isComplete).toBe(true);
    expect(getMissingProfileFields({ ...base, role: null })).toEqual(['role']);
    expect(
      getMissingProfileFields({
        ...base,
        role: 'CLIENT',
        clientProfile: { companyName: 'W', businessField: 'ETC', businessFieldEtc: ' ' },
      }),
    ).toEqual(['businessFieldEtc']);
  });
});
