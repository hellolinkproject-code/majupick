import { apiClient, refreshSession } from './apiClient.js';
import { useSessionStore } from '../stores/useSessionStore.js';

// 인증 요청 자체는 401이 와도 재발급을 시도하지 않는다(skipAuthRefresh).
const AUTH_REQUEST = { skipAuthRefresh: true };

export async function signup({ name, email, password, role }) {
  const res = await apiClient.post('/auth/signup', { name, email, password, role }, AUTH_REQUEST);
  useSessionStore.getState().setSession(res.data.data);
  return res.data.data.user;
}

export async function login({ email, password }) {
  const res = await apiClient.post('/auth/login', { email, password }, AUTH_REQUEST);
  useSessionStore.getState().setSession(res.data.data);
  return res.data.data.user;
}

/** 서버의 Refresh Token을 무효화한다. 서버 호출이 실패해도 이 브라우저의 로그인 상태는 해제한다. */
export async function logout() {
  try {
    await apiClient.post('/auth/logout', undefined, AUTH_REQUEST);
  } finally {
    useSessionStore.getState().clearSession();
  }
}

/** 새로고침 직후 Refresh 쿠키로 세션을 복원한다. 앱 시작 시 한 번만 실행된다. */
export async function restoreSession() {
  const state = useSessionStore.getState();
  if (state.status !== 'idle') return;
  state.markRestoring();
  try {
    await refreshSession();
  } catch {
    // 쿠키가 없거나 만료됨 → 비로그인 상태(refreshSession이 이미 해제함)
  }
}

export async function fetchMe() {
  const res = await apiClient.get('/auth/me');
  useSessionStore.getState().setUser(res.data.data);
  return res.data.data;
}

/** API 오류 응답을 화면에서 쓰기 쉬운 형태로 바꾼다. */
export function parseApiError(error) {
  const body = error?.response?.data?.error;
  if (body) return { code: body.code, message: body.message, fields: body.details?.fields ?? {} };
  return {
    code: 'NETWORK_ERROR',
    message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    fields: {},
  };
}
