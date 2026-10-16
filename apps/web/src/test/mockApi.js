import { AxiosError } from 'axios';
import { apiClient, resetRefreshStateForTests } from '../lib/apiClient.js';

/** 로그인 화면 머리글의 알림 개수 폴링(NOTI-02). 테스트가 따로 정하지 않으면 0개로 답한다. */
const DEFAULT_HANDLERS = Object.freeze({
  'GET /notifications/unread-count': () => ({ data: { data: { count: 0 } } }),
});

/** 상세 화면 아래 추천(SRCH-02)은 모든 상세에서 불린다. 테스트가 따로 정하지 않으면 빈 목록이다. */
const DEFAULT_PATTERN_HANDLERS = Object.freeze([
  [/^GET \/projects\/[^/]+\/recommendations$/, () => ({ data: { data: [] } })],
]);

function defaultHandlerFor(key) {
  return DEFAULT_PATTERN_HANDLERS.find(([pattern]) => pattern.test(key))?.[1];
}

/**
 * axios config → `METHOD /path` 키. baseURL·쿼리 유무와 관계없이 같은 핸들러를 쓰게 한다.
 * @param {{ method?: string, url?: string, baseURL?: string }} config
 */
export function requestKey(config) {
  const method = (config.method ?? 'get').toUpperCase();
  let path = config.url ?? '';
  if (/^https?:\/\//i.test(path)) {
    path = new URL(path).pathname;
  }
  path = path.split('?')[0];
  const base = (config.baseURL ?? '').replace(/\/$/, '');
  if (base && path.startsWith(base)) {
    path = path.slice(base.length) || '/';
  }
  if (path.startsWith('/api/')) path = path.slice(4);
  else if (path === '/api') path = '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return `${method} ${path}`;
}

/**
 * 테스트용 가짜 API 서버. axios adapter를 바꿔 인터셉터·스토어·화면은 실제 코드로 동작시킨다.
 * handlers: { 'POST /auth/login': ({ body, headers, calls }) => ({ status, data }) }
 *
 * defaults.adapter만 바꾸면 다른 코드/타이밍에 기본 adapter로 돌아가 실제 HTTP로 나가
 * 타임아웃까지 pending에 남는 경우가 있어, 요청 interceptor로 adapter를 요청마다 고정한다.
 */
export function installMockApi(customHandlers) {
  resetRefreshStateForTests();

  const handlers = { ...DEFAULT_HANDLERS, ...customHandlers };
  const calls = [];
  const previousAdapter = apiClient.defaults.adapter;

  const mockAdapter = async (config) => {
    const key = requestKey(config);
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

    const handler = handlers[key] ?? defaultHandlerFor(key);
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

  apiClient.defaults.adapter = mockAdapter;
  const interceptorId = apiClient.interceptors.request.use((config) => {
    config.adapter = mockAdapter;
    return config;
  });

  return {
    calls,
    count: (key) => calls.filter((call) => call.key === key).length,
    restore: () => {
      apiClient.interceptors.request.eject(interceptorId);
      if (apiClient.defaults.adapter === mockAdapter) {
        apiClient.defaults.adapter = previousAdapter;
      }
      resetRefreshStateForTests();
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
