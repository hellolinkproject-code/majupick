import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi } from '../test/mockApi.js';
import {
  criteriaFromParams,
  criteriaToParams,
  normalizeAmount,
  pageWindow,
} from '../lib/projectSearch.js';

const OPTIONS = {
  projectCategories: [
    { value: 'WEB', label: '웹' },
    { value: 'DESIGN', label: '디자인' },
  ],
  businessFields: [{ value: 'IT', label: 'IT' }],
};
const STACKS = [
  { id: 1, name: 'React', isCustom: false },
  { id: 2, name: 'Node.js', isCustom: false },
];
const BIG_BUDGET = '9007199254740993123';

const summary = (overrides = {}) => ({
  id: 41,
  title: '쇼핑몰 리뉴얼',
  category: 'WEB',
  budget: BIG_BUDGET,
  recruitStartDate: null,
  recruitEndDate: '2026-11-05',
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 0,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  descriptionPreview: '반응형 쇼핑몰 프론트엔드',
  ...overrides,
});
const page = (data, pagination = {}) => ({
  data: {
    data,
    pagination: {
      page: 1,
      pageSize: 10,
      totalCount: data.length,
      totalPages: data.length > 0 ? 1 : 0,
      ...pagination,
    },
  },
});

let api;
let router;

function renderAt(path, handlers = {}) {
  api = installMockApi({
    'POST /auth/refresh': () => apiError(401, 'INVALID_REFRESH_TOKEN'),
    'GET /meta/options': () => ({ data: { data: OPTIONS } }),
    'GET /tech-stacks': ({ params }) => ({
      data: {
        data: params?.ids
          ? STACKS.filter((stack) => params.ids.split(',').includes(String(stack.id)))
          : STACKS,
      },
    }),
    'GET /projects': () => page([summary()]),
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

const searchCalls = () => api.calls.filter((call) => call.key === 'GET /projects');
const lastSearch = () => searchCalls().at(-1)?.params;
const currentSearch = () => router.state.location.search;
const change = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('search criteria helpers', () => {
  it('normalizes URL values, drops invalid ones and omits defaults', () => {
    const criteria = criteriaFromParams(
      new URLSearchParams(
        'q=  쇼핑몰   React &category=GAME&budgetMin=1,000&budgetMax=abc&techStackIds=5,1,x,5' +
          '&deadline=2026-02-30&status=CONTRACTING&sort=budget&page=0',
      ),
      ['WEB'],
    );
    expect(criteria).toEqual({
      q: '쇼핑몰 React',
      category: '',
      budgetMin: '1000',
      budgetMax: '',
      techStackIds: [1, 5],
      deadline: '',
      status: '',
      sort: 'budget',
      page: 1,
    });
    expect(criteriaToParams(criteria).toString()).toBe(
      new URLSearchParams({
        q: '쇼핑몰 React',
        budgetMin: '1000',
        techStackIds: '1,5',
        sort: 'budget',
      }).toString(),
    );
  });

  it('keeps big budgets exact and windows page numbers', () => {
    expect(normalizeAmount('9,223,372,036,854,775,807')).toBe('9223372036854775807');
    expect(normalizeAmount('9223372036854775808')).toBeNull();
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(9, 20)).toEqual([7, 8, 9, 10, 11]);
    expect(pageWindow(20, 20)).toEqual([16, 17, 18, 19, 20]);
  });
});

describe('project search page (SRCH-01)', () => {
  it('shows public cards to anonymous visitors from the header link', async () => {
    renderAt('/');
    const header = within(screen.getByRole('banner'));
    fireEvent.click(await header.findByRole('link', { name: '프로젝트 찾기' }));

    expect(await screen.findByRole('heading', { name: '총 1개' })).toBeTruthy();
    const card = within(screen.getByRole('list', { name: '프로젝트 검색 결과' }));
    expect(card.getByRole('link', { name: '쇼핑몰 리뉴얼' }).getAttribute('href')).toBe(
      '/projects/41',
    );
    expect(card.getByText('모집 중')).toBeTruthy();
    expect(await card.findByText('웹')).toBeTruthy();
    expect(card.getByText('반응형 쇼핑몰 프론트엔드')).toBeTruthy();
    expect(card.getByText('예산 9,007,199,254,740,993,123원 · 마감 2026. 11. 5.')).toBeTruthy();
    expect(card.getByText('React')).toBeTruthy();
    expect(card.queryByRole('button', { name: /지원/ })).toBeNull();
    expect(lastSearch()).toEqual({});
  });

  it('debounces the keyword, keeps it in the URL and resets to page 1', async () => {
    renderAt('/projects?page=3', {
      'GET /projects': ({ params }) =>
        page([summary()], { page: Number(params.page ?? 1), totalCount: 30, totalPages: 3 }),
    });
    await screen.findByRole('heading', { name: '총 30개' });

    change('검색어', '쇼');
    change('검색어', '쇼핑');
    change('검색어', '쇼핑몰  React ');
    await waitFor(() =>
      expect(currentSearch()).toBe(`?${new URLSearchParams({ q: '쇼핑몰 React' })}`),
    );
    await waitFor(() => expect(lastSearch()).toEqual({ q: '쇼핑몰 React' }));
    expect(searchCalls().filter((call) => call.params.q)).toHaveLength(1);
    expect(screen.getByLabelText('검색어').value).toBe('쇼핑몰  React ');
  });

  it('applies each filter and the sort to the URL and the request', async () => {
    renderAt('/projects');
    await screen.findByRole('heading', { name: '총 1개' });
    await screen.findByRole('option', { name: '디자인' });

    change('카테고리', 'DESIGN');
    await waitFor(() => expect(lastSearch()).toEqual({ category: 'DESIGN' }));
    change('모집 상태', 'RECRUITING');
    change('마감일', '2026-11-30');
    change('정렬', 'deadline');
    await waitFor(() =>
      expect(lastSearch()).toEqual({
        category: 'DESIGN',
        status: 'RECRUITING',
        deadline: '2026-11-30',
        sort: 'deadline',
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Node.js' }));
    await waitFor(() => expect(lastSearch().techStackIds).toBe('2'));
    const chips = within(await screen.findByRole('list', { name: '선택한 기술 스택' }));
    expect(chips.getByText('Node.js')).toBeTruthy();

    change('최소 예산', '1,000,000');
    change('최대 예산', '500');
    expect(await screen.findByText('최대 예산은 최소 예산보다 크거나 같아야 합니다.')).toBeTruthy();
    change('최대 예산', '9,007,199,254,740,993,123');
    await waitFor(() => expect(lastSearch().budgetMax).toBe(BIG_BUDGET));
    expect(lastSearch().budgetMin).toBe('1000000');
    expect(searchCalls().some((call) => call.params.budgetMax === '500')).toBe(false);
    expect(currentSearch()).toContain(`budgetMax=${BIG_BUDGET}`);

    fireEvent.click(screen.getByRole('button', { name: 'Node.js 필터 빼기' }));
    await waitFor(() => expect(lastSearch()).not.toHaveProperty('techStackIds'));
  });

  it('keeps every condition when several change before the page re-renders', async () => {
    renderAt('/projects');
    await screen.findByRole('heading', { name: '총 1개' });
    await screen.findByRole('option', { name: '디자인' });

    act(() => {
      change('카테고리', 'DESIGN');
      change('모집 상태', 'RECRUITING');
      change('정렬', 'budget');
    });
    await waitFor(() =>
      expect(lastSearch()).toEqual({ category: 'DESIGN', status: 'RECRUITING', sort: 'budget' }),
    );

    change('검색어', '쇼핑몰');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await waitFor(() => expect(lastSearch().q).toBe('쇼핑몰'));
    act(() => {
      change('검색어', '리뉴얼');
      fireEvent.submit(screen.getByRole('search'));
      change('카테고리', 'WEB');
    });
    await waitFor(() =>
      expect(lastSearch()).toEqual({
        q: '리뉴얼',
        category: 'WEB',
        status: 'RECRUITING',
        sort: 'budget',
      }),
    );
    expect(screen.getByLabelText('검색어').value).toBe('리뉴얼');

    await screen.findByRole('button', { name: 'Node.js' });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Node.js' }));
      fireEvent.click(screen.getByRole('button', { name: 'React' }));
    });
    await waitFor(() => expect(lastSearch().techStackIds).toBe('1,2'));
    expect(lastSearch().category).toBe('WEB');
  });

  it('restores every condition from the URL after a refresh and resets them', async () => {
    renderAt(
      '/projects?q=%EC%87%BC%ED%95%91%EB%AA%B0&category=WEB&techStackIds=2,1&budgetMin=1000' +
        '&status=CLOSED&sort=budget&page=2',
      {
        'GET /projects': () => page([summary()], { page: 2, totalCount: 11, totalPages: 2 }),
      },
    );
    await screen.findByRole('heading', { name: '총 11개' });
    expect(lastSearch()).toEqual({
      q: '쇼핑몰',
      category: 'WEB',
      budgetMin: '1000',
      techStackIds: '1,2',
      status: 'CLOSED',
      sort: 'budget',
      page: '2',
    });
    expect(screen.getByLabelText('검색어').value).toBe('쇼핑몰');
    expect(screen.getByLabelText('정렬').value).toBe('budget');
    expect(screen.getByLabelText('모집 상태').value).toBe('CLOSED');
    expect(screen.getByLabelText('최소 예산').value).toBe('1000');
    const chips = within(screen.getByRole('list', { name: '선택한 기술 스택' }));
    expect(await chips.findByText('React')).toBeTruthy();
    expect(chips.getByText('Node.js')).toBeTruthy();
    expect(screen.getByRole('button', { name: '2페이지' }).getAttribute('aria-current')).toBe(
      'page',
    );

    fireEvent.click(screen.getAllByRole('button', { name: '조건 초기화' })[0]);
    await waitFor(() => expect(currentSearch()).toBe(''));
    await waitFor(() => expect(lastSearch()).toEqual({}));
    expect(screen.getByLabelText('검색어').value).toBe('');
    expect(screen.getByLabelText('최소 예산').value).toBe('');
    expect(screen.queryByRole('list', { name: '선택한 기술 스택' })).toBeNull();
  });

  it('moves between pages and goes back to page 1 when a filter changes', async () => {
    renderAt('/projects', {
      'GET /projects': ({ params }) =>
        page([summary({ id: Number(params.page ?? 1), title: `결과 ${params.page ?? 1}` })], {
          page: Number(params.page ?? 1),
          totalCount: 25,
          totalPages: 3,
        }),
    });
    expect(await screen.findByRole('link', { name: '결과 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '2페이지' }));
    expect(await screen.findByRole('link', { name: '결과 2' })).toBeTruthy();
    expect(currentSearch()).toBe('?page=2');
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByRole('link', { name: '결과 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '다음' }).disabled).toBe(true);

    change('모집 상태', 'SCHEDULED');
    await waitFor(() => expect(currentSearch()).toBe('?status=SCHEDULED'));
    expect(await screen.findByRole('link', { name: '결과 1' })).toBeTruthy();
  });

  it('opens the detail page and comes back to the same search', async () => {
    renderAt('/projects?q=%EC%87%BC%ED%95%91%EB%AA%B0&page=2', {
      'GET /projects': () => page([summary()], { page: 2, totalCount: 11, totalPages: 2 }),
      'GET /projects/41': () => ({
        data: {
          data: {
            ...summary(),
            description: '반응형 쇼핑몰 프론트엔드',
            client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
            isOwner: false,
          },
        },
      }),
    });
    fireEvent.click(await screen.findByRole('link', { name: '쇼핑몰 리뉴얼' }));
    expect(await screen.findByRole('heading', { level: 1, name: '쇼핑몰 리뉴얼' })).toBeTruthy();
    const back = screen.getByRole('link', { name: '← 검색 결과로 돌아가기' });
    expect(back.getAttribute('href')).toBe('/projects?q=%EC%87%BC%ED%95%91%EB%AA%B0&page=2');

    await router.navigate(-1);
    expect(await screen.findByRole('heading', { name: '총 11개' })).toBeTruthy();
    expect(screen.getByLabelText('검색어').value).toBe('쇼핑몰');
    expect(currentSearch()).toBe('?q=%EC%87%BC%ED%95%91%EB%AA%B0&page=2');
  });

  it('shows loading, error with retry, empty and out-of-range states', async () => {
    let attempt = 0;
    let release;
    renderAt('/projects?q=slow', {
      'GET /projects': ({ params }) => {
        if (params.q === 'none')
          return new Promise((resolve) => setTimeout(() => resolve(page([])), 30));
        if (params.page === '9') return page([], { page: 9, totalCount: 12, totalPages: 2 });
        attempt += 1;
        if (attempt === 1) {
          return new Promise((resolve) => {
            release = () => resolve(apiError(500, 'INTERNAL_ERROR', '잠시 후 다시 시도해 주세요.'));
          });
        }
        return page([summary()]);
      },
    });
    expect(await screen.findByText('프로젝트를 불러오는 중…')).toBeTruthy();
    await waitFor(() => expect(release).toBeTruthy());
    release();
    expect(await screen.findByText('잠시 후 다시 시도해 주세요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('link', { name: '쇼핑몰 리뉴얼' })).toBeTruthy();

    // 조건을 바꾸면 이전 결과를 흐리게 둔 채 새 결과를 기다린다.
    await router.navigate('/projects?q=none');
    expect(await screen.findByText('새 결과를 불러오는 중…')).toBeTruthy();
    expect(screen.getByRole('list', { name: '프로젝트 검색 결과' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(await screen.findByText('조건에 맞는 프로젝트가 없습니다.')).toBeTruthy();

    await router.navigate('/projects?page=9');
    expect(await screen.findByText(/요청한 페이지가 없습니다/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '마지막 페이지로' }));
    await waitFor(() => expect(currentSearch()).toBe('?page=2'));
  });

  it('never lets an older response replace the results of the newer search', async () => {
    const pending = {};
    renderAt('/projects', {
      'GET /projects': ({ params }) =>
        params.q
          ? new Promise((resolve) => {
              pending[params.q] = () => resolve(page([summary({ title: `${params.q} 결과` })]));
            })
          : page([summary()]),
    });
    await screen.findByRole('heading', { name: '총 1개' });

    change('검색어', '앱');
    await waitFor(() => expect(pending['앱']).toBeTruthy());
    change('검색어', '앱 개발');
    await waitFor(() => expect(pending['앱 개발']).toBeTruthy());

    pending['앱 개발']();
    expect(await screen.findByRole('link', { name: '앱 개발 결과' })).toBeTruthy();
    pending['앱']();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: '앱 결과' })).toBeNull();
    expect(screen.getByRole('link', { name: '앱 개발 결과' })).toBeTruthy();
  });

  it('collapses the filter panel behind an accessible toggle on small screens', async () => {
    renderAt('/projects?category=WEB&status=RECRUITING');
    const toggle = await screen.findByRole('button', { name: '필터 (2) 펼치기' });
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.className).not.toContain('is-open');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('필터 (2) 접기');
    expect(panel.className).toContain('is-open');
    expect(within(panel).getByLabelText('카테고리')).toBeTruthy();
  });

  it('enters the list from the home search box and category buttons (A-19)', async () => {
    renderAt('/', { 'GET /health': () => ({ data: { status: 'ok' } }) });
    const home = within(screen.getByRole('main'));
    fireEvent.change(home.getByLabelText('검색어'), { target: { value: ' 쇼핑몰 ' } });
    fireEvent.click(home.getByRole('button', { name: '검색' }));
    await waitFor(() => expect(currentSearch()).toBe(`?${new URLSearchParams({ q: '쇼핑몰' })}`));
    expect(router.state.location.pathname).toBe('/projects');
    expect(await screen.findByLabelText('검색어')).toBeTruthy();
    await waitFor(() => expect(lastSearch()).toEqual({ q: '쇼핑몰' }));

    await router.navigate('/');
    const categories = within(await screen.findByRole('list', { name: '카테고리로 찾기' }));
    expect(categories.getByRole('link', { name: '디자인' }).getAttribute('href')).toBe(
      '/projects?category=DESIGN',
    );
  });
});
