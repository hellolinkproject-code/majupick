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
const FLOW_TIMEOUT = 20_000;

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
const otherClient = { ...client, id: 9, name: '이의뢰' };
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

const detail = (overrides = {}) => ({
  id: 41,
  title: '쇼핑몰 리뉴얼',
  description: '반응형 쇼핑몰',
  category: 'WEB',
  budget: '3000000',
  recruitStartDate: null,
  recruitEndDate: addDays(14),
  publicStatus: 'RECRUITING',
  techStacks: [{ id: 1, name: 'React' }],
  applicantCount: 3,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  client: { id: 7, name: '김의뢰', profileImageUrl: null, companyName: '워크브릿지' },
  isOwner: false,
  ...overrides,
});
const ownerDetail = (overrides = {}) =>
  detail({
    isOwner: true,
    status: 'RECRUITING',
    availableActions: ['EDIT', 'DELETE'],
    lockedFields: ['budget', 'recruitEndDate'],
    ...overrides,
  });

const applicant = (id, name, overrides = {}) => ({
  id,
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
  freelancer: {
    id: 100 + id,
    name,
    role: 'FREELANCER',
    profileImageUrl: null,
    bio: null,
    profileComplete: true,
    clientProfile: null,
    freelancerProfile: {
      mainCategory: 'WEB',
      techStacks: [{ id: 1, name: 'React' }],
      careerYears: 4,
      portfolioUrl: null,
    },
  },
  coverLetter: `${name}의 자기소개`,
  proposedAmount: '2000000',
  proposedDurationDays: 30,
  status: 'PENDING',
  rejectReason: null,
  decidedAt: null,
  createdAt: '2026-10-14T01:00:00.000Z',
  updatedAt: '2026-10-14T01:00:00.000Z',
  availableActions: ['ACCEPT', 'REJECT'],
  ...overrides,
});

/** APP-02 응답. counts는 필터와 관계없이 프로젝트 전체 기준이다(없으면 items로 계산). */
function ownerList(items, projectCounts) {
  const counts = projectCounts ?? { total: items.length, PENDING: 0, ACCEPTED: 0, REJECTED: 0 };
  if (!projectCounts) for (const item of items) counts[item.status] += 1;
  return {
    data: {
      data: items,
      pagination: { page: 1, pageSize: 10, totalCount: items.length, totalPages: 1 },
      counts,
    },
  };
}

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
const panel = () => screen.getByRole('region', { name: '지원자 관리' });

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe('applicant management on the project detail (owner)', () => {
  it('lists applicants with counts, profile links, offers and cover letters', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: ownerDetail() } }),
      'GET /projects/41/applications': () =>
        ownerList([
          applicant(3, '최지원'),
          applicant(2, '정지원', { proposedAmount: '9007199254740993123' }),
          applicant(1, '한지원', {
            status: 'REJECTED',
            rejectReason: 'MANUAL',
            decidedAt: '2026-10-14T03:00:00.000Z',
            availableActions: [],
          }),
        ]),
    });
    expect(await screen.findByRole('heading', { name: '지원자 관리' })).toBeTruthy();
    expect(await screen.findByText('총 지원자 3명 · 검토 대기 2 · 선정 0 · 거절 1')).toBeTruthy();
    const list = within(panel()).getByRole('list', { name: '지원자 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: '최지원 공개 프로필 보기' }).getAttribute('href')).toBe(
      '/users/103',
    );
    expect(screen.getByText('9,007,199,254,740,993,123원')).toBeTruthy();
    expect(screen.getByText('최지원의 자기소개')).toBeTruthy();
    expect(screen.getByText('직접 거절')).toBeTruthy();
    expect(screen.getByText(/최종 계약 금액이 아닙니다/)).toBeTruthy();
    // 거절된 지원에는 버튼이 없다.
    expect(screen.queryByRole('button', { name: '한지원 선정' })).toBeNull();
    expect(screen.getByRole('button', { name: '최지원 선정' })).toBeTruthy();
    expect(callsTo('GET /projects/41/applications')[0].authorization).toBe('Bearer access-token');
  });

  it(
    'confirms, selects once and shows the auto-rejection result only after the server answers',
    async () => {
      let resolveAccept;
      let decided = false;
      renderAt('/projects/41', client, {
        'GET /projects/41': () => ({
          data: {
            data: ownerDetail(decided ? { status: 'CONTRACTING', availableActions: [] } : {}),
          },
        }),
        'GET /projects/41/applications': () =>
          ownerList(
            decided
              ? [
                  applicant(3, '최지원', {
                    status: 'REJECTED',
                    rejectReason: 'OTHER_ACCEPTED',
                    availableActions: [],
                  }),
                  applicant(2, '정지원', { status: 'ACCEPTED', availableActions: [] }),
                  applicant(1, '한지원', {
                    status: 'REJECTED',
                    rejectReason: 'OTHER_ACCEPTED',
                    availableActions: [],
                  }),
                ]
              : [applicant(3, '최지원'), applicant(2, '정지원'), applicant(1, '한지원')],
          ),
        'POST /applications/2/accept': () =>
          new Promise((resolve) => {
            resolveAccept = () => {
              decided = true;
              resolve({
                data: {
                  data: {
                    application: applicant(2, '정지원', { status: 'ACCEPTED' }),
                    autoRejectedCount: 2,
                  },
                },
              });
            };
          }),
      });

      fireEvent.click(await screen.findByRole('button', { name: '정지원 선정' }));
      const dialog = screen.getByRole('alertdialog', { name: '정지원님을 선정할까요?' });
      expect(
        within(dialog).getByText('이 지원자를 선정하면 다른 대기 지원은 자동으로 거절됩니다.'),
      ).toBeTruthy();
      expect(within(dialog).getByText(/지금 다른 대기 지원 2건/)).toBeTruthy();
      expect(callsTo('POST /applications/2/accept')).toHaveLength(0);

      fireEvent.click(within(dialog).getByRole('button', { name: '선정 확정' }));
      const busy = within(dialog).getByRole('button', { name: '선정하는 중…' });
      fireEvent.click(busy);
      expect(busy.hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('button', { name: '최지원 선정' }).hasAttribute('disabled')).toBe(
        true,
      );
      await waitFor(() => expect(callsTo('POST /applications/2/accept')).toHaveLength(1));
      expect(callsTo('POST /applications/2/accept')[0].body).toBeUndefined();
      expect(screen.queryByText(/님을 선정했습니다/)).toBeNull();

      resolveAccept();
      expect(
        await screen.findByText(
          '정지원님을 선정했습니다. 다른 대기 지원 2건은 자동으로 거절되었습니다.',
        ),
      ).toBeTruthy();
      expect(
        await screen.findByText(
          '지원자 선정이 끝났습니다. 계약 체결과 결제는 별도 단계에서 진행합니다.',
        ),
      ).toBeTruthy();
      expect(screen.getAllByText('자동 거절 · 다른 지원자 선정')).toHaveLength(2);
      expect(screen.getByText('선정됨', { selector: '.status-badge' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /선정$/ })).toBeNull();
      expect(callsTo('POST /applications/2/accept')).toHaveLength(1);
      await waitFor(() => expect(screen.getByText('계약 대기')).toBeTruthy());
    },
    FLOW_TIMEOUT,
  );

  it('keeps the selection after a reload because it comes from the server', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({
        data: { data: ownerDetail({ status: 'CONTRACTING', availableActions: [] }) },
      }),
      'GET /projects/41/applications': () =>
        ownerList([
          applicant(2, '정지원', { status: 'ACCEPTED', availableActions: [] }),
          applicant(1, '한지원', {
            status: 'REJECTED',
            rejectReason: 'OTHER_ACCEPTED',
            availableActions: [],
          }),
        ]),
    });
    expect(
      await screen.findByText(
        '지원자 선정이 끝났습니다. 계약 체결과 결제는 별도 단계에서 진행합니다.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('총 지원자 2명 · 검토 대기 0 · 선정 1 · 거절 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /선정$|거절$/ })).toBeNull();
  });

  it('rejects one applicant after confirming and leaves the others pending', async () => {
    let rejected = false;
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: ownerDetail() } }),
      'GET /projects/41/applications': () =>
        ownerList([
          applicant(2, '정지원'),
          applicant(
            1,
            '한지원',
            rejected ? { status: 'REJECTED', rejectReason: 'MANUAL', availableActions: [] } : {},
          ),
        ]),
      'POST /applications/1/reject': () => {
        rejected = true;
        return {
          data: { data: applicant(1, '한지원', { status: 'REJECTED', rejectReason: 'MANUAL' }) },
        };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: '한지원 거절' }));
    const dialog = screen.getByRole('alertdialog', { name: '한지원님의 지원을 거절할까요?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(callsTo('POST /applications/1/reject')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '한지원 거절' }));
    fireEvent.click(screen.getByRole('button', { name: '거절 확정' }));
    expect(await screen.findByText('한지원님의 지원을 거절했습니다.')).toBeTruthy();
    expect(await screen.findByText('직접 거절')).toBeTruthy();
    expect(screen.getByRole('button', { name: '정지원 선정' })).toBeTruthy();
  });

  it('shows the server error and reloads when the selection is refused', async () => {
    let raced = false;
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({
        data: {
          data: ownerDetail(raced ? { status: 'CONTRACTING', availableActions: [] } : {}),
        },
      }),
      'GET /projects/41/applications': () =>
        ownerList(
          raced
            ? [
                applicant(2, '정지원', {
                  status: 'REJECTED',
                  rejectReason: 'OTHER_ACCEPTED',
                  availableActions: [],
                }),
                applicant(1, '한지원', { status: 'ACCEPTED', availableActions: [] }),
              ]
            : [applicant(2, '정지원'), applicant(1, '한지원')],
        ),
      'POST /applications/2/accept': () => {
        raced = true;
        return apiError(
          409,
          'INVALID_STATE_TRANSITION',
          '이미 지원자를 선정한 프로젝트입니다. 더 이상 선정할 수 없습니다.',
          { projectStatus: 'CONTRACTING' },
        );
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: '정지원 선정' }));
    fireEvent.click(screen.getByRole('button', { name: '선정 확정' }));
    expect(
      await screen.findByText('이미 지원자를 선정한 프로젝트입니다. 더 이상 선정할 수 없습니다.'),
    ).toBeTruthy();
    expect(screen.queryByText(/님을 선정했습니다/)).toBeNull();
    expect(
      await screen.findByText(
        '지원자 선정이 끝났습니다. 계약 체결과 결제는 별도 단계에서 진행합니다.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('자동 거절 · 다른 지원자 선정')).toBeTruthy();
  });

  it('filters by status and explains a closed project without action buttons', async () => {
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: ownerDetail({ status: 'CLOSED' }) } }),
      'GET /projects/41/applications': ({ params }) =>
        ownerList(
          params.status === 'REJECTED' ? [] : [applicant(2, '정지원', { availableActions: [] })],
          { total: 1, PENDING: 1, ACCEPTED: 0, REJECTED: 0 },
        ),
    });
    expect(
      await screen.findByText('모집 기간이 끝나 지원자를 선정하거나 거절할 수 없습니다.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '정지원 선정' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^거절됨/ }));
    expect(await screen.findByText('이 상태의 지원이 없습니다.')).toBeTruthy();
    expect(callsTo('GET /projects/41/applications').at(-1).params).toEqual({
      page: 1,
      status: 'REJECTED',
    });
  });

  it('shows loading, empty and error states', async () => {
    let fail = true;
    renderAt('/projects/41', client, {
      'GET /projects/41': () => ({ data: { data: ownerDetail({ applicantCount: 0 }) } }),
      'GET /projects/41/applications': () =>
        fail ? apiError(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다.') : ownerList([]),
    });
    expect(await screen.findByText(/서버 오류가 발생했습니다\./)).toBeTruthy();
    fail = false;
    fireEvent.click(within(panel()).getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('아직 지원자가 없습니다.')).toBeTruthy();
  });
});

describe('who sees the applicant management', () => {
  it('is not shown to other clients, freelancers or guests and is not requested', async () => {
    for (const user of [otherClient, freelancer, null]) {
      renderAt('/projects/41', user, {
        'GET /projects/41': () => ({ data: { data: detail({ myApplication: null }) } }),
      });
      await screen.findByRole('heading', { level: 1, name: '쇼핑몰 리뉴얼' });
      expect(screen.queryByRole('heading', { name: '지원자 관리' })).toBeNull();
      expect(callsTo('GET /projects/41/applications')).toHaveLength(0);
      cleanup();
      api.restore();
      useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
    }
  });

  it('links each of my projects to its applicant management', async () => {
    renderAt('/me/projects', client, {
      'GET /me/projects': () => ({
        data: {
          data: [ownerDetail({ applicantCount: 3 })],
          pagination: { page: 1, pageSize: 10, totalCount: 1, totalPages: 1 },
        },
      }),
    });
    const link = await screen.findByRole('link', { name: '쇼핑몰 리뉴얼 지원자 3명 관리' });
    expect(link.getAttribute('href')).toBe('/projects/41#applicants');
  });
});
