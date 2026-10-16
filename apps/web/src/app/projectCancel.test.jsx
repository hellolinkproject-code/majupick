import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';
import { todayKst } from '../lib/projectForm.js';

const TODAY = todayKst();
const addDays = (offset) => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const baseUser = {
  email: 'user@workbridge.test',
  profileImageUrl: null,
  bio: null,
  hasPassword: true,
  socialProviders: [],
  profileCompletion: { isComplete: true, missingFields: [] },
};
const client = {
  ...baseUser,
  id: 7,
  name: '김의뢰',
  role: 'CLIENT',
  freelancerProfile: null,
  clientProfile: { companyName: '워크브릿지', businessField: 'IT', businessFieldEtc: null },
};
const freelancer = {
  ...baseUser,
  id: 8,
  name: '박프리',
  role: 'FREELANCER',
  clientProfile: null,
  freelancerProfile: null,
};
const roleless = { ...baseUser, id: 9, name: '구글유저', role: null };

const myProject = (overrides = {}) => ({
  id: 51,
  title: '쇼핑몰 리뉴얼',
  category: 'WEB',
  budget: '3000000',
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [],
  applicantCount: 3,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  status: 'RECRUITING',
  availableActions: ['EDIT', 'DELETE', 'CLOSE', 'CANCEL'],
  lockedFields: [],
  pendingApplicantCount: 2,
  cancelledAt: null,
  ...overrides,
});
const page = (items) => ({
  data: {
    data: items,
    pagination: { page: 1, pageSize: 10, totalCount: items.length, totalPages: 1 },
  },
});
const cancelledProject = myProject({
  status: 'CANCELLED',
  publicStatus: 'CLOSED',
  availableActions: [],
  pendingApplicantCount: 0,
  cancelledAt: '2026-10-14T03:00:00.000Z',
  isCancelled: true,
});

let api;
let router;

function renderAt(path, user, handlers = {}) {
  api = installMockApi({
    'POST /auth/refresh': () =>
      user ? sessionResponse(user) : apiError(401, 'INVALID_REFRESH_TOKEN'),
    'POST /auth/logout': () => ({ status: 204 }),
    'GET /auth/me': () => ({ data: { data: user } }),
    'GET /meta/options': () => ({
      data: { data: { projectCategories: [{ value: 'WEB', label: '웹' }], businessFields: [] } },
    }),
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

const callsTo = (key) => api.calls.filter((call) => call.key === key);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  sessionStorage.clear();
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('project cancel (client, STAT-02)', () => {
  it('confirms with the pending count, keeps focus inside, and returns focus on Escape', async () => {
    renderAt('/me/projects', client, { 'GET /me/projects': () => page([myProject()]) });

    const trigger = await screen.findByRole('button', { name: '프로젝트 취소' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('alertdialog', {
      name: '‘쇼핑몰 리뉴얼’ 프로젝트를 취소할까요?',
    });
    expect(within(dialog).getByText(/검토 대기 중인 지원 2건은/)).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const back = within(dialog).getByRole('button', { name: '돌아가기' });
    const confirm = within(dialog).getByRole('button', { name: '프로젝트 취소 확정' });
    expect(document.activeElement).toBe(back);

    fireEvent.keyDown(confirm, { key: 'Tab' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    screen.getByRole('link', { name: 'WorkBridge' }).focus();
    expect(document.activeElement).toBe(back);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(callsTo('POST /projects/51/cancel')).toHaveLength(0);
  });

  it('cancels once even on a double click and shows what the server did', async () => {
    let cancelled = false;
    const gate = deferred();
    renderAt('/me/projects', client, {
      'GET /me/projects': () => page([cancelled ? cancelledProject : myProject()]),
      'POST /projects/51/cancel': async () => {
        await gate.promise;
        cancelled = true;
        return {
          data: { data: { project: cancelledProject, rejectedCount: 2, keptAcceptedCount: 0 } },
        };
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: '프로젝트 취소' }));
    const confirm = screen.getByRole('button', { name: '프로젝트 취소 확정' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByRole('button', { name: '취소하는 중…' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    gate.resolve();
    expect(
      await screen.findByText(
        '프로젝트를 취소했습니다. 검토 대기 지원 2건을 자동으로 거절했습니다.',
      ),
    ).toBeTruthy();
    expect(callsTo('POST /projects/51/cancel')).toHaveLength(1);
    expect(await screen.findByText(/에 취소한 프로젝트입니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '프로젝트 취소' })).toBeNull();
    expect(screen.queryByRole('button', { name: '모집 마감' })).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('keeps the dialog open with the server message when the cancel is refused', async () => {
    renderAt('/me/projects', client, {
      'GET /me/projects': () => page([myProject()]),
      'POST /projects/51/cancel': () =>
        apiError(409, 'INVALID_STATE_TRANSITION', '이미 취소된 프로젝트입니다.'),
    });

    fireEvent.click(await screen.findByRole('button', { name: '프로젝트 취소' }));
    fireEvent.click(screen.getByRole('button', { name: '프로젝트 취소 확정' }));

    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '프로젝트 취소 확정' })).toBeTruthy();
  });

  it('shows a cancelled project to its owner without any actions', async () => {
    renderAt('/projects/51', client, {
      'GET /projects/51': () => ({
        data: { data: { ...cancelledProject, description: '설명', isOwner: true, client } },
      }),
      'GET /projects/51/applications': () => page([]),
    });

    expect(await screen.findByText(/계약 체결 전에 이 프로젝트를 취소했습니다/)).toBeTruthy();
    expect(
      screen.getByText('취소된 프로젝트입니다. 수정·삭제·모집 마감·지원자 선정을 할 수 없습니다.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '프로젝트 취소' })).toBeNull();
  });
});

describe('cancelled project (freelancer)', () => {
  const application = (overrides = {}) => ({
    id: 301,
    status: 'REJECTED',
    rejectReason: 'PROJECT_CANCELLED',
    decidedAt: '2026-10-14T03:00:00.000Z',
    createdAt: '2026-10-13T03:00:00.000Z',
    proposedAmount: '2500000',
    proposedDurationDays: 30,
    coverLetter: '자기소개',
    project: {
      id: 51,
      title: '쇼핑몰 리뉴얼',
      budget: '3000000',
      recruitStartDate: null,
      recruitEndDate: addDays(14),
      publicStatus: 'CLOSED',
      isDeleted: false,
      isCancelled: true,
    },
    ...overrides,
  });

  it('marks cancelled projects in my applications and tells an accepted applicant there is no contract', async () => {
    renderAt('/me/applications', freelancer, {
      'GET /me/applications': () =>
        page([
          application(),
          application({
            id: 302,
            status: 'ACCEPTED',
            rejectReason: null,
            project: { ...application().project, id: 52, title: '선정 후 취소' },
          }),
        ]),
    });

    const list = await screen.findByRole('list', { name: '내 지원 목록' });
    expect(within(list).getAllByText('취소된 프로젝트')).toHaveLength(2);
    expect(within(list).getAllByText('취소')).toHaveLength(2);
    expect(
      within(list).getByText(/자동 거절 · 프로젝트 취소|프로젝트가 취소되어 자동으로 거절/),
    ).toBeTruthy();
    expect(
      within(list).getByText(/이후 계약 체결 전에 프로젝트가 취소되어 계약이 진행되지 않습니다/),
    ).toBeTruthy();
  });

  it('shows the cancellation on the detail page and does not offer to apply', async () => {
    renderAt('/projects/51', freelancer, {
      'GET /projects/51': () => ({
        data: {
          data: {
            ...myProject(),
            status: undefined,
            availableActions: undefined,
            publicStatus: 'CLOSED',
            isCancelled: true,
            description: '설명',
            isOwner: false,
            client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
            myApplication: {
              id: 302,
              status: 'ACCEPTED',
              rejectReason: null,
              createdAt: '2026-10-13T03:00:00.000Z',
            },
            isBookmarked: false,
          },
        },
      }),
    });

    expect(
      await screen.findByText(/의뢰인이 계약 체결 전에 이 프로젝트를 취소했습니다/),
    ).toBeTruthy();
    expect(screen.getByText(/프로젝트가 취소되어 계약이 진행되지 않습니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /지원하기/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /북마크/ })).toBeNull();
  });
});

describe('role-based header (A-42)', () => {
  const menu = () => within(screen.getByRole('navigation', { name: '주요 메뉴' }));
  const account = () => within(screen.getByRole('navigation', { name: '계정' }));
  const linkNames = (scope) => scope.queryAllByRole('link').map((link) => link.textContent);

  it('shows only public links to a guest', async () => {
    renderAt('/nowhere', null);
    expect(await account().findByRole('link', { name: '로그인' })).toBeTruthy();
    expect(linkNames(menu())).toEqual(['프로젝트 찾기']);
    expect(linkNames(account())).toEqual(['로그인', '회원가입']);
    expect(screen.queryByRole('link', { name: '알림' })).toBeNull();
  });

  it('shows the client menu', async () => {
    renderAt('/nowhere', client);
    expect(await screen.findByText('김의뢰님')).toBeTruthy();
    expect(linkNames(menu())).toEqual(['프로젝트 찾기', '프로젝트 등록', '내 프로젝트', '내 계약']);
    expect(linkNames(account())).toEqual(['내 프로필']);
    expect(account().getByRole('button', { name: '로그아웃' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '알림' })).toBeTruthy();
  });

  it('shows the freelancer menu', async () => {
    renderAt('/nowhere', freelancer);
    expect(await screen.findByText('박프리님')).toBeTruthy();
    expect(linkNames(menu())).toEqual(['프로젝트 찾기', '내 지원 현황', '내 계약', '내 북마크']);
    expect(linkNames(account())).toEqual(['내 프로필']);
    expect(screen.getByRole('link', { name: '알림' })).toBeTruthy();
  });

  it('shows no role menus before a role is chosen', async () => {
    renderAt('/select-role', roleless);
    expect(await screen.findByText('구글유저님')).toBeTruthy();
    expect(linkNames(menu())).toEqual(['프로젝트 찾기']);
    expect(linkNames(account())).toEqual(['역할 선택']);
    expect(screen.queryByRole('link', { name: '알림' })).toBeNull();
  });

  it('keeps the login returnTo when a user without a role logs in', async () => {
    renderAt('/login?returnTo=%2Fme%2Fprojects%3Fpage%3D2', null, {
      'POST /auth/login': () => sessionResponse(roleless),
      'GET /auth/oauth/google/status': () => ({ data: { data: { enabled: false } } }),
    });
    await screen.findByRole('heading', { name: '로그인' });
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'r@workbridge.test' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/select-role'));
    expect(router.state.location.search).toBe('?returnTo=%2Fme%2Fprojects%3Fpage%3D2');
  });

  it('does not flash guest links while the session is restoring', async () => {
    const gate = deferred();
    renderAt('/nowhere', client, {
      'POST /auth/refresh': async () => {
        await gate.promise;
        return sessionResponse(client);
      },
    });
    await waitFor(() => expect(useSessionStore.getState().status).toBe('restoring'));
    expect(screen.queryByRole('link', { name: '로그인' })).toBeNull();
    expect(screen.queryByRole('link', { name: '회원가입' })).toBeNull();
    gate.resolve();
    expect(await screen.findByText('김의뢰님')).toBeTruthy();
  });

  it('switches to the guest menu right after logout', async () => {
    renderAt('/nowhere', freelancer);
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await account().findByRole('link', { name: '로그인' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '내 지원 현황' })).toBeNull();
    expect(screen.queryByRole('link', { name: '알림' })).toBeNull();
  });

  it('marks the current page and toggles the narrow-screen menu', async () => {
    renderAt('/me/bookmarks', freelancer, {
      'GET /me/bookmarks': () => page([]),
      'GET /projects': () => page([]),
      'GET /tech-stacks': () => ({ data: { data: [] } }),
    });
    const current = await menu().findByRole('link', { name: '내 북마크' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(menu().getByRole('link', { name: '프로젝트 찾기' }).getAttribute('aria-current')).toBe(
      null,
    );

    const toggle = screen.getByRole('button', { name: '메뉴' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('site-menu');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('site-menu').className).toContain('is-open');

    current.focus();
    fireEvent.keyDown(current, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);
    fireEvent.click(menu().getByRole('link', { name: '프로젝트 찾기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
    expect(screen.getByRole('button', { name: '메뉴' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
