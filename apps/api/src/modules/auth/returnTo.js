const BASE = 'http://workbridge.invalid';
// 로그인 직후 다시 인증 화면으로 보내지 않는다.
const BLOCKED = ['/login', '/signup', '/select-role', '/oauth/complete', '/oauth/link'];

/**
 * OAuth 완료 후 이동할 프론트 경로. 외부 URL·프로토콜 상대 경로·역슬래시는 거부하고 null을 돌려준다.
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/\p{Cc}/u.test(value)) return null;

  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (BLOCKED.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
