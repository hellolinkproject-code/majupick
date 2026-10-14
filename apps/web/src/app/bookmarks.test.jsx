import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';
import { todayKst } from '../lib/projectForm.js';

const OPTIONS = {
  projectCategories: [
    { value: 'WEB', label: '웹' },
    { value: 'DESIGN', label: '디자인' },
  ],
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
  freelancerProfile: null,
  profileCompletion: { isComplete: false, missingFields: ['mainCategory'] },
};

const summary = (id, overrides = {}) => ({
  id,
  title: `프로젝트 ${id}`,
  category: 'WEB',
  budget: '3000000',
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 0,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  ...overrides,
});
const detail = (id, overrides = {}) => ({
  ...summary(id),
  description: '프로젝트 설명',
  client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
  isOwner: false,
  ...overrides,
});
/** 서버처럼 보는 사람에 따라 다른 상세를 준다. */
const detailFor =
  (id, { bookmarked = false, ...overrides } = {}) =>
  ({ authorization }) => ({
    data: {
      data: detail(id, {
        ...overrides,
        ...(authorization && { myApplication: null, isBookmarked: bookmarked }),
      }),
    },
  });
const bookmarkItem = (id, overrides = {}) => ({
  ...summary(id),
  descriptionPreview: '설명',
  isBookmarked: true,
  bookmarkedAt: '2026-10-14T02:00:00.000Z',
  myApplication: null,
  ...overrides,
});
const bookmarkPage = (items, pagination = {}) => ({
  data: {
    data: items,
    pagination: {
      page: 1,
      pageSize: 10,
      totalCount: items.length,
      totalPages: items.length ? 1 : 0,
      ...pagination,
    },
  },
});

let api;
let router;
let queryClient;

function renderAt(path, user, handlers = {}) {
  api = installMockApi({
    'POST /auth/refresh': () =>
      user ? sessionResponse(user) : apiError(401, 'INVALID_REFRESH_TOKEN'),
    'GET /auth/me': () => ({ data: { data: user } }),
    'GET /meta/options': () => ({ data: { data: OPTIONS } }),
    ...handlers,
  });
  router = createMemoryRouter(routes, { initialEntries: [path] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('bookmark button on the project detail', () => {
  it('saves and removes for a freelancer, locking the button while a request is pending', async () => {
    const put = deferred();
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': detailFor(41),
      'PUT /projects/41/bookmark': async () => {
        await put.promise;
        return { status: 204 };
      },
      'DELETE /projects/41/bookmark': () => ({ status: 204 }),
    });

    const button = await screen.findByRole('button', { name: '☆ 북마크하기' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(button);
    const pending = await screen.findByRole('button', { name: '저장하는 중…' });
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    put.resolve();

    const saved = await screen.findByRole('button', { name: '★ 북마크됨' });
    expect(saved.getAttribute('aria-pressed')).toBe('true');
    expect(callsTo('PUT /projects/41/bookmark')).toHaveLength(1);
    expect(callsTo('PUT /projects/41/bookmark')[0].authorization).toBe('Bearer access-token');
    const status = screen.getByRole('status');
    expect(within(status).getByRole('link', { name: '내 북마크 보기' }).getAttribute('href')).toBe(
      '/me/bookmarks',
    );
    // 지원 영역과는 따로 동작한다.
    expect(screen.getByText(/지원하려면 프로필을 먼저 완성해 주세요/)).toBeTruthy();

    fireEvent.click(saved);
    expect(await screen.findByRole('button', { name: '☆ 북마크하기' })).toBeTruthy();
    expect(callsTo('DELETE /projects/41/bookmark')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('북마크를 해제했습니다.');
  });

  it('shows the server error and refreshes the project when it is gone', async () => {
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': detailFor(41),
      'PUT /projects/41/bookmark': () => apiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'),
    });
    fireEvent.click(await screen.findByRole('button', { name: '☆ 북마크하기' }));
    const alert = await screen.findByText('프로젝트를 찾을 수 없습니다.');
    expect(alert.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(callsTo('GET /projects/41').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole('button', { name: '☆ 북마크하기' }).disabled).toBe(false);
  });

  it('sends guests to log in and brings them back to the project', async () => {
    renderAt('/projects/41', null, {
      'GET /projects/41': detailFor(41, { bookmarked: true }),
      'POST /auth/login': () => sessionResponse(freelancer),
    });
    const link = await screen.findByRole('link', { name: '☆ 로그인하고 북마크하기' });
    expect(link.getAttribute('href')).toBe('/login?returnTo=%2Fprojects%2F41');
    expect(screen.queryByRole('button', { name: /북마크/ })).toBeNull();

    fireEvent.click(link);
    await screen.findByRole('heading', { name: '로그인' });
    type('이메일', 'freelancer@workbridge.test');
    type('비밀번호', 'abcd1234');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    expect(await screen.findByRole('button', { name: '★ 북마크됨' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/41');
    expect(callsTo('PUT /projects/41/bookmark')).toHaveLength(0);
  });

  it('is hidden for clients, including the owner', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: detail(41, { isOwner: false }) } }),
    });
    await screen.findByRole('heading', { name: '프로젝트 41' });
    expect(screen.queryByRole('button', { name: /북마크/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /북마크/ })).toBeNull();
    expect(screen.queryByRole('link', { name: '내 북마크' })).toBeNull();
  });

  it('waits for the session before showing anyone’s bookmark state', async () => {
    const refresh = deferred();
    renderAt('/projects/41', freelancer, {
      'POST /auth/refresh': async () => {
        await refresh.promise;
        return sessionResponse(freelancer);
      },
      'GET /projects/41': detailFor(41, { bookmarked: true }),
    });
    await screen.findByText('프로젝트를 불러오는 중…');
    expect(screen.queryByRole('button', { name: /북마크/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /북마크/ })).toBeNull();
    expect(callsTo('GET /projects/41')).toHaveLength(0);

    refresh.resolve();
    expect(await screen.findByRole('button', { name: '★ 북마크됨' })).toBeTruthy();
    expect(callsTo('GET /projects/41').every((call) => call.authorization)).toBe(true);
  });
});

describe('my bookmarks page', () => {
  it('shows each project’s current state and only offers to apply while recruiting', async () => {
    renderAt('/me/bookmarks', freelancer, {
      'GET /me/bookmarks': () =>
        bookmarkPage(
          [
            bookmarkItem(1, { budget: '9007199254740993' }),
            bookmarkItem(2, { publicStatus: 'CLOSED', recruitEndDate: addDays(-1) }),
            bookmarkItem(3, { publicStatus: 'SCHEDULED', recruitStartDate: addDays(3) }),
            bookmarkItem(4, { myApplication: { id: 90, status: 'PENDING' } }),
          ],
          { totalCount: 14, totalPages: 2 },
        ),
    });

    const list = await screen.findByRole('list', { name: '내 북마크 목록' });
    const items = within(list).getAllByRole('listitem');
    const item = (id) =>
      items.find((li) => within(li).queryByRole('link', { name: `프로젝트 ${id}` }));

    expect(within(item(1)).getByText(/9,007,199,254,740,993원/)).toBeTruthy();
    expect(within(item(1)).getByRole('link', { name: '지원하러 가기' }).getAttribute('href')).toBe(
      '/projects/1',
    );
    expect(within(item(1)).getByText('React')).toBeTruthy();
    expect(within(item(1)).getByText('웹')).toBeTruthy();

    expect(within(item(2)).getByText('모집이 마감되어 지원할 수 없습니다.')).toBeTruthy();
    expect(within(item(2)).queryByRole('link', { name: '지원하러 가기' })).toBeNull();
    expect(within(item(2)).getByText('모집 마감')).toBeTruthy();

    expect(within(item(3)).getByText(/부터 지원할 수 있습니다/)).toBeTruthy();
    expect(within(item(3)).queryByRole('link', { name: '지원하러 가기' })).toBeNull();

    expect(within(item(4)).getByText(/이미 지원한 프로젝트입니다 \(검토 대기\)/)).toBeTruthy();
    expect(within(item(4)).queryByRole('link', { name: '지원하러 가기' })).toBeNull();

    expect(screen.getByText('1 / 2 페이지 (총 14개)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(router.state.location.search).toBe('?page=2'));
    await waitFor(() =>
      expect(callsTo('GET /me/bookmarks').map((call) => call.params.page)).toContain(2),
    );
  });

  it('removes a bookmark and reloads the list', async () => {
    let items = [bookmarkItem(1), bookmarkItem(2)];
    renderAt('/me/bookmarks', freelancer, {
      'GET /me/bookmarks': () => bookmarkPage(items),
      'DELETE /projects/1/bookmark': () => {
        items = items.filter((item) => item.id !== 1);
        return { status: 204 };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트 1 북마크 해제' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      '"프로젝트 1" 북마크를 해제했습니다.',
    );
    await waitFor(() => expect(screen.queryByRole('link', { name: '프로젝트 1' })).toBeNull());
    expect(screen.getByRole('link', { name: '프로젝트 2' })).toBeTruthy();
  });

  it('points an empty list to the search page', async () => {
    renderAt('/me/bookmarks', freelancer, { 'GET /me/bookmarks': () => bookmarkPage([]) });
    expect(await screen.findByText(/아직 북마크한 프로젝트가 없습니다/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '프로젝트 찾아보기' }).getAttribute('href')).toBe(
      '/projects',
    );
  });

  it('is freelancer only and never asks the API for a client', async () => {
    renderAt('/me/bookmarks', client, {});
    expect(await screen.findByRole('heading', { name: '프리랜서 전용 화면입니다' })).toBeTruthy();
    expect(callsTo('GET /me/bookmarks')).toHaveLength(0);
  });

  it('links from the header and clears personal caches on logout', async () => {
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': detailFor(41, { bookmarked: true }),
      'GET /me/bookmarks': () => bookmarkPage([bookmarkItem(41)]),
      'POST /auth/logout': () => ({ status: 204 }),
    });
    await screen.findByRole('button', { name: '★ 북마크됨' });
    fireEvent.click(screen.getByRole('link', { name: '내 북마크' }));
    await screen.findByRole('link', { name: '프로젝트 41' });
    expect(queryClient.getQueriesData({ queryKey: ['bookmarks', '8'] }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    await screen.findByRole('link', { name: '로그인' });
    expect(queryClient.getQueriesData({ queryKey: ['bookmarks'] })).toEqual([]);
    expect(
      queryClient.getQueryCache().findAll({
        predicate: (query) => query.queryKey[0] === 'project' && query.queryKey[2] === 8,
      }),
    ).toEqual([]);
  });
});

describe('recommended projects on the detail page', () => {
  it('shows recommendation cards that open another project', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/projects/41', null, {
      'GET /projects/41': detailFor(41),
      'GET /projects/52': detailFor(52, { title: '추천된 프로젝트' }),
      'GET /projects/41/recommendations': () => ({
        data: {
          data: [
            {
              ...summary(52, { title: '추천된 프로젝트', budget: '9007199254740993' }),
              descriptionPreview: '비슷한 일',
              match: { sameCategory: true, sharedTechStackCount: 2 },
            },
            {
              ...summary(53, { category: 'DESIGN' }),
              descriptionPreview: '',
              match: { sameCategory: false, sharedTechStackCount: 1 },
            },
          ],
        },
      }),
    });
    const section = await screen.findByRole('region', {
      name: '이 프로젝트와 비슷한 모집 중 프로젝트',
    });
    const list = await within(section).findByRole('list', { name: '추천 프로젝트 목록' });
    expect(within(list).getByText('같은 카테고리 · 기술 스택 2개 일치')).toBeTruthy();
    expect(within(list).getByText('기술 스택 1개 일치')).toBeTruthy();
    expect(within(list).getByText(/9,007,199,254,740,993원/)).toBeTruthy();
    expect(within(list).getByText('디자인')).toBeTruthy();

    fireEvent.click(within(list).getByRole('link', { name: '추천된 프로젝트' }));
    expect(await screen.findByRole('heading', { level: 1, name: '추천된 프로젝트' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/52');
    expect(callsTo('GET /projects/52/recommendations')).toHaveLength(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it('shows a natural empty state, an error with retry, and hides itself on 404', async () => {
    renderAt('/projects/41', null, { 'GET /projects/41': detailFor(41) });
    expect(
      await screen.findByText('지금은 비슷한 조건으로 모집 중인 프로젝트가 없습니다.'),
    ).toBeTruthy();
    cleanup();
    api.restore();
    useSessionStore.setState({ status: 'idle', accessToken: null, user: null });

    let fail = true;
    renderAt('/projects/41', null, {
      'GET /projects/41': detailFor(41),
      'GET /projects/41/recommendations': () =>
        fail ? apiError(500, 'INTERNAL_ERROR') : { data: { data: [] } },
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      '추천 프로젝트를 불러오지 못했습니다.',
    );
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(
      await screen.findByText('지금은 비슷한 조건으로 모집 중인 프로젝트가 없습니다.'),
    ).toBeTruthy();
    cleanup();
    api.restore();
    useSessionStore.setState({ status: 'idle', accessToken: null, user: null });

    renderAt('/projects/41', null, {
      'GET /projects/41': detailFor(41),
      'GET /projects/41/recommendations': () => apiError(404, 'NOT_FOUND'),
    });
    await screen.findByRole('heading', { name: '프로젝트 41' });
    await waitFor(() => expect(callsTo('GET /projects/41/recommendations')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /비슷한 모집 중 프로젝트/ })).toBeNull(),
    );
  });
});
