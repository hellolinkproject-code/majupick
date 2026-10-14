import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const BIG_AMOUNT = '9007199254740993123';
const FLOW_TIMEOUT = 20_000;

const complete = { isComplete: true, missingFields: [] };
const freelancer = {
  id: 8,
  email: 'freelancer@workbridge.test',
  name: '박프리',
  role: 'FREELANCER',
  profileImageUrl: null,
  bio: null,
  hasPassword: true,
  socialProviders: [],
  clientProfile: null,
  freelancerProfile: {
    mainCategory: 'WEB',
    careerYears: 3,
    hourlyRate: '50000',
    portfolioUrl: null,
    techStacks: [{ id: 1, name: 'React' }],
  },
  profileCompletion: complete,
};
const incompleteFreelancer = {
  ...freelancer,
  freelancerProfile: null,
  profileCompletion: {
    isComplete: false,
    missingFields: ['mainCategory', 'techStacks', 'careerYears', 'hourlyRate'],
  },
};
const client = {
  ...freelancer,
  id: 7,
  name: '김의뢰',
  role: 'CLIENT',
  freelancerProfile: null,
  clientProfile: { companyName: '워크브릿지', businessField: 'IT', businessFieldEtc: null },
};

/** 비소유자에게 오는 공개 상세(PRJ-02). 프리랜서에게는 myApplication이 함께 온다. */
const publicDetail = (overrides = {}) => ({
  id: 41,
  title: '쇼핑몰 리뉴얼',
  description: '반응형 쇼핑몰',
  category: 'WEB',
  budget: '3000000',
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 0,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
  isOwner: false,
  ...overrides,
});

const application = (overrides = {}) => ({
  id: 301,
  projectId: 41,
  project: {
    id: 41,
    title: '쇼핑몰 리뉴얼',
    category: 'WEB',
    budget: '3000000',
    recruitStartDate: null,
    recruitEndDate: addDays(14),
    publicStatus: 'RECRUITING',
    isDeleted: false,
  },
  coverLetter: 'React 경험 5년',
  proposedAmount: BIG_AMOUNT,
  proposedDurationDays: 30,
  status: 'PENDING',
  rejectReason: null,
  decidedAt: null,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  ...overrides,
});

const listResponse = (items, page = 1) => ({
  data: {
    data: items,
    pagination: {
      page,
      pageSize: 10,
      totalCount: items.length,
      totalPages: items.length ? 1 : 0,
    },
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

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
const callsTo = (key) => api.calls.filter((call) => call.key === key);

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
  vi.restoreAllMocks();
});

async function openForm() {
  await screen.findByRole('heading', { name: '프로젝트 지원' });
  click('지원하기');
  await screen.findByRole('form', { name: '지원서 작성' });
}

function fillForm() {
  type(/^자기소개/, '  React와 Node.js로 쇼핑몰 3건을 만들었습니다.  ');
  type(/^예상 단가/, BIG_AMOUNT);
  type(/^예상 기간/, '30');
}

describe('applying from the project detail page', () => {
  it(
    'validates, confirms, submits once and shows success only after the server answers',
    async () => {
      let resolveApply;
      let applied = false;
      renderAt('/projects/41', freelancer, {
        'GET /projects/41': () => ({
          data: {
            data: publicDetail(
              applied
                ? {
                    applicantCount: 1,
                    myApplication: {
                      id: 301,
                      status: 'PENDING',
                      rejectReason: null,
                      createdAt: '2026-10-14T01:00:00.000Z',
                    },
                  }
                : { myApplication: null },
            ),
          },
        }),
        'POST /projects/41/applications': () =>
          new Promise((resolve) => {
            resolveApply = () => {
              applied = true;
              resolve({ status: 201, data: { data: application() } });
            };
          }),
        'GET /me/applications': () => listResponse(applied ? [application()] : []),
      });

      await openForm();
      click('다음');
      expect(await screen.findByText('자기소개를 입력해 주세요.')).toBeTruthy();
      expect(screen.getByText('예상 단가는 1원 이상의 정수로 입력해 주세요.')).toBeTruthy();
      expect(screen.getByText('예상 기간은 1~3,650일 사이의 정수로 입력해 주세요.')).toBeTruthy();

      fillForm();
      expect(screen.getByText('= 9,007,199,254,740,993,123원')).toBeTruthy();
      click('다음');
      expect(await screen.findByText(/이 내용으로 지원할까요\?/)).toBeTruthy();
      expect(screen.getByText('9,007,199,254,740,993,123원')).toBeTruthy();
      expect(screen.getByText('30일')).toBeTruthy();

      click('지원 확정');
      fireEvent.click(screen.getByRole('button', { name: '지원하는 중…' }));
      expect(screen.getByRole('button', { name: '지원하는 중…' }).hasAttribute('disabled')).toBe(
        true,
      );
      await waitFor(() => expect(callsTo('POST /projects/41/applications')).toHaveLength(1));
      expect(callsTo('POST /projects/41/applications')[0].body).toEqual({
        coverLetter: 'React와 Node.js로 쇼핑몰 3건을 만들었습니다.',
        proposedAmount: BIG_AMOUNT,
        proposedDurationDays: 30,
      });
      expect(screen.queryByText(/에 지원했습니다\./)).toBeNull();
      expect(router.state.location.pathname).toBe('/projects/41');

      resolveApply();
      await waitFor(() => expect(router.state.location.pathname).toBe('/me/applications'));
      expect(await screen.findByText('"쇼핑몰 리뉴얼"에 지원했습니다.')).toBeTruthy();
      expect(await screen.findByRole('link', { name: '쇼핑몰 리뉴얼' })).toBeTruthy();
      expect(callsTo('POST /projects/41/applications')).toHaveLength(1);
    },
    FLOW_TIMEOUT,
  );

  it('shows the applied state from the server instead of the form', async () => {
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({
        data: {
          data: publicDetail({
            applicantCount: 3,
            myApplication: {
              id: 301,
              status: 'PENDING',
              rejectReason: null,
              createdAt: '2026-10-14T01:00:00.000Z',
            },
          }),
        },
      }),
    });
    expect(await screen.findByText('이 프로젝트에 지원했습니다.')).toBeTruthy();
    expect(screen.getByText(/지원 상태: 검토중/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '내 지원 현황 보기' }).getAttribute('href')).toBe(
      '/me/applications',
    );
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
    expect(screen.getByText('3명')).toBeTruthy();
  });

  it('waits for the session on reload so the applied state is not lost', async () => {
    renderAt('/projects/41', freelancer, {
      'POST /auth/refresh': () =>
        new Promise((resolve) => setTimeout(() => resolve(sessionResponse(freelancer)), 50)),
      'GET /projects/41': ({ authorization }) => ({
        data: {
          data: publicDetail(
            authorization
              ? {
                  applicantCount: 1,
                  myApplication: {
                    id: 301,
                    status: 'PENDING',
                    rejectReason: null,
                    createdAt: '2026-10-14T01:00:00.000Z',
                  },
                }
              : { applicantCount: 1 },
          ),
        },
      }),
    });
    expect(await screen.findByText('이 프로젝트에 지원했습니다.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
    const detailCalls = callsTo('GET /projects/41');
    expect(detailCalls.length).toBeGreaterThan(0);
    expect(detailCalls.every((call) => call.authorization === 'Bearer access-token')).toBe(true);
  });

  it('explains closed and scheduled projects without a form', async () => {
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({
        data: { data: publicDetail({ publicStatus: 'CLOSED', myApplication: null }) },
      }),
    });
    expect(await screen.findByText('모집이 마감되어 지원할 수 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
    cleanup();
    api.restore();

    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({
        data: {
          data: publicDetail({
            publicStatus: 'SCHEDULED',
            recruitStartDate: '2030-01-05',
            myApplication: null,
          }),
        },
      }),
    });
    expect(
      await screen.findByText('모집 시작 전입니다. 2030. 1. 5.부터 지원할 수 있습니다.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
  });

  it('does not offer applying to clients', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: publicDetail() } }),
    });
    await screen.findByRole('heading', { level: 1, name: '쇼핑몰 리뉴얼' });
    await screen.findByRole('link', { name: '내 프로젝트' });
    expect(screen.queryByRole('heading', { name: '프로젝트 지원' })).toBeNull();
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
    expect(screen.queryByRole('link', { name: '내 지원 현황' })).toBeNull();
  });

  it('sends guests to login and back to this project', async () => {
    renderAt('/projects/41', null, {
      'GET /projects/41': () => ({ data: { data: publicDetail() } }),
    });
    const link = await screen.findByRole('link', { name: '로그인하고 지원하기' });
    expect(link.getAttribute('href')).toBe('/login?returnTo=%2Fprojects%2F41');
  });

  it('sends incomplete freelancers to the profile with a way back', async () => {
    renderAt('/projects/41', incompleteFreelancer, {
      'GET /projects/41': () => ({ data: { data: publicDetail({ myApplication: null }) } }),
    });
    expect(await screen.findByText('지원하려면 프로필을 먼저 완성해 주세요.')).toBeTruthy();
    expect(screen.getByText(/남은 필수 항목:/).textContent).toContain('경력');
    expect(screen.getByRole('link', { name: '프로필 완성하러 가기' }).getAttribute('href')).toBe(
      '/me?returnTo=%2Fprojects%2F41',
    );
    expect(screen.queryByRole('button', { name: '지원하기' })).toBeNull();
  });

  it('refreshes the project when the server says it was already applied', async () => {
    let applied = false;
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({
        data: {
          data: publicDetail({
            myApplication: applied
              ? {
                  id: 301,
                  status: 'PENDING',
                  rejectReason: null,
                  createdAt: '2026-10-14T01:00:00Z',
                }
              : null,
          }),
        },
      }),
      'POST /projects/41/applications': () => {
        applied = true;
        return apiError(409, 'ALREADY_APPLIED', '이미 지원한 프로젝트입니다.', {
          applicationId: 301,
        });
      },
    });
    await openForm();
    fillForm();
    click('다음');
    click('지원 확정');
    expect(await screen.findByText('이 프로젝트에 지원했습니다.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/41');
    expect(api.count('GET /projects/41')).toBeGreaterThanOrEqual(2);
  });

  it('shows the closed notice when recruiting ended before the submit', async () => {
    let closed = false;
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({
        data: {
          data: publicDetail({
            publicStatus: closed ? 'CLOSED' : 'RECRUITING',
            myApplication: null,
          }),
        },
      }),
      'POST /projects/41/applications': () => {
        closed = true;
        return apiError(409, 'INVALID_STATE_TRANSITION', '모집이 마감된 프로젝트입니다.', {
          currentStatus: 'CLOSED',
        });
      },
    });
    await openForm();
    fillForm();
    click('다음');
    click('지원 확정');
    expect(await screen.findByText('모집이 마감된 프로젝트입니다.')).toBeTruthy();
    expect(await screen.findByText('모집이 마감되어 지원할 수 없습니다.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/41');
  });

  it('returns to the form with server field errors and handles PROFILE_INCOMPLETE', async () => {
    let attempt = 0;
    renderAt('/projects/41', freelancer, {
      'GET /projects/41': () => ({ data: { data: publicDetail({ myApplication: null }) } }),
      'POST /projects/41/applications': () => {
        attempt += 1;
        if (attempt === 1) {
          return apiError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
            fields: { proposedAmount: '저장할 수 있는 최대 금액을 넘었습니다.' },
          });
        }
        return apiError(403, 'PROFILE_INCOMPLETE', '프로필을 먼저 완성해 주세요.', {
          missingFields: ['hourlyRate'],
        });
      },
    });
    await openForm();
    fillForm();
    click('다음');
    click('지원 확정');
    expect(await screen.findByText('저장할 수 있는 최대 금액을 넘었습니다.')).toBeTruthy();
    expect(screen.getByRole('form', { name: '지원서 작성' })).toBeTruthy();

    click('다음');
    click('지원 확정');
    expect(await screen.findByText('지원하려면 프로필을 먼저 완성해 주세요.')).toBeTruthy();
  });
});

describe('my applications page', () => {
  it('lists applications with both statuses, my offer and deleted projects', async () => {
    renderAt('/me/applications', freelancer, {
      'GET /me/applications': () =>
        listResponse([
          application(),
          application({
            id: 300,
            status: 'REJECTED',
            rejectReason: 'PROJECT_DELETED',
            project: {
              ...application().project,
              id: 40,
              title: '삭제된 일',
              isDeleted: true,
              publicStatus: 'CLOSED',
            },
          }),
        ]),
    });
    expect(await screen.findByRole('heading', { name: '내 지원 현황' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: '쇼핑몰 리뉴얼' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '쇼핑몰 리뉴얼' }).getAttribute('href')).toBe(
      '/projects/41',
    );
    expect(screen.getByText('검토중')).toBeTruthy();
    expect(screen.getByText('모집 중')).toBeTruthy();
    expect(screen.getByText('거절')).toBeTruthy();
    expect(screen.getByText('프로젝트가 삭제되었습니다.')).toBeTruthy();
    expect(screen.getByText('삭제된 프로젝트')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /삭제된 일/ })).toBeNull();
    expect(screen.getAllByText(/내 제안 9,007,199,254,740,993,123원 · 30일/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: '내 지원 현황' })).toBeTruthy();
  });

  it('shows the empty state with a link to project search', async () => {
    renderAt('/me/applications', freelancer, {
      'GET /me/applications': () => listResponse([]),
    });
    expect(await screen.findByText('아직 지원한 프로젝트가 없습니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '프로젝트 찾아보기' }).getAttribute('href')).toBe(
      '/projects',
    );
  });

  it('shows an error with retry', async () => {
    let fail = true;
    renderAt('/me/applications', freelancer, {
      'GET /me/applications': () =>
        fail ? apiError(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다.') : listResponse([]),
    });
    expect(await screen.findByText(/서버 오류가 발생했습니다\./)).toBeTruthy();
    fail = false;
    click('다시 시도');
    expect(await screen.findByText('아직 지원한 프로젝트가 없습니다.')).toBeTruthy();
  });

  it('is only for freelancers and requires login', async () => {
    renderAt('/me/applications', client);
    expect(await screen.findByRole('heading', { name: '프리랜서 전용 화면입니다' })).toBeTruthy();
    expect(api.count('GET /me/applications')).toBe(0);
    cleanup();
    api.restore();
    useSessionStore.setState({ status: 'idle', accessToken: null, user: null });

    renderAt('/me/applications', null);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?returnTo=%2Fme%2Fapplications');
  });
});

describe('owner edit form while applications exist (D-06)', () => {
  it('disables budget and deadline with the applicant hint', async () => {
    const owned = publicDetail({
      isOwner: true,
      status: 'RECRUITING',
      availableActions: ['EDIT', 'DELETE'],
      lockedFields: ['budget', 'recruitEndDate'],
      applicantCount: 2,
    });
    renderAt('/projects/41/edit', client, {
      'GET /projects/41': () => ({ data: { data: owned } }),
      'GET /tech-stacks': () => ({ data: { data: [] } }),
    });
    const budget = await screen.findByLabelText(/^예산/);
    expect(budget.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText(/^모집 마감일/).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText(/^모집 시작일/).hasAttribute('disabled')).toBe(false);
    expect(screen.getAllByText(/지원자가 있어 바꿀 수 없습니다\./)).toHaveLength(2);
  });
});
