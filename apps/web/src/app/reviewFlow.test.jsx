import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { installMockApi, sessionResponse } from '../test/mockApi.js';

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
  profileCompletion: { isComplete: true, missingFields: [] },
};

const freelancer = {
  ...client,
  id: 8,
  email: 'fl@workbridge.test',
  name: '박프리',
  role: 'FREELANCER',
  clientProfile: null,
  freelancerProfile: {
    mainCategory: 'WEB',
    careerYears: 3,
    hourlyRate: '50000',
    techStacks: [],
  },
};

const completedContract = {
  id: 55,
  projectId: 41,
  applicationId: 301,
  clientId: 7,
  freelancerId: 8,
  projectTitle: '쇼핑몰 리뉴얼',
  agreedAmount: '3200000',
  durationDays: 30,
  terms: '계약 본문',
  partiesSnapshot: {
    client: { name: '김의뢰', companyName: '워크브릿지' },
    freelancer: { name: '박프리' },
  },
  status: 'COMPLETED',
  displayStatus: 'COMPLETED',
  clientSignedAt: '2026-10-16T02:00:00.000Z',
  freelancerSignedAt: '2026-10-16T03:00:00.000Z',
  signedAt: '2026-10-16T03:00:00.000Z',
  workStartedAt: '2026-10-16T04:00:00.000Z',
  delivery: {
    note: '산출물',
    url: null,
    requestedAt: '2026-10-17T01:00:00.000Z',
  },
  completedAt: '2026-10-17T02:00:00.000Z',
  isFullySigned: true,
  cancelledAt: null,
  createdAt: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-17T02:00:00.000Z',
  viewerRole: 'CLIENT',
  availableActions: ['WRITE_REVIEW'],
  hasWrittenReview: false,
  projectStatus: 'COMPLETED',
  payment: {
    id: 9,
    status: 'PAID',
    escrowStatus: 'RELEASED',
    paidAt: '2026-10-16T04:00:00.000Z',
    amount: '3200000',
    feeAmount: '320000',
    payoutAmount: '2880000',
    releasedAt: '2026-10-17T02:00:00.000Z',
    escrowNote: '모의 지급 처리됨 (실제 송금 없음)',
  },
};

let mockApi;

function renderAt(path, user, handlers = {}) {
  useSessionStore.setState({ status: 'authenticated', user, accessToken: 'token' });
  mockApi = installMockApi({
    'GET /auth/me': () => sessionResponse(user),
    'POST /auth/refresh': () => sessionResponse(user),
    'GET /meta/options': () => ({
      data: {
        data: {
          projectCategories: [],
          businessFields: [],
          reviewTags: {
            forFreelancer: ['책임감', '소통', '기술력', '일정 준수', '품질'],
            forClient: ['명확한 요구사항', '신속한 피드백', '원활한 소통', '정확한 정산', '존중'],
          },
        },
      },
    }),
    ...handlers,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockApi?.restore();
  mockApi = undefined;
  useSessionStore.setState({ status: 'idle', user: null, accessToken: null });
});

describe('mutual review UI (REV)', () => {
  it('lets the client submit a review once and then hides the form', async () => {
    let contract = { ...completedContract };
    renderAt('/contracts/55', client, {
      'GET /contracts/55': () => ({ data: { data: contract } }),
      'GET /contracts/55/settlement': () => ({
        data: {
          data: {
            amount: '3200000',
            feeRate: 0.1,
            feeAmount: '320000',
            payoutAmount: '2880000',
            escrowStatus: 'RELEASED',
            paidAt: '2026-10-16T04:00:00.000Z',
            releasedAt: '2026-10-17T02:00:00.000Z',
          },
        },
      }),
      'GET /contracts/55/reviews': () => ({
        data: {
          data: {
            myReview: contract.hasWrittenReview
              ? {
                  id: 1,
                  contractId: 55,
                  projectId: 41,
                  projectTitle: '쇼핑몰 리뉴얼',
                  reviewerId: 7,
                  revieweeId: 8,
                  reviewerName: '김의뢰',
                  rating: 5,
                  content: '훌륭했습니다',
                  tags: ['책임감', '기술력'],
                  createdAt: '2026-10-18T01:00:00.000Z',
                }
              : null,
            counterpartReview: null,
          },
        },
      }),
      'POST /contracts/55/reviews': ({ body }) => {
        expect(body).toEqual({
          rating: 5,
          content: '훌륭했습니다',
          tags: ['책임감', '기술력'],
        });
        contract = {
          ...contract,
          availableActions: [],
          hasWrittenReview: true,
        };
        return {
          data: {
            data: {
              id: 1,
              contractId: 55,
              projectId: 41,
              projectTitle: '쇼핑몰 리뉴얼',
              reviewerId: 7,
              revieweeId: 8,
              reviewerName: '김의뢰',
              rating: body.rating,
              content: body.content,
              tags: body.tags,
              createdAt: '2026-10-18T01:00:00.000Z',
            },
          },
        };
      },
    });

    expect(
      await screen.findByRole('heading', { name: '리뷰 작성' }, { timeout: 15_000 }),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('5점'));
    fireEvent.change(screen.getByLabelText('리뷰 내용'), { target: { value: '훌륭했습니다' } });
    fireEvent.click(screen.getByRole('button', { name: '책임감' }));
    fireEvent.click(screen.getByRole('button', { name: '기술력' }));
    fireEvent.click(screen.getByRole('button', { name: '리뷰 제출하기' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '제출하기' }));

    await waitFor(() => expect(screen.getByText(/리뷰를 작성했습니다/)).toBeTruthy(), {
      timeout: 15_000,
    });
    expect(screen.queryByRole('heading', { name: '리뷰 작성' })).toBeNull();
    expect(screen.getByRole('heading', { name: '내가 작성한 리뷰' })).toBeTruthy();
    expect(screen.getByText('훌륭했습니다')).toBeTruthy();
    expect(screen.getAllByText(/수정할 수 없습니다/).length).toBeGreaterThan(0);
  }, 30_000);

  it('shows freelancer tags when writing a client review', async () => {
    renderAt('/contracts/55', freelancer, {
      'GET /contracts/55': () => ({
        data: {
          data: {
            ...completedContract,
            viewerRole: 'FREELANCER',
            availableActions: ['WRITE_REVIEW'],
          },
        },
      }),
      'GET /contracts/55/settlement': () => ({
        data: {
          data: {
            amount: '3200000',
            feeRate: 0.1,
            feeAmount: '320000',
            payoutAmount: '2880000',
            escrowStatus: 'RELEASED',
            paidAt: '2026-10-16T04:00:00.000Z',
            releasedAt: '2026-10-17T02:00:00.000Z',
          },
        },
      }),
      'GET /contracts/55/reviews': () => ({
        data: { data: { myReview: null, counterpartReview: null } },
      }),
    });

    expect(await screen.findByRole('heading', { name: '리뷰 작성' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '명확한 요구사항' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '신속한 피드백' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기술력' })).toBeNull();
  }, 30_000);
});
