export const REFRESH_COOKIE_NAME = 'wb_rt';
// 재발급·로그아웃 요청에만 쿠키가 실리도록 경로를 제한한다.
export const REFRESH_COOKIE_PATH = '/api/auth';

export const OAUTH_STATE_COOKIE = 'wb_oauth';
export const OAUTH_STATE_PATH = '/api/auth/oauth';
export const LINK_COOKIE = 'wb_link';
export const LINK_COOKIE_PATH = '/api/auth/oauth/link';
export const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function cookieOptions(authConfig, path, maxAge) {
  return {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: 'lax',
    path,
    ...(maxAge !== undefined && { maxAge }),
  };
}

function baseOptions(authConfig) {
  return cookieOptions(authConfig, REFRESH_COOKIE_PATH);
}

export function setRefreshCookie(res, token, authConfig) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(authConfig),
    maxAge: authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res, authConfig) {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions(authConfig));
}

export function setOAuthStateCookie(res, state, authConfig) {
  res.cookie(
    OAUTH_STATE_COOKIE,
    state,
    cookieOptions(authConfig, OAUTH_STATE_PATH, OAUTH_COOKIE_MAX_AGE_MS),
  );
}

export function clearOAuthStateCookie(res, authConfig) {
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions(authConfig, OAUTH_STATE_PATH));
}

export function setLinkCookie(res, token, authConfig) {
  res.cookie(
    LINK_COOKIE,
    token,
    cookieOptions(authConfig, LINK_COOKIE_PATH, OAUTH_COOKIE_MAX_AGE_MS),
  );
}

export function clearLinkCookie(res, authConfig) {
  res.clearCookie(LINK_COOKIE, cookieOptions(authConfig, LINK_COOKIE_PATH));
}
