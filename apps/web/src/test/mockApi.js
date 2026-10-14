import { AxiosError } from 'axios';
import { apiClient } from '../lib/apiClient.js';

/** 로그인 화면 머리글의 알림 개수 폴링(NOTI-02). 테스트가 따로 정하지 않으면 0개로 답한다. */
const DEFAULT_HANDLERS = Object.freeze({
  'GET /notifications/unread-count': () => ({ data: { data: { count: 0 } } }),
});

/**
 * 테스트용 가짜 API 서버. axios adapter를 바꿔 인터셉터·스토어·화면은 실제 코드로 동작시킨다.
 * handlers: { 'POST /auth/login': ({ body, headers, calls }) => ({ status, data }) }
 */
export function installMockApi(customHandlers) {
  const handlers = { ...DEFAULT_HANDLERS, ...customHandlers };
  const calls = [];
  const originalAdapter = apiClient.defaults.adapter;

  apiClient.defaults.adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    const body =
      typeof config.data === 'string' && config.data ? JSON.parse(config.data) : undefined;
    const call = {
      key,
      body,
      rawData: config.data,
      params: config.params,
      authorization: config.headers?.get?.('Authorization') ?? null,
      header: (name) => config.headers?.get?.(name) ?? null,
    };
    calls.push(call);

    const handler = handlers[key];
    if (!handler) throw new Error(`Unhandled request in test: ${key}`);
    const { status = 200, data = null } = (await handler({ ...call, calls })) ?? {};

    const response = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  };

  return {
    calls,
    count: (key) => calls.filter((call) => call.key === key).length,
    restore: () => {
      apiClient.defaults.adapter = originalAdapter;
    },
  };
}

export const apiError = (status, code, message = code, details) => ({
  status,
  data: { error: { code, message, ...(details && { details }) } },
});

export const sessionResponse = (user, accessToken = 'access-token') => ({
  status: 200,
  data: { data: { accessToken, user } },
});
