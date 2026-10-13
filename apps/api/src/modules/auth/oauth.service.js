import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { toUserMe, userMeInclude } from '../users/userMe.js';
import { OAUTH_TTL_MS } from './googleOAuth.js';
import { verifyPassword } from './password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';
import { PASSWORD_MAX_BYTES, passwordByteLength } from './validation.js';

const userInclude = Object.freeze({
  ...userMeInclude,
  socialAccounts: true,
});

function oauthFailed() {
  return new HttpError(400, 'OAUTH_FAILED', 'Google 로그인에 실패했습니다. 다시 시도해 주세요.');
}

function linkExpired() {
  return new HttpError(
    401,
    'OAUTH_LINK_EXPIRED',
    '계정 연결 확인 시간이 지났습니다. 다시 로그인해 주세요.',
  );
}

function linkUnavailable() {
  return new HttpError(
    409,
    'OAUTH_LINK_UNAVAILABLE',
    '이 계정은 비밀번호로 소유를 확인할 수 없어 Google 계정을 연결할 수 없습니다. 기존 로그인 방법을 이용해 주세요.',
  );
}

function invalidCredentials() {
  return new HttpError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 로그인 화면에 보여줄 마스킹 이메일. 전체 주소는 URL에 넣지 않는다. */
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain || email.split('@').length !== 2) return '***';
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function createOAuthService({ prisma, authConfig, googleOAuth }) {
  const refreshTtlMs = authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

  async function storeRefreshToken(db, userId) {
    const refreshToken = generateRefreshToken();
    await db.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });
    return refreshToken;
  }

  function sessionFor(user, refreshToken) {
    return {
      accessToken: signAccessToken(user.id, authConfig),
      refreshToken,
      user: toUserMe(user),
    };
  }

  async function takeTransaction(tokenHash, kind) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.oAuthTransaction.findUnique({ where: { tokenHash } });
      if (!row || row.kind !== kind) return { status: 'missing' };
      const { count } = await tx.oAuthTransaction.deleteMany({ where: { id: row.id } });
      if (count !== 1) return { status: 'missing' };
      if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
      return { status: 'ok', row };
    });
  }

  async function resolveGoogleAccount(tx, identity) {
    const social = await tx.socialAccount.findUnique({
      where: {
        provider_providerUserId: { provider: 'GOOGLE', providerUserId: identity.sub },
      },
      include: { user: { include: userInclude } },
    });
    if (social) return { action: 'login', user: social.user };

    const existing = await tx.user.findUnique({
      where: { email: identity.email },
      include: userInclude,
    });
    if (existing) {
      const linked = existing.socialAccounts.find((account) => account.provider === 'GOOGLE');
      // 이메일만 같다는 이유로 연결하지 않는다. 비밀번호가 없거나 다른 Google 계정이
      // 이미 연결되어 있으면 소유를 증명할 수 없으므로 연결을 거부한다.
      if (linked || !existing.passwordHash) return { action: 'unavailable' };
      return { action: 'link', user: existing };
    }

    const user = await tx.user.create({
      data: {
        email: identity.email,
        name: identity.name,
        role: null,
        passwordHash: null,
        socialAccounts: {
          create: {
            provider: 'GOOGLE',
            providerUserId: identity.sub,
            emailAtLink: identity.email,
          },
        },
      },
      include: userInclude,
    });
    return { action: 'created', user };
  }

  async function loginOrCreate(identity) {
    try {
      return await prisma.$transaction((tx) => resolveGoogleAccount(tx, identity));
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      // 동시에 같은 Google 계정으로 가입해도 UNIQUE 제약이 두 번째 사용자를 막는다.
      return prisma.$transaction((tx) => resolveGoogleAccount(tx, identity));
    }
  }

  return {
    async beginGoogleLogin(returnTo) {
      if (!googleOAuth) {
        throw new HttpError(503, 'OAUTH_NOT_CONFIGURED', 'Google 로그인이 설정되어 있지 않습니다.');
      }
      await prisma.oAuthTransaction.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const request = await googleOAuth.createAuthorizationRequest();
      await prisma.oAuthTransaction.create({
        data: {
          kind: 'LOGIN',
          tokenHash: hashRefreshToken(request.state),
          codeVerifier: request.codeVerifier,
          nonce: request.nonce,
          returnTo,
          expiresAt: new Date(Date.now() + OAUTH_TTL_MS),
        },
      });
      return { authorizationUrl: request.url, state: request.state };
    },

    async completeGoogleLogin({ cookieState, queryState, code, providerError }) {
      const statesMatch = safeEqual(cookieState, queryState);
      if (statesMatch && (providerError || !code)) {
        await prisma.oAuthTransaction.deleteMany({
          where: { tokenHash: hashRefreshToken(cookieState), kind: 'LOGIN' },
        });
      }
      if (providerError === 'access_denied' && statesMatch) {
        throw new HttpError(400, 'OAUTH_CANCELLED', 'Google 로그인을 취소했습니다.');
      }
      if (!statesMatch || providerError || !code) throw oauthFailed();

      const taken = await takeTransaction(hashRefreshToken(cookieState), 'LOGIN');
      if (taken.status === 'expired') {
        throw new HttpError(
          400,
          'OAUTH_EXPIRED',
          'Google 로그인 요청 시간이 지났습니다. 다시 시도해 주세요.',
        );
      }
      if (taken.status !== 'ok' || !taken.row.codeVerifier || !taken.row.nonce) throw oauthFailed();

      const identity = await googleOAuth.exchangeCode({
        code,
        codeVerifier: taken.row.codeVerifier,
        nonce: taken.row.nonce,
      });
      if (identity.emailVerified !== true) {
        throw new HttpError(
          403,
          'OAUTH_EMAIL_UNVERIFIED',
          'Google 계정의 이메일이 인증되지 않아 로그인할 수 없습니다.',
        );
      }

      const resolved = await loginOrCreate(identity);
      if (resolved.action === 'unavailable') return { type: 'unavailable' };
      if (resolved.action === 'link') {
        const linkToken = generateRefreshToken();
        await prisma.oAuthTransaction.create({
          data: {
            kind: 'LINK',
            tokenHash: hashRefreshToken(linkToken),
            providerUserId: identity.sub,
            email: identity.email,
            userId: resolved.user.id,
            returnTo: taken.row.returnTo,
            expiresAt: new Date(Date.now() + OAUTH_TTL_MS),
          },
        });
        return {
          type: 'link',
          linkToken,
          maskedEmail: maskEmail(identity.email),
          returnTo: taken.row.returnTo,
        };
      }

      return {
        type: 'session',
        session: sessionFor(resolved.user, await storeRefreshToken(prisma, resolved.user.id)),
        destination: resolved.user.role ? 'complete' : 'select-role',
        returnTo: taken.row.returnTo,
      };
    },

    async linkGoogleAccount({ linkToken, password }) {
      if (!linkToken) throw linkExpired();
      const tokenHash = hashRefreshToken(linkToken);
      const row = await prisma.oAuthTransaction.findUnique({ where: { tokenHash } });
      if (!row || row.kind !== 'LINK' || !row.userId || !row.providerUserId || !row.email) {
        throw linkExpired();
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        await prisma.oAuthTransaction.deleteMany({ where: { id: row.id } });
        throw linkExpired();
      }

      const user = await prisma.user.findUnique({
        where: { id: row.userId },
        include: userInclude,
      });
      if (!user) {
        await prisma.oAuthTransaction.deleteMany({ where: { id: row.id } });
        throw linkExpired();
      }

      const tooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;
      if (!user.passwordHash) {
        await verifyPassword(password, null, authConfig.bcryptRounds);
        throw linkUnavailable();
      }
      const matches = await verifyPassword(
        password,
        tooLong ? null : user.passwordHash,
        authConfig.bcryptRounds,
      );
      if (!matches) throw invalidCredentials();

      const linked = await prisma.$transaction(async (tx) => {
        const { count } = await tx.oAuthTransaction.deleteMany({
          where: { id: row.id, kind: 'LINK' },
        });
        if (count !== 1) return { status: 'consumed' };

        const existing = await tx.socialAccount.findUnique({
          where: {
            provider_providerUserId: { provider: 'GOOGLE', providerUserId: row.providerUserId },
          },
        });
        if (existing) {
          return existing.userId === user.id ? { status: 'ready' } : { status: 'unavailable' };
        }
        const sameProvider = await tx.socialAccount.findUnique({
          where: { userId_provider: { userId: user.id, provider: 'GOOGLE' } },
        });
        if (sameProvider) return { status: 'unavailable' };

        try {
          await tx.socialAccount.create({
            data: {
              userId: user.id,
              provider: 'GOOGLE',
              providerUserId: row.providerUserId,
              emailAtLink: row.email,
            },
          });
        } catch (error) {
          if (error?.code !== 'P2002') throw error;
          const winner = await tx.socialAccount.findUnique({
            where: {
              provider_providerUserId: { provider: 'GOOGLE', providerUserId: row.providerUserId },
            },
          });
          if (!winner || winner.userId !== user.id) return { status: 'unavailable' };
        }
        return { status: 'ready' };
      });

      if (linked.status === 'consumed') throw linkExpired();
      if (linked.status === 'unavailable') throw linkUnavailable();

      const fresh = await prisma.user.findUnique({
        where: { id: user.id },
        include: userInclude,
      });
      return sessionFor(fresh, await storeRefreshToken(prisma, fresh.id));
    },
  };
}
