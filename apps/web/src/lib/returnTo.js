const BASE = 'http://workbridge.invalid';
const AUTH_PAGES = ['/login', '/signup'];

/**
 * 로그인 후 돌아갈 경로를 검증한다. 같은 사이트의 내부 경로만 허용하고,
 * 외부 URL·프로토콜 상대 경로(`//evil.com`)·백슬래시·제어 문자·로그인 화면 자신은 fallback으로 바꾼다.
 */
export function safeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return fallback;
  if (value.includes('\\') || /\p{Cc}/u.test(value)) return fallback;

  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 현재 위치로 돌아오는 로그인 경로. */
export function loginPathFor(location) {
  const current = `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
  const returnTo = safeReturnTo(current, '');
  return returnTo && returnTo !== '/'
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/login';
}
