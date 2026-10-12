export const REFRESH_COOKIE_NAME = 'wb_rt';
// 재발급·로그아웃 요청에만 쿠키가 실리도록 경로를 제한한다.
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseOptions(authConfig) {
  return {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  };
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
