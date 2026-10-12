import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createTrustedOriginGuard } from '../../middlewares/trustedOrigin.js';
import { HttpError } from '../../utils/httpError.js';
import { createAuthService } from './auth.service.js';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from './cookies.js';
import { validateLogin, validateSignup } from './validation.js';

/** AUTH-01~05. Google OAuth(AUTH-06~09)는 STEP 04-B에서 추가한다. */
export function createAuthRouter({ prisma, config, authConfig }) {
  const router = Router();
  const service = createAuthService({ prisma, authConfig });
  const authenticate = createAuthenticate(authConfig);

  const loginLimiter = rateLimit({
    windowMs: authConfig.loginRateLimit.windowMs,
    limit: authConfig.loginRateLimit.max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'RATE_LIMITED',
          '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        ),
      ),
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(createTrustedOriginGuard(config.corsOrigins));
  router.use(cookieParser());

  const sendSession = (res, status, session) => {
    setRefreshCookie(res, session.refreshToken, authConfig);
    res.status(status).json({ data: { accessToken: session.accessToken, user: session.user } });
  };

  router.post('/signup', async (req, res) => {
    sendSession(res, 201, await service.signup(validateSignup(req.body)));
  });

  router.post('/login', loginLimiter, async (req, res) => {
    sendSession(res, 200, await service.login(validateLogin(req.body)));
  });

  router.post('/refresh', async (req, res) => {
    try {
      sendSession(res, 200, await service.refresh(req.cookies?.[REFRESH_COOKIE_NAME]));
    } catch (error) {
      if (error instanceof HttpError && error.code === 'INVALID_REFRESH_TOKEN') {
        clearRefreshCookie(res, authConfig);
      }
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
    clearRefreshCookie(res, authConfig);
    res.status(204).end();
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ data: await service.getMe(req.auth.userId) });
  });

  return router;
}
