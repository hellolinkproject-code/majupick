import { HttpError } from '../../utils/httpError.js';
import { toUserMe, userMeInclude } from '../users/userMe.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';
import { PASSWORD_MAX_BYTES, passwordByteLength } from './validation.js';

const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
const invalidRefreshToken = () =>
  new HttpError(401, 'INVALID_REFRESH_TOKEN', '로그인이 만료되었습니다. 다시 로그인해 주세요.');

export function createAuthService({ prisma, authConfig }) {
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

  async function revokeAllForUser(db, userId, now) {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  return {
    async signup({ name, email, password, role }) {
      const passwordHash = await hashPassword(password, authConfig.bcryptRounds);
      try {
        const { user, refreshToken } = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { name, email, passwordHash, role },
            include: userMeInclude,
          });
          return { user: created, refreshToken: await storeRefreshToken(tx, created.id) };
        });
        return sessionFor(user, refreshToken);
      } catch (error) {
        // 동시 가입도 users.email UNIQUE 제약이 막는다(P2002).
        if (error?.code === 'P2002') {
          throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', '이미 가입된 이메일입니다.');
        }
        throw error;
      }
    },

    async login({ email, password }) {
      const user = await prisma.user.findUnique({ where: { email }, include: userMeInclude });
      const tooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;
      const ok = await verifyPassword(
        password,
        tooLong ? null : (user?.passwordHash ?? null),
        authConfig.bcryptRounds,
      );
      if (!user || !ok) throw invalidCredentials();

      return sessionFor(user, await storeRefreshToken(prisma, user.id));
    },

    /**
     * Refresh Token 교체(rotation). 이미 무효화된 토큰이 다시 오면 탈취로 보고 그 사용자의 토큰을 모두 무효화한다.
     * 무효화 결과가 롤백되지 않도록 트랜잭션 안에서는 예외 대신 결과 값을 돌려준다.
     */
    async refresh(rawToken) {
      if (!rawToken) throw invalidRefreshToken();
      const tokenHash = hashRefreshToken(rawToken);

      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
        if (!stored) return { ok: false };

        if (stored.revokedAt) {
          await revokeAllForUser(tx, stored.userId, now);
          return { ok: false };
        }
        if (stored.expiresAt <= now) {
          await tx.refreshToken.updateMany({
            where: { id: stored.id, revokedAt: null },
            data: { revokedAt: now },
          });
          return { ok: false };
        }

        // 같은 토큰으로 동시에 들어온 요청은 이 조건부 UPDATE에서 하나만 성공한다.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: stored.id, revokedAt: null },
          data: { revokedAt: now },
        });
        if (count === 0) {
          await revokeAllForUser(tx, stored.userId, now);
          return { ok: false };
        }

        const user = await tx.user.findUnique({
          where: { id: stored.userId },
          include: userMeInclude,
        });
        if (!user) return { ok: false };
        return { ok: true, user, refreshToken: await storeRefreshToken(tx, user.id) };
      });

      if (!result.ok) throw invalidRefreshToken();
      return sessionFor(result.user, result.refreshToken);
    },

    /** 현재 Refresh Token만 무효화한다. 토큰이 없거나 이미 무효여도 성공으로 처리한다(멱등). */
    async logout(rawToken) {
      if (!rawToken) return;
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async getMe(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, include: userMeInclude });
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
      return toUserMe(user);
    },
  };
}
