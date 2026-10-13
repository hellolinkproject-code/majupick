import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createTrustedOriginGuard } from '../../middlewares/trustedOrigin.js';
import { HttpError } from '../../utils/httpError.js';
import { createAuthService } from './auth.service.js';
import {
  LINK_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE_NAME,
  clearLinkCookie,
  clearOAuthStateCookie,
  clearRefreshCookie,
  setLinkCookie,
  setOAuthStateCookie,
  setRefreshCookie,
} from './cookies.js';
import { createOAuthService } from './oauth.service.js';
import { safeReturnTo } from './returnTo.js';
import {
  validateLink,
  validateLogin,
  validateRoleSelection,
  validateSignup,
} from './validation.js';

const FRONTEND_PATHS = new Set(['/login', '/oauth/complete', '/select-role', '/oauth/link']);
const REDIRECT_ERRORS = new Set([
  'OAUTH_EMAIL_UNVERIFIED',
  'OAUTH_CANCELLED',
  'OAUTH_EXPIRED',
  'OAUTH_LINK_UNAVAILABLE',
]);

/** AUTH-01~09. Google 콜백은 브라우저 이동(GET)이라 trustedOrigin의 POST 검사와 충돌하지 않는다. */
export function createAuthRouter({ prisma, config, authConfig, googleOAuth = null }) {
  const router = Router();
  const service = createAuthService({ prisma, authConfig });
  const oauth = createOAuthService({ prisma, authConfig, googleOAuth });
  const authenticate = createAuthenticate(authConfig);
  const frontendOrigin = new URL(config.corsOrigins[0]).origin;

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

  function redirectToFrontend(res, pathname, params = {}) {
    const path = FRONTEND_PATHS.has(pathname) ? pathname : '/login';
    const url = new URL(path, frontendOrigin);
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value) url.searchParams.set(key, value);
    }
    if (url.origin !== frontendOrigin) {
      res.redirect(302, `${frontendOrigin}/login?error=OAUTH_FAILED`);
      return;
    }
    res.redirect(302, url.toString());
  }

  function redirectError(res, error) {
    const code =
      error instanceof HttpError && REDIRECT_ERRORS.has(error.code) ? error.code : 'OAUTH_FAILED';
    if (!(error instanceof HttpError)) console.error('[api] google oauth callback failed');
    redirectToFrontend(res, '/login', { error: code });
  }

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

  router.get('/oauth/google/status', (_req, res) => {
    res.json({ data: { enabled: Boolean(googleOAuth) } });
  });

  router.get('/oauth/google', async (req, res) => {
    const started = await oauth.beginGoogleLogin(safeReturnTo(req.query.returnTo));
    setOAuthStateCookie(res, started.state, authConfig);
    const destination = new URL(started.authorizationUrl);
    if (destination.origin !== 'https://accounts.google.com') {
      clearOAuthStateCookie(res, authConfig);
      throw new HttpError(400, 'OAUTH_FAILED', 'Google 로그인에 실패했습니다. 다시 시도해 주세요.');
    }
    res.redirect(302, destination.toString());
  });

  router.get('/oauth/google/callback', async (req, res) => {
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
    clearOAuthStateCookie(res, authConfig);
    try {
      const result = await oauth.completeGoogleLogin({
        cookieState,
        queryState: typeof req.query.state === 'string' ? req.query.state : '',
        code: typeof req.query.code === 'string' ? req.query.code : '',
        providerError: typeof req.query.error === 'string' ? req.query.error : '',
      });
      if (result.type === 'unavailable') {
        redirectToFrontend(res, '/login', { error: 'OAUTH_LINK_UNAVAILABLE' });
        return;
      }
      if (result.type === 'link') {
        setLinkCookie(res, result.linkToken, authConfig);
        redirectToFrontend(res, '/oauth/link', {
          email: result.maskedEmail,
          ...(result.returnTo && { returnTo: result.returnTo }),
        });
        return;
      }
      setRefreshCookie(res, result.session.refreshToken, authConfig);
      const pathname = result.destination === 'select-role' ? '/select-role' : '/oauth/complete';
      redirectToFrontend(res, pathname, result.returnTo ? { returnTo: result.returnTo } : {});
    } catch (error) {
      redirectError(res, error);
    }
  });

  router.post('/oauth/link', loginLimiter, async (req, res) => {
    try {
      const session = await oauth.linkGoogleAccount({
        linkToken: req.cookies?.[LINK_COOKIE],
        password: validateLink(req.body).password,
      });
      clearLinkCookie(res, authConfig);
      sendSession(res, 200, session);
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.code === 'OAUTH_LINK_EXPIRED' || error.code === 'OAUTH_LINK_UNAVAILABLE')
      ) {
        clearLinkCookie(res, authConfig);
      }
      throw error;
    }
  });

  router.patch('/role', authenticate, async (req, res) => {
    res.json({
      data: await service.setRole(req.auth.userId, validateRoleSelection(req.body).role),
    });
  });

  return router;
}
