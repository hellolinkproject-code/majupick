import axios from 'axios';
import { useSessionStore } from '../stores/useSessionStore.js';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

export async function fetchHealth() {
  const res = await apiClient.get('/health');
  return res.data.data;
}

// 재발급을 다시 시도해도 되는 401 코드. INVALID_CREDENTIALS 등은 재발급 대상이 아니다.
const REFRESHABLE_CODES = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);
const REFRESH_LOCK = 'workbridge-auth-refresh';

let refreshPromise = null;

function requestRefresh() {
  const run = async () => {
    // 본문은 undefined로 보낸다. null이면 axios가 JSON "null"을 보내 서버 JSON 파서가 400으로 거부한다.
    const res = await apiClient.post('/auth/refresh', undefined, { skipAuthRefresh: true });
    return res.data.data;
  };
  // 여러 탭이 같은 Refresh 쿠키로 동시에 재발급하면 재사용으로 감지되므로 탭 사이에서도 순서대로 실행한다.
  const locks = globalThis.navigator?.locks;
  return locks?.request ? locks.request(REFRESH_LOCK, run) : run();
}

/**
 * Refresh 쿠키로 새 Access Token을 받는다. 동시에 여러 번 불려도 실제 요청은 한 번만 보낸다.
 * 실패하면 로그인 상태를 해제하고 오류를 던진다.
 */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = requestRefresh()
      .then((session) => {
        useSessionStore.getState().setSession(session);
        return session;
      })
      .catch((error) => {
        useSessionStore.getState().clearSession();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.request.use((config) => {
  const { accessToken } = useSessionStore.getState();
  if (accessToken && !config.skipAuthRefresh) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  const shouldRefresh =
    config &&
    !config.skipAuthRefresh &&
    !config.authRetried &&
    response?.status === 401 &&
    REFRESHABLE_CODES.has(response.data?.error?.code);
  if (!shouldRefresh) throw error;

  // 같은 요청은 한 번만 재시도한다(무한 재시도 방지).
  config.authRetried = true;
  try {
    await refreshSession();
  } catch {
    throw error;
  }
  return apiClient(config);
});
