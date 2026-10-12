import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiClient, refreshSession } from './apiClient.js';
import { logout } from './authApi.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';

describe('apiClient', () => {
  it('targets the same-origin /api path and sends cookies', () => {
    expect(apiClient.defaults.baseURL).toBe('/api');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});

describe('apiClient auth interceptors', () => {
  const user = { id: 1, name: '홍길동' };
  let api;

  beforeEach(() => {
    useSessionStore.getState().setSession({ accessToken: 'old-token', user });
  });

  afterEach(() => {
    api?.restore();
    useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
  });

  it('attaches the in-memory access token', async () => {
    api = installMockApi({ 'GET /auth/me': () => ({ data: { data: user } }) });

    await apiClient.get('/auth/me');

    expect(api.calls[0].authorization).toBe('Bearer old-token');
  });

  it('refreshes once for several concurrent 401s and retries every request with the new token', async () => {
    api = installMockApi({
      'GET /auth/me': ({ authorization }) =>
        authorization === 'Bearer new-token'
          ? { data: { data: user } }
          : apiError(401, 'TOKEN_EXPIRED'),
      'POST /auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return sessionResponse(user, 'new-token');
      },
    });

    const results = await Promise.all([
      apiClient.get('/auth/me'),
      apiClient.get('/auth/me'),
      apiClient.get('/auth/me'),
    ]);

    expect(results.every((res) => res.status === 200)).toBe(true);
    expect(api.count('POST /auth/refresh')).toBe(1);
    expect(useSessionStore.getState().accessToken).toBe('new-token');
  });

  it('clears the session when the refresh fails', async () => {
    api = installMockApi({
      'GET /auth/me': () => apiError(401, 'TOKEN_EXPIRED'),
      'POST /auth/refresh': () => apiError(401, 'INVALID_REFRESH_TOKEN'),
    });

    await expect(apiClient.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', accessToken: null });
    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('retries a request only once even if it keeps failing (no infinite loop)', async () => {
    api = installMockApi({
      'GET /auth/me': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /auth/refresh': () => sessionResponse(user, 'new-token'),
    });

    await expect(apiClient.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });

    expect(api.count('GET /auth/me')).toBe(2);
    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('does not try to refresh for non-session 401s such as wrong credentials', async () => {
    api = installMockApi({
      'POST /auth/login': () => apiError(401, 'INVALID_CREDENTIALS'),
    });

    await expect(apiClient.post('/auth/login', {}, { skipAuthRefresh: true })).rejects.toBeTruthy();

    expect(api.count('POST /auth/refresh')).toBe(0);
  });

  // 서버의 express.json()은 본문 "null"을 400으로 거부하므로 본문 없이 보내야 한다.
  it('sends refresh and logout without a request body', async () => {
    api = installMockApi({
      'POST /auth/refresh': () => sessionResponse(user, 'new-token'),
      'POST /auth/logout': () => ({ status: 204 }),
    });

    await refreshSession();
    await logout();

    expect(api.calls.map((call) => call.rawData)).toEqual([undefined, undefined]);
  });
});
