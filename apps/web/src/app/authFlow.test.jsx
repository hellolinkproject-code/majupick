import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';

const client = {
  id: 1,
  name: '김의뢰',
  email: 'client@workbridge.test',
  role: 'CLIENT',
  profileCompletion: { isComplete: false, missingFields: ['companyName', 'businessField'] },
};
const anonymous = { 'POST /auth/refresh': () => apiError(401, 'INVALID_REFRESH_TOKEN') };

let api;
let router;

function renderApp(path, handlers) {
  api = installMockApi({
    'GET /health': () => ({ data: { data: { status: 'ok' } } }),
    'GET /auth/oauth/google/status': () => ({ data: { data: { enabled: false } } }),
    'GET /meta/options': () => ({
      data: { data: { projectCategories: [], businessFields: [] } },
    }),
    'GET /tech-stacks': () => ({ data: { data: [] } }),
    ...handlers,
  });
  router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const header = () => within(screen.getByRole('navigation', { name: '계정' }));
const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('session restore', () => {
  it('restores the session from the refresh cookie on page load and shows the user in the header', async () => {
    renderApp('/', { 'POST /auth/refresh': () => sessionResponse(client) });

    expect(await screen.findByText('김의뢰님')).toBeTruthy();
    expect(header().getByRole('link', { name: '내 프로필' })).toBeTruthy();
    expect(header().getByRole('button', { name: '로그아웃' })).toBeTruthy();
    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('shows login and signup links when there is no session', async () => {
    renderApp('/', anonymous);

    expect(await screen.findByRole('link', { name: '로그인' })).toBeTruthy();
    expect(header().getByRole('link', { name: '회원가입' })).toBeTruthy();
    expect(header().queryByRole('button', { name: '로그아웃' })).toBeNull();
  });
});

describe('signup', () => {
  it('submits the form, logs the user in and returns home without forcing a profile', async () => {
    renderApp('/signup', {
      ...anonymous,
      'POST /auth/signup': ({ body }) => ({
        status: 201,
        data: {
          data: { accessToken: 'token', user: { ...client, name: body.name, role: body.role } },
        },
      }),
    });

    await screen.findByRole('heading', { name: '회원가입' });
    type('이름', ' 박프리 ');
    type('이메일', 'free@workbridge.test');
    type('비밀번호', 'abcd1234');
    type('비밀번호 확인', 'abcd1234');
    fireEvent.click(screen.getByRole('radio', { name: /^프리랜서/ }));
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByText('박프리님')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(api.calls.find((call) => call.key === 'POST /auth/signup').body).toEqual({
      name: '박프리',
      email: 'free@workbridge.test',
      password: 'abcd1234',
      role: 'FREELANCER',
    });
  });

  it('shows input errors without calling the API', async () => {
    renderApp('/signup', anonymous);

    await screen.findByRole('heading', { name: '회원가입' });
    type('이메일', 'not-an-email');
    type('비밀번호', 'short');
    type('비밀번호 확인', 'different');
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByText('이름을 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText('올바른 이메일 형식이 아닙니다.')).toBeTruthy();
    expect(screen.getByText('비밀번호는 8자 이상이어야 합니다.')).toBeTruthy();
    expect(screen.getByText('비밀번호가 일치하지 않습니다.')).toBeTruthy();
    expect(screen.getByText('의뢰인 또는 프리랜서를 선택해 주세요.')).toBeTruthy();
    expect(api.count('POST /auth/signup')).toBe(0);
  });

  it('shows a duplicate email error from the server', async () => {
    renderApp('/signup', {
      ...anonymous,
      'POST /auth/signup': () => apiError(409, 'EMAIL_ALREADY_EXISTS'),
    });

    await screen.findByRole('heading', { name: '회원가입' });
    type('이름', '김의뢰');
    type('이메일', 'client@workbridge.test');
    type('비밀번호', 'abcd1234');
    type('비밀번호 확인', 'abcd1234');
    fireEvent.click(screen.getByRole('radio', { name: /^의뢰인/ }));
    fireEvent.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByText('이미 가입된 이메일입니다.')).toBeTruthy();
  });
});

describe('login and logout', () => {
  it('logs in and changes the header', async () => {
    renderApp('/login', {
      ...anonymous,
      'POST /auth/login': ({ body }) =>
        body.password === 'abcd1234'
          ? sessionResponse(client)
          : apiError(401, 'INVALID_CREDENTIALS'),
    });

    await screen.findByRole('heading', { name: '로그인' });
    type('이메일', 'client@workbridge.test');
    type('비밀번호', 'abcd1234');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByText('김의뢰님')).toBeTruthy();
    expect(header().queryByRole('link', { name: '로그인' })).toBeNull();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a clear message for wrong credentials', async () => {
    renderApp('/login', {
      ...anonymous,
      'POST /auth/login': () => apiError(401, 'INVALID_CREDENTIALS'),
    });

    await screen.findByRole('heading', { name: '로그인' });
    type('이메일', 'client@workbridge.test');
    type('비밀번호', 'wrong-password');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('links to the signup page', async () => {
    renderApp('/login', anonymous);

    await screen.findByRole('heading', { name: '로그인' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: '회원가입' }));

    expect(await screen.findByRole('heading', { name: '회원가입' })).toBeTruthy();
  });

  it('logs out, revokes the server session and shows the logged-out header', async () => {
    renderApp('/', {
      'POST /auth/refresh': () => sessionResponse(client),
      'POST /auth/logout': () => ({ status: 204 }),
    });

    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));

    expect(await screen.findByRole('link', { name: '로그인' })).toBeTruthy();
    expect(api.count('POST /auth/logout')).toBe(1);
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', accessToken: null });
  });
});

describe('protected pages', () => {
  it('redirects to login with returnTo and comes back after logging in', async () => {
    renderApp('/me', {
      ...anonymous,
      'POST /auth/login': () => sessionResponse(client),
      'GET /auth/me': ({ authorization }) =>
        authorization === 'Bearer access-token'
          ? { data: { data: client } }
          : apiError(401, 'UNAUTHENTICATED'),
    });

    await screen.findByRole('heading', { name: '로그인' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?returnTo=%2Fme');

    type('이메일', 'client@workbridge.test');
    type('비밀번호', 'abcd1234');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/me');
    expect(await screen.findByText('client@workbridge.test')).toBeTruthy();
    expect(screen.getByText('의뢰인')).toBeTruthy();
  });

  it('ignores an external returnTo value', async () => {
    renderApp('/login?returnTo=https%3A%2F%2Fevil.example', {
      ...anonymous,
      'POST /auth/login': () => sessionResponse(client),
    });

    await screen.findByRole('heading', { name: '로그인' });
    type('이메일', 'client@workbridge.test');
    type('비밀번호', 'abcd1234');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await screen.findByText('김의뢰님');
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps the user on the protected page after a reload when the refresh cookie is valid', async () => {
    renderApp('/me', {
      'POST /auth/refresh': () => sessionResponse(client),
      'GET /auth/me': () => ({ data: { data: client } }),
    });

    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/me');
  });
});

const newGoogleUser = { ...client, role: null, name: '구글유저', email: 'new@workbridge.test' };

describe('Google login UI', () => {
  it('explains how to configure Google instead of showing a broken button', async () => {
    renderApp('/login', anonymous);

    expect(await screen.findByText(/GOOGLE_CLIENT_ID/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Google로 계속하기' })).toBeNull();
  });

  it('starts Google login with the validated return path and ignores a second click', async () => {
    renderApp('/login?returnTo=%2Fme', {
      ...anonymous,
      'GET /auth/oauth/google/status': () => ({ data: { data: { enabled: true } } }),
    });

    const link = await screen.findByRole('link', { name: 'Google로 계속하기' });
    expect(link.getAttribute('href')).toBe('/api/auth/oauth/google?returnTo=%2Fme');
    fireEvent.click(link);
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.textContent).toBe('Google로 이동 중…');
  });

  it('shows a fixed message when Google login is cancelled', async () => {
    renderApp('/login?error=OAUTH_CANCELLED', anonymous);

    expect((await screen.findByRole('alert')).textContent).toBe('Google 로그인을 취소했습니다.');
    expect(screen.queryByText('OAUTH_CANCELLED')).toBeNull();
  });

  it('sends a new Google user to role selection before any other page', async () => {
    renderApp('/', {
      'POST /auth/refresh': () => sessionResponse(newGoogleUser),
    });

    expect(await screen.findByRole('heading', { name: '역할 선택' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/select-role');
  });

  it('saves the role once and opens the profile', async () => {
    const freelancer = { ...newGoogleUser, role: 'FREELANCER' };
    renderApp('/select-role?returnTo=%2Fme', {
      'POST /auth/refresh': () => sessionResponse(newGoogleUser),
      'PATCH /auth/role': ({ body }) => ({ data: { data: { ...freelancer, role: body.role } } }),
      'GET /auth/me': () => ({ data: { data: freelancer } }),
    });

    await screen.findByRole('heading', { name: '역할 선택' });
    fireEvent.click(screen.getByRole('radio', { name: /^프리랜서/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 완료' }));

    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/me');
    expect(api.calls.find((call) => call.key === 'PATCH /auth/role').body).toEqual({
      role: 'FREELANCER',
    });
  });

  it('links an existing account only after the password is confirmed', async () => {
    renderApp('/oauth/link?email=a***%40workbridge.test&returnTo=%2Fme', {
      ...anonymous,
      'POST /auth/oauth/link': ({ body }) =>
        body.password === 'abcd1234'
          ? sessionResponse(client)
          : apiError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.'),
      'GET /auth/me': () => ({ data: { data: client } }),
    });

    await screen.findByRole('heading', { name: '계정 연결 확인' });
    expect(screen.getByText(/a\*\*\*@workbridge\.test/)).toBeTruthy();
    type('기존 비밀번호', 'wrong-password');
    fireEvent.click(screen.getByRole('button', { name: 'Google 계정 연결' }));
    expect((await screen.findByRole('alert')).textContent).toBe('비밀번호가 올바르지 않습니다.');

    type('기존 비밀번호', 'abcd1234');
    fireEvent.click(screen.getByRole('button', { name: 'Google 계정 연결' }));
    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
  });

  it('finishes an existing Google login on the completion page', async () => {
    renderApp('/oauth/complete?returnTo=%2Fme', {
      'POST /auth/refresh': () => sessionResponse(client),
      'GET /auth/me': () => ({ data: { data: client } }),
    });

    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/me');
  });
});
