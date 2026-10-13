import { generateKeyPairSync, randomBytes } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from '../src/config/auth.js';
import { loadGoogleOAuthConfig } from '../src/config/google.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { createAuthenticate } from '../src/middlewares/authenticate.js';
import { createRequireRole } from '../src/middlewares/requireRole.js';
import {
  createGoogleOAuthClient,
  googleDisplayName,
  readGoogleIdentity,
  verifyGoogleIdToken,
} from '../src/modules/auth/googleOAuth.js';
import { maskEmail } from '../src/modules/auth/oauth.service.js';
import { safeReturnTo } from '../src/modules/auth/returnTo.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';

const CLIENT_ID = 'workbridge-test.apps.googleusercontent.com';
const SECRET = 'google-client-secret-should-not-leak';
const REDIRECT = 'http://localhost:5173/api/auth/oauth/google/callback';
const ORIGINS = ['http://localhost:5173'];
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const certs = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) };

function signIdToken(
  overrides = {},
  { key = privateKey, kid = 'test-key', expiresIn = '1h' } = {},
) {
  const {
    iss = 'https://accounts.google.com',
    aud = CLIENT_ID,
    sub = 'google-sub-1',
    ...claims
  } = overrides;
  return jwt.sign(
    {
      nonce: 'nonce-1',
      email: 'user@example.com',
      email_verified: true,
      name: '홍길동',
      ...claims,
    },
    key,
    {
      algorithm: 'RS256',
      header: { kid, alg: 'RS256' },
      expiresIn,
      issuer: iss,
      audience: aud,
      subject: sub,
    },
  );
}

describe('loadGoogleOAuthConfig', () => {
  it('stays disabled when no Google variables are set', () => {
    expect(loadGoogleOAuthConfig({}, { corsOrigins: ORIGINS })).toEqual({ enabled: false });
  });

  it('rejects a partial or unsafe redirect configuration without echoing secrets', () => {
    expect(() =>
      loadGoogleOAuthConfig({ GOOGLE_CLIENT_ID: 'id' }, { corsOrigins: ORIGINS }),
    ).toThrow(/GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI/);
    expect(() =>
      loadGoogleOAuthConfig(
        {
          GOOGLE_CLIENT_ID: 'id',
          GOOGLE_CLIENT_SECRET: SECRET,
          GOOGLE_REDIRECT_URI: 'https://evil.example/api/auth/oauth/google/callback',
        },
        { corsOrigins: ORIGINS },
      ),
    ).toThrow(/CORS_ORIGIN/);
    expect(() =>
      loadGoogleOAuthConfig(
        {
          GOOGLE_CLIENT_ID: 'id',
          GOOGLE_CLIENT_SECRET: SECRET,
          GOOGLE_REDIRECT_URI: 'https://localhost:5173/callback',
        },
        { corsOrigins: ['https://localhost:5173'] },
      ),
    ).toThrow(/path must be/);
  });
});

describe('Google authorization request', () => {
  it('builds an authorization-code URL with PKCE, state and nonce, and omits the client secret', async () => {
    const google = createGoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      redirectUri: REDIRECT,
    });
    const request = await google.createAuthorizationRequest();
    const url = new URL(request.url);

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toEqual(expect.any(String));
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('nonce')).toBe(request.nonce);
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(request.url).not.toContain(SECRET);
    expect(request.codeVerifier).not.toBe(url.searchParams.get('code_challenge'));
  });
});

describe('Google ID token verification', () => {
  it('accepts a signed token and keeps only the identity claims', async () => {
    const identity = await verifyGoogleIdToken(signIdToken({}), {
      audience: CLIENT_ID,
      certs,
      nonce: 'nonce-1',
    });

    expect(identity).toEqual({
      sub: 'google-sub-1',
      email: 'user@example.com',
      emailVerified: true,
      name: '홍길동',
    });
    expect(JSON.stringify(identity)).not.toMatch(/eyJ/);
  });

  it('rejects a bad signature, the wrong audience, issuer or expiry, and an unverified email', async () => {
    const cases = [
      signIdToken({}, { key: otherKey }),
      signIdToken({ aud: 'other-client' }),
      signIdToken({ iss: 'https://evil.example' }),
      signIdToken({}, { expiresIn: -400 }),
      signIdToken({}, { kid: 'missing' }),
    ];

    for (const token of cases) {
      await expect(
        verifyGoogleIdToken(token, { audience: CLIENT_ID, certs, nonce: 'nonce-1' }),
      ).rejects.toMatchObject({
        code: 'OAUTH_FAILED',
        message: 'Google 로그인에 실패했습니다. 다시 시도해 주세요.',
      });
    }

    expect(() =>
      readGoogleIdentity(
        {
          sub: 'google-sub-1',
          email: 'user@example.com',
          email_verified: false,
          nonce: 'nonce-1',
        },
        'nonce-1',
      ),
    ).toThrow(expect.objectContaining({ code: 'OAUTH_EMAIL_UNVERIFIED' }));
    expect(() =>
      readGoogleIdentity(
        { sub: 'google-sub-1', email: 'user@example.com', email_verified: true, nonce: 'other' },
        'nonce-1',
      ),
    ).toThrow(expect.objectContaining({ code: 'OAUTH_FAILED' }));
  });
});

describe('OAuth return path and link display', () => {
  it('blocks external redirects and auth-page loops', () => {
    expect(safeReturnTo('/me?tab=1')).toBe('/me?tab=1');
    expect(safeReturnTo('https://evil.example/phish')).toBeNull();
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('/\\evil')).toBeNull();
    expect(safeReturnTo('/login')).toBeNull();
    expect(safeReturnTo('/select-role')).toBeNull();
  });

  it('masks the email and shortens a long Google name', () => {
    expect(maskEmail('hong@example.com')).toBe('h***@example.com');
    expect(googleDisplayName(`김${'가'.repeat(80)}`, 'a@b.co').length).toBeLessThanOrEqual(50);
    expect(googleDisplayName('', 'local-part@example.com')).toBe('local-part');
  });
});

describe('requireRole', () => {
  const authConfig = loadAuthConfig({
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  });

  function appFor(user) {
    const prisma = { user: { findUnique: async () => user } };
    const app = express();
    app.get('/protected', createAuthenticate(authConfig), createRequireRole(prisma), (req, res) => {
      res.json({ data: { role: req.auth.role } });
    });
    app.use(errorHandler);
    return app;
  }

  it('blocks an authenticated user until a role is chosen', async () => {
    const token = signAccessToken(7, authConfig);
    const blocked = await request(appFor({ role: null }))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    const allowed = await request(appFor({ role: 'CLIENT' }))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ROLE_REQUIRED');
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.role).toBe('CLIENT');
  });
});
