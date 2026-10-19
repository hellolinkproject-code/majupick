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
const STACKS = [
  { id: 1, name: 'React', isCustom: false },
  { id: 2, name: 'Node.js', isCustom: false },
];
const BIG_BUDGET = '9007199254740993123';
// 3단계를 모두 거치는 jsdom 흐름은 전체 테스트와 함께 돌면 기본 5초를 넘길 수 있다.
// 느린 Windows/jsdom에서는 3단계 퍼널이 20초를 넘을 수 있다.
const FUNNEL_TIMEOUT = 60_000;
const TODAY = todayKst();
const addDays = (offset) => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const complete = { isComplete: true, missingFields: [] };
const client = {
  id: 7,
  email: 'client@workbridge.test',
  name: '김의뢰',
  role: 'CLIENT',
  profileImageUrl: null,
  bio: null,
  hasPassword: true,
  socialProviders: [],
  clientProfile: { companyName: '워크브릿지', businessField: 'IT', businessFieldEtc: null },
  freelancerProfile: null,
  profileCompletion: complete,
};
const incompleteClient = {
  ...client,
  clientProfile: null,
  profileCompletion: { isComplete: false, missingFields: ['companyName', 'businessField'] },
};
const freelancer = { ...client, id: 8, role: 'FREELANCER', clientProfile: null };

const detail = (overrides = {}) => ({
  id: 41,
  title: '쇼핑몰 리뉴얼',
  description: '반응형 쇼핑몰\n관리자 화면',
  category: 'WEB',
  budget: BIG_BUDGET,
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 0,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
  isOwner: true,
  status: 'RECRUITING',
  availableActions: ['EDIT', 'DELETE'],
  lockedFields: [],
  ...overrides,
});

let api;
let router;

function renderAt(path, user, handlers = {}) {
  api = installMockApi({
    'POST /auth/refresh': () =>
      user ? sessionResponse(user) : apiError(401, 'INVALID_REFRESH_TOKEN'),
    'GET /auth/me': () => ({ data: { data: user } }),
    'GET /meta/options': () => ({ data: { data: OPTIONS } }),
    'GET /tech-stacks': () => ({ data: { data: STACKS } }),
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

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
const callsTo = (key) => api.calls.filter((call) => call.key === key);

beforeEach(() => {
  sessionStorage.clear();
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
  vi.restoreAllMocks();
});

async function fillStepOne() {
  await screen.findByRole('heading', { name: '1단계 · 기본 정보' });
  type(/^프로젝트 제목/, '  쇼핑몰 리뉴얼 ');
  type(/^카테고리/, 'WEB');
  type(/^프로젝트 설명/, ' 반응형 쇼핑몰 ');
  click('다음');
  await screen.findByRole('heading', { name: '2단계 · 일정·예산' });
}

describe('project registration funnel', () => {
  it(
    'walks through 3 steps, keeps values between steps and creates the project once',
    async () => {
      let resolveCreate;
      renderAt('/projects/new', client, {
        'POST /projects': () =>
          new Promise((resolve) => {
            resolveCreate = () => resolve({ status: 201, data: { data: detail() } });
          }),
        'GET /projects/41': () => ({ data: { data: detail() } }),
      });

      expect(await screen.findByRole('link', { name: '프로젝트 등록' })).toBeTruthy();
      await screen.findByRole('heading', { name: '1단계 · 기본 정보' });
      click('다음');
      expect(await screen.findByText('제목을 입력해 주세요.')).toBeTruthy();
      expect(screen.getByText('카테고리를 선택해 주세요.')).toBeTruthy();
      expect(screen.getByText('프로젝트 설명을 입력해 주세요.')).toBeTruthy();

      await fillStepOne();
      type(/^모집 시작일/, addDays(-1));
      type(/^모집 마감일/, addDays(-2));
      type(/^예산/, '0');
      click('다음');
      expect(await screen.findByText('모집 시작일은 오늘 이후 날짜로 입력해 주세요.')).toBeTruthy();
      expect(screen.getByText('모집 마감일은 오늘 이후 날짜로 입력해 주세요.')).toBeTruthy();
      expect(screen.getByText('예산은 1원 이상의 정수로 입력해 주세요.')).toBeTruthy();

      type(/^모집 시작일/, '');
      type(/^모집 마감일/, addDays(14));
      type(/^예산/, '9,007,199,254,740,993,123');
      expect(screen.getByLabelText(/^예산/).value).toBe(BIG_BUDGET);
      expect(screen.getByText('= 9,007,199,254,740,993,123원')).toBeTruthy();

      click('이전');
      expect(screen.getByLabelText(/^프로젝트 제목/).value).toBe('  쇼핑몰 리뉴얼 ');
      expect(screen.getByLabelText(/^카테고리/).value).toBe('WEB');
      click('다음');
      await screen.findByRole('heading', { name: '2단계 · 일정·예산' });
      expect(screen.getByLabelText(/^예산/).value).toBe(BIG_BUDGET);
      click('다음');

      await screen.findByRole('heading', { name: '3단계 · 기술 스택' });
      click('프로젝트 등록');
      expect(await screen.findByText('필요한 기술 스택을 1개 이상 선택해 주세요.')).toBeTruthy();
      const results = within(await screen.findByRole('list', { name: '기술 스택 검색 결과' }));
      fireEvent.click(results.getByRole('button', { name: 'React' }));
      const review = within(screen.getByLabelText('입력 내용 확인'));
      expect(review.getByText('쇼핑몰 리뉴얼')).toBeTruthy();
      expect(review.getByText('9,007,199,254,740,993,123원')).toBeTruthy();

      click('프로젝트 등록');
      await waitFor(() => expect(callsTo('POST /projects')).toHaveLength(1));
      const submitButton = screen.getByRole('button', { name: '등록하는 중…' });
      expect(submitButton.hasAttribute('disabled')).toBe(true);
      fireEvent.click(submitButton);
      expect(callsTo('POST /projects')).toHaveLength(1);

      const [call] = callsTo('POST /projects');
      expect(call.body).toEqual({
        title: '쇼핑몰 리뉴얼',
        category: 'WEB',
        description: '반응형 쇼핑몰',
        recruitStartDate: null,
        recruitEndDate: addDays(14),
        budget: BIG_BUDGET,
        techStackIds: [1],
      });
      expect(call.header('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

      resolveCreate();
      expect(await screen.findByText('프로젝트를 등록했습니다.')).toBeTruthy();
      expect(router.state.location.pathname).toBe('/projects/41');
      expect(screen.getByRole('heading', { level: 1, name: '쇼핑몰 리뉴얼' })).toBeTruthy();
      expect(sessionStorage.length).toBe(0);
    },
    FUNNEL_TIMEOUT,
  );

  it(
    'restores the draft and reuses the same idempotency key after a reload',
    async () => {
      renderAt('/projects/new', client, {
        'POST /projects': () => apiError(500, 'INTERNAL_ERROR', '잠시 후 다시 시도해 주세요.'),
      });
      await fillStepOne();
      type(/^모집 마감일/, addDays(3));
      type(/^예산/, '3000000');
      click('다음');
      await screen.findByRole('heading', { name: '3단계 · 기술 스택' });
      fireEvent.click(
        within(await screen.findByRole('list', { name: '기술 스택 검색 결과' })).getByRole(
          'button',
          {
            name: 'Node.js',
          },
        ),
      );
      click('프로젝트 등록');
      expect(await screen.findByText('잠시 후 다시 시도해 주세요.')).toBeTruthy();
      const firstKey = callsTo('POST /projects')[0].header('Idempotency-Key');

      cleanup();
      api.restore();
      useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
      renderAt('/projects/new', client, {
        'POST /projects': () => ({ status: 200, data: { data: detail() } }),
        'GET /projects/41': () => ({ data: { data: detail() } }),
      });
      expect(await screen.findByRole('heading', { name: '3단계 · 기술 스택' })).toBeTruthy();
      expect(
        within(screen.getByRole('list', { name: '선택한 기술 스택' })).getByText('Node.js'),
      ).toBeTruthy();
      click('프로젝트 등록');
      await waitFor(() => expect(router.state.location.pathname).toBe('/projects/41'));
      expect(callsTo('POST /projects')[0].header('Idempotency-Key')).toBe(firstKey);
    },
    FUNNEL_TIMEOUT,
  );

  it(
    'returns to the step of a field the server rejected',
    async () => {
      renderAt('/projects/new', client, {
        'POST /projects': () =>
          apiError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
            fields: { recruitEndDate: '모집 마감일은 오늘 이후 날짜로 입력해 주세요.' },
          }),
      });
      await fillStepOne();
      type(/^모집 마감일/, addDays(1));
      type(/^예산/, '1000');
      click('다음');
      await screen.findByRole('heading', { name: '3단계 · 기술 스택' });
      fireEvent.click(
        within(await screen.findByRole('list', { name: '기술 스택 검색 결과' })).getByRole(
          'button',
          {
            name: 'React',
          },
        ),
      );
      click('프로젝트 등록');
      expect(await screen.findByRole('heading', { name: '2단계 · 일정·예산' })).toBeTruthy();
      expect(screen.getByText('모집 마감일은 오늘 이후 날짜로 입력해 주세요.')).toBeTruthy();
    },
    FUNNEL_TIMEOUT,
  );

  it(
    'runs AI price analysis on step 2 and applies the total to the budget field',
    async () => {
      renderAt('/projects/new', client, {
        'POST /ai/price-analyses': ({ body }) => {
          expect(body).toMatchObject({
            title: '쇼핑몰 리뉴얼',
            description: '반응형 쇼핑몰',
            category: 'WEB',
            techStackIds: [],
          });
          return {
            data: {
              data: {
                items: [
                  {
                    name: '화면·반응형 UI',
                    description: '주요 페이지',
                    estimatedAmount: '1000000',
                    rationale: '약 5일',
                  },
                  {
                    name: '핵심 API',
                    description: 'CRUD',
                    estimatedAmount: '1500000',
                    rationale: '약 6일',
                  },
                ],
                totalAmount: '2500000',
                assumptions: ['모의 산정'],
                isMock: true,
              },
            },
          };
        },
      });

      await fillStepOne();
      expect(screen.getByRole('heading', { name: 'AI 단가 분석' })).toBeTruthy();
      click('AI로 단가 분석');
      expect(await screen.findByText('모의(mock) 분석 결과 · 실제 LLM 호출 없음')).toBeTruthy();
      expect(screen.getByText('화면·반응형 UI')).toBeTruthy();
      expect(screen.getByText(/총 예상 금액/)).toBeTruthy();
      expect(screen.getByText('2,500,000원')).toBeTruthy();
      click('예산에 반영');
      expect(screen.getByLabelText(/^예산/).value).toBe('2500000');
      expect(callsTo('POST /ai/price-analyses')).toHaveLength(1);
    },
    FUNNEL_TIMEOUT,
  );
});

describe('project registration access', () => {
  it('blocks freelancers and hides the client menu', async () => {
    renderAt('/projects/new', freelancer);
    expect(
      await screen.findByRole('heading', { name: '프로젝트 등록은 의뢰인만 할 수 있습니다' }),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: '프로젝트 등록' })).toBeNull();
    expect(screen.queryByRole('link', { name: '내 프로젝트' })).toBeNull();
  });

  it('guides incomplete clients to the profile and back', async () => {
    renderAt('/projects/new', incompleteClient);
    expect(
      await screen.findByText('프로젝트를 등록하려면 프로필을 먼저 완성해 주세요.'),
    ).toBeTruthy();
    expect(screen.getByText('남은 필수 항목: 회사명, 사업 분야')).toBeTruthy();
    expect(screen.getByRole('link', { name: '프로필 완성하러 가기' }).getAttribute('href')).toBe(
      '/me?returnTo=%2Fprojects%2Fnew',
    );
    expect(screen.queryByRole('form', { name: '프로젝트 등록' })).toBeNull();
  });

  it(
    'shows PROFILE_INCOMPLETE from the server with the missing fields',
    async () => {
      renderAt('/projects/new', client, {
        'POST /projects': () =>
          apiError(403, 'PROFILE_INCOMPLETE', '프로필을 먼저 완성해 주세요.', {
            missingFields: ['businessField'],
          }),
      });
      await fillStepOne();
      type(/^모집 마감일/, addDays(1));
      type(/^예산/, '1000');
      click('다음');
      await screen.findByRole('heading', { name: '3단계 · 기술 스택' });
      fireEvent.click(
        within(await screen.findByRole('list', { name: '기술 스택 검색 결과' })).getByRole(
          'button',
          {
            name: 'React',
          },
        ),
      );
      click('프로젝트 등록');
      expect(await screen.findByText('남은 필수 항목: 사업 분야')).toBeTruthy();
    },
    FUNNEL_TIMEOUT,
  );

  it('sends anonymous users to login with a return path', async () => {
    renderAt('/projects/new', null);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain('returnTo=%2Fprojects%2Fnew');
  });
});

describe('project detail, edit and delete', () => {
  it('shows the public view without owner controls', async () => {
    const publicView = detail({ isOwner: false });
    delete publicView.status;
    delete publicView.availableActions;
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({ data: { data: publicView } }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: '쇼핑몰 리뉴얼' })).toBeTruthy();
    expect(screen.getByText('모집 중')).toBeTruthy();
    expect(screen.getByText('9,007,199,254,740,993,123원')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '수정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
  });

  it('shows not found for deleted projects', async () => {
    renderAt('/projects/99', client, {
      'GET /projects/99': () => apiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'),
    });
    expect(
      await screen.findByRole('heading', { name: '프로젝트를 찾을 수 없습니다' }),
    ).toBeTruthy();
  });

  it('edits only the changed fields and keeps locked dates disabled', async () => {
    const closed = detail({
      status: 'CLOSED',
      publicStatus: 'CLOSED',
      recruitEndDate: addDays(-1),
      lockedFields: ['recruitStartDate', 'recruitEndDate'],
    });
    renderAt('/projects/41/edit', client, {
      'GET /projects/41': () => ({ data: { data: closed } }),
      'PATCH /projects/41': ({ body }) => ({ data: { data: { ...closed, ...body } } }),
    });

    expect((await screen.findByLabelText(/^프로젝트 제목/)).value).toBe('쇼핑몰 리뉴얼');
    expect(screen.getByLabelText(/^모집 마감일/).hasAttribute('disabled')).toBe(true);
    click('수정 내용 저장');
    expect(await screen.findByText('변경한 내용이 없습니다.')).toBeTruthy();
    expect(callsTo('PATCH /projects/41')).toHaveLength(0);

    type(/^프로젝트 제목/, ' 새 제목 ');
    expect(screen.queryByText('변경한 내용이 없습니다.')).toBeNull();
    type(/^예산/, '9223372036854775807');
    click('수정 내용 저장');
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/41'));
    expect(callsTo('PATCH /projects/41')[0].body).toEqual({
      title: '새 제목',
      budget: '9223372036854775807',
    });
    expect(await screen.findByText('프로젝트를 수정했습니다.')).toBeTruthy();
  });

  it('blocks editing for non-owners', async () => {
    renderAt('/projects/41/edit', client, {
      'GET /projects/41': () => ({ data: { data: detail({ isOwner: false }) } }),
    });
    expect(await screen.findByRole('heading', { name: '수정 권한이 없습니다' })).toBeTruthy();
  });

  it('asks for confirmation, soft deletes and returns to my projects', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: detail() } }),
      'DELETE /projects/41': () => ({ status: 204 }),
      'GET /me/projects': () => ({
        data: { data: [], pagination: { page: 1, pageSize: 10, totalCount: 0, totalPages: 0 } },
      }),
    });

    await screen.findByRole('button', { name: '삭제' });
    click('삭제');
    expect(screen.getByText(/이 프로젝트를 삭제할까요\?/)).toBeTruthy();
    click('취소');
    expect(callsTo('DELETE /projects/41')).toHaveLength(0);

    click('삭제');
    click('삭제 확인');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/projects'));
    expect(await screen.findByText('프로젝트를 삭제했습니다.')).toBeTruthy();
    expect(await screen.findByText('아직 등록한 프로젝트가 없습니다.')).toBeTruthy();
    expect(callsTo('DELETE /projects/41')).toHaveLength(1);
  });

  it('hides edit and delete in the deal stage but still offers cancel before a contract', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({
        data: {
          data: detail({
            status: 'CONTRACTING',
            publicStatus: 'CLOSED',
            availableActions: ['CANCEL'],
          }),
        },
      }),
    });
    expect(await screen.findByText('계약 대기')).toBeTruthy();
    expect(screen.getByText(/계약 대기 중이라 수정·삭제·모집 마감은 할 수 없습니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();
    expect(screen.getByRole('button', { name: '프로젝트 취소' })).toBeTruthy();
  });

  it('locks every owner action once the work is in progress', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({
        data: {
          data: detail({ status: 'IN_PROGRESS', publicStatus: 'CLOSED', availableActions: [] }),
        },
      }),
    });
    expect(
      await screen.findByText(
        '계약이 체결된 프로젝트는 수정·삭제·취소할 수 없습니다. 정상 완료 또는 환불 절차를 거쳐야 합니다.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '프로젝트 취소' })).toBeNull();
  });
});

describe('my projects', () => {
  it('lists my projects with the internal status and pages through them', async () => {
    renderAt('/me/projects', client, {
      'GET /me/projects': ({ params }) => ({
        data: {
          data: [
            {
              ...detail({ id: params.page === 2 ? 52 : 51, title: `프로젝트 ${params.page}` }),
              status: params.page === 2 ? 'SCHEDULED' : 'CLOSED',
            },
          ],
          pagination: { page: params.page, pageSize: 10, totalCount: 11, totalPages: 2 },
        },
      }),
    });

    expect(await screen.findByRole('link', { name: '프로젝트 1' })).toBeTruthy();
    expect(screen.getByText('모집 마감')).toBeTruthy();
    expect(screen.getByText('1 / 2 페이지 (총 11개)')).toBeTruthy();
    click('다음');
    expect(await screen.findByRole('link', { name: '프로젝트 2' })).toBeTruthy();
    expect(screen.getByText('모집 예정')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');
  });

  it('is only for clients', async () => {
    renderAt('/me/projects', freelancer);
    expect(await screen.findByRole('heading', { name: '의뢰인 전용 화면입니다' })).toBeTruthy();
    expect(api.count('GET /me/projects')).toBe(0);
  });
});
