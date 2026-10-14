import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';
import { todayKst } from '../lib/projectForm.js';

const OPTIONS = {
  projectCategories: [{ value: 'WEB', label: '웹' }],
  businessFields: [{ value: 'IT', label: 'IT' }],
};
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
  freelancerProfile: {
    mainCategory: 'WEB',
    careerYears: 3,
    hourlyRate: '50000',
    portfolioUrl: null,
    techStacks: [{ id: 1, name: 'React' }],
  },
};

const notification = (id, overrides = {}) => ({
  id,
  type: 'APPLICATION_REJECTED',
  title: '지원 결과 안내',
  message: `'쇼핑몰 리뉴얼 ${id}' 프로젝트의 의뢰인이 지원을 거절했습니다.`,
  linkUrl: '/me/applications',
  projectId: 41,
  applicationId: 100 + id,
  isRead: false,
  readAt: null,
  createdAt: '2026-10-14T03:00:00.000Z',
  ...overrides,
});
const listResponse = (items, unreadCount = items.filter((n) => !n.isRead).length) => ({
  data: {
    data: items,
    pagination: { page: 1, pageSize: 20, totalCount: items.length, totalPages: 1 },
    unreadCount,
  },
});
const myApplicationsEmpty = () => ({
  data: { data: [], pagination: { page: 1, pageSize: 10, totalCount: 0, totalPages: 0 } },
});

const myProject = (overrides = {}) => ({
  id: 41,
  title: '쇼핑몰 리뉴얼',
  category: 'WEB',
  budget: '3000000',
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 3,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  status: 'RECRUITING',
  availableActions: ['EDIT', 'DELETE', 'CLOSE'],
  lockedFields: ['budget', 'recruitEndDate'],
  ...overrides,
});
const myProjectsResponse = (items) => ({
  data: {
    data: items,
    pagination: { page: 1, pageSize: 10, totalCount: items.length, totalPages: 1 },
  },
});

let api;
let router;

function renderAt(path, user, handlers = {}) {
  api = installMockApi({
    'POST /auth/refresh': () =>
      user ? sessionResponse(user) : apiError(401, 'INVALID_REFRESH_TOKEN'),
    'GET /auth/me': () => ({ data: { data: user } }),
    'GET /meta/options': () => ({ data: { data: OPTIONS } }),
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
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('header notification bell', () => {
  it('shows the unread count for a signed-in user and links to the list', async () => {
    renderAt('/me/applications', freelancer, {
      'GET /notifications/unread-count': () => ({ data: { data: { count: 3 } } }),
      'GET /me/applications': myApplicationsEmpty,
    });
    const bell = await screen.findByRole(
      'link',
      { name: '알림, 읽지 않은 알림 3개' },
      { timeout: 5000 },
    );
    expect(bell.getAttribute('href')).toBe('/notifications');
    expect(within(bell).getByText('3')).toBeTruthy();
    expect(callsTo('GET /notifications/unread-count')[0].authorization).toBe('Bearer access-token');
  });

  it('hides the badge at zero and the bell for signed-out visitors', async () => {
    renderAt('/me/applications', freelancer, { 'GET /me/applications': myApplicationsEmpty });
    expect(await screen.findByRole('link', { name: '알림' })).toBeTruthy();
    cleanup();
    api.restore();
    useSessionStore.setState({ status: 'idle', accessToken: null, user: null });

    renderAt('/projects', null, {
      'GET /projects': () => ({
        data: { data: [], pagination: { page: 1, pageSize: 10, totalCount: 0, totalPages: 0 } },
      }),
    });
    expect(await screen.findByRole('link', { name: '로그인' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^알림/ })).toBeNull();
    expect(callsTo('GET /notifications/unread-count')).toHaveLength(0);
  });
});

describe('notifications page', () => {
  it('lists notifications with type, time and unread state without marking them read', async () => {
    renderAt('/notifications', freelancer, {
      'GET /notifications': () =>
        listResponse([
          notification(2, { type: 'PROJECT_CLOSED', title: '모집이 마감되었습니다' }),
          notification(1, { isRead: true, readAt: '2026-10-14T04:00:00.000Z' }),
        ]),
    });
    const list = await screen.findByRole('list', { name: '알림 목록' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain('notification-item--unread');
    expect(items[1].className).not.toContain('notification-item--unread');
    expect(within(items[0]).getByText('모집 마감')).toBeTruthy();
    expect(within(items[0]).getByText('읽지 않음')).toBeTruthy();
    expect(within(items[1]).queryByText('읽지 않음')).toBeNull();
    expect(within(items[0]).getByText(/2026.*10.*14/)).toBeTruthy();
    expect(screen.getByText(/읽지 않은 알림 1개/)).toBeTruthy();
    expect(api.calls.some((call) => call.key.startsWith('PATCH'))).toBe(false);
  });

  it('marks a notification read first and only then opens the related page', async () => {
    const read = deferred();
    renderAt('/notifications', freelancer, {
      'GET /notifications': () => listResponse([notification(5)]),
      'PATCH /notifications/5/read': () => read.promise,
      'GET /me/applications': myApplicationsEmpty,
    });
    fireEvent.click(await screen.findByRole('button', { name: /지원 결과 안내/ }));
    await waitFor(() => expect(callsTo('PATCH /notifications/5/read')).toHaveLength(1));
    expect(router.state.location.pathname).toBe('/notifications');

    read.resolve({
      data: { data: notification(5, { isRead: true, readAt: '2026-10-14T05:00:00.000Z' }) },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/applications'));
  });

  it('opens an already-read notification without another read request and keeps the hash', async () => {
    renderAt('/notifications', client, {
      'GET /notifications': () =>
        listResponse([
          notification(6, {
            type: 'APPLICATION_SUBMITTED',
            title: '새 지원자가 있습니다',
            linkUrl: '/projects/41#applicants',
            isRead: true,
            readAt: '2026-10-14T05:00:00.000Z',
          }),
        ]),
      'GET /projects/41': () => apiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'),
    });
    fireEvent.click(await screen.findByRole('button', { name: /새 지원자가 있습니다/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/41'));
    expect(router.state.location.hash).toBe('#applicants');
    expect(callsTo('PATCH /notifications/6/read')).toHaveLength(0);
  });

  it('never follows an external or manipulated link', async () => {
    renderAt('/notifications', freelancer, {
      'GET /notifications': () =>
        listResponse([
          notification(7, { linkUrl: 'https://evil.example' }),
          notification(8, { linkUrl: '//evil.example', title: '두 번째' }),
          notification(9, { linkUrl: null, title: '세 번째' }),
        ]),
      'PATCH /notifications/7/read': () => ({ data: { data: notification(7, { isRead: true }) } }),
      'PATCH /notifications/8/read': () => ({ data: { data: notification(8, { isRead: true }) } }),
      'PATCH /notifications/9/read': () => ({ data: { data: notification(9, { isRead: true }) } }),
    });
    for (const name of [/지원 결과 안내/, /두 번째/, /세 번째/]) {
      fireEvent.click(await screen.findByRole('button', { name }));
      expect(await screen.findByText('이 알림은 이동할 화면이 없습니다.')).toBeTruthy();
      expect(router.state.location.pathname).toBe('/notifications');
    }
  });

  it('stays on the list and explains when marking read fails', async () => {
    renderAt('/notifications', freelancer, {
      'GET /notifications': () => listResponse([notification(10)]),
      'PATCH /notifications/10/read': () => apiError(404, 'NOT_FOUND', '알림을 찾을 수 없습니다.'),
    });
    fireEvent.click(await screen.findByRole('button', { name: /지원 결과 안내/ }));
    expect(await screen.findByText('알림을 찾을 수 없습니다.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/notifications');
  });

  it('marks everything read after the server confirms and refreshes the list', async () => {
    let allRead = false;
    const readAll = deferred();
    renderAt('/notifications', freelancer, {
      'GET /notifications': () =>
        listResponse(
          [notification(2), notification(1)].map((n) =>
            allRead ? { ...n, isRead: true, readAt: '2026-10-14T06:00:00.000Z' } : n,
          ),
        ),
      'GET /notifications/unread-count': () => ({ data: { data: { count: allRead ? 0 : 2 } } }),
      'PATCH /notifications/read-all': () => readAll.promise,
    });
    await screen.findByRole('list', { name: '알림 목록' });
    fireEvent.click(screen.getByRole('button', { name: '모두 읽음' }));
    expect(await screen.findByRole('button', { name: '처리하는 중…' })).toBeTruthy();
    expect(screen.queryByText(/읽음으로 표시했습니다/)).toBeNull();

    allRead = true;
    readAll.resolve({ data: { data: { updatedCount: 2 } } });
    expect(await screen.findByText('알림 2개를 읽음으로 표시했습니다.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('읽지 않음')).toBeNull());
    expect(screen.getByRole('button', { name: '모두 읽음' }).disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole('link', { name: '알림' })).toBeTruthy());
    expect(callsTo('PATCH /notifications/read-all')).toHaveLength(1);
  });

  it('shows the empty and the error states', async () => {
    renderAt('/notifications', freelancer, { 'GET /notifications': () => listResponse([]) });
    expect(await screen.findByText('아직 받은 알림이 없습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '모두 읽음' }).disabled).toBe(true);
    cleanup();
    api.restore();

    let fail = true;
    renderAt('/notifications', freelancer, {
      'GET /notifications': () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', '잠시 후 다시 시도해 주세요.')
          : listResponse([notification(1)]),
    });
    expect(await screen.findByText('잠시 후 다시 시도해 주세요.')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('list', { name: '알림 목록' })).toBeTruthy();
  });

  it('sends signed-out visitors to the login page', async () => {
    renderAt('/notifications', null);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(callsTo('GET /notifications')).toHaveLength(0);
  });
});

describe('manual close (STAT-01) on my projects', () => {
  it('confirms, closes once and shows the result only after the server answers', async () => {
    let closed = false;
    const closing = deferred();
    renderAt('/me/projects', client, {
      'GET /me/projects': () =>
        myProjectsResponse([
          closed
            ? myProject({
                status: 'CLOSED',
                publicStatus: 'CLOSED',
                availableActions: ['EDIT', 'DELETE'],
              })
            : myProject(),
        ]),
      'POST /projects/41/close': () => closing.promise,
    });
    fireEvent.click(await screen.findByRole('button', { name: '모집 마감' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('지원자 전원에게 마감 알림');
    fireEvent.click(screen.getByRole('button', { name: '마감 확인' }));
    expect(await screen.findByRole('button', { name: '마감하는 중…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '마감하는 중…' }).disabled).toBe(true);
    expect(screen.queryByText(/모집을 마감했습니다/)).toBeNull();

    closed = true;
    closing.resolve({
      data: {
        data: {
          project: myProject({ status: 'CLOSED', availableActions: ['EDIT', 'DELETE'] }),
          rejectedCount: 2,
          notifiedCount: 3,
        },
      },
    });
    expect(
      await screen.findByText(
        '모집을 마감했습니다. 검토 대기 지원 2건을 자동으로 거절했습니다. 지원자 3명에게 마감 알림을 보냈습니다.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: '모집 마감' })).toBeNull());
    expect(screen.getByText('모집 마감')).toBeTruthy();
    expect(callsTo('POST /projects/41/close')).toHaveLength(1);
  });

  it('shows the server reason when the close is refused and offers no button without CLOSE', async () => {
    renderAt('/me/projects', client, {
      'GET /me/projects': () =>
        myProjectsResponse([
          myProject(),
          myProject({
            id: 42,
            title: '계약 대기 프로젝트',
            status: 'CONTRACTING',
            publicStatus: 'CLOSED',
            availableActions: [],
          }),
        ]),
      'POST /projects/41/close': () =>
        apiError(409, 'INVALID_STATE_TRANSITION', '이미 모집이 마감된 프로젝트입니다.'),
    });
    expect(await screen.findAllByRole('button', { name: '모집 마감' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '모집 마감' }));
    fireEvent.click(screen.getByRole('button', { name: '마감 확인' }));
    expect(await screen.findByText('이미 모집이 마감된 프로젝트입니다.')).toBeTruthy();
    expect(screen.queryByText(/모집을 마감했습니다/)).toBeNull();
  });
});
