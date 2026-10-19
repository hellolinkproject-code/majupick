import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const inProgressContract = {
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
  status: 'SIGNED',
  displayStatus: 'IN_PROGRESS',
  clientSignedAt: '2026-10-16T02:00:00.000Z',
  freelancerSignedAt: '2026-10-16T03:00:00.000Z',
  signedAt: '2026-10-16T03:00:00.000Z',
  workStartedAt: '2026-10-16T04:00:00.000Z',
  delivery: { note: null, url: null, requestedAt: null },
  completedAt: null,
  isFullySigned: true,
  cancelledAt: null,
  createdAt: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-16T04:00:00.000Z',
  viewerRole: 'FREELANCER',
  availableActions: ['REQUEST_DELIVERY'],
  projectStatus: 'IN_PROGRESS',
  payment: {
    id: 9,
    status: 'PAID',
    escrowStatus: 'HELD',
    paidAt: '2026-10-16T04:00:00.000Z',
    amount: '3200000',
    feeAmount: null,
    payoutAmount: null,
    releasedAt: null,
    escrowNote: '테스트 결제 완료 / 에스크로 보관 시뮬레이션',
  },
};

let mockApi;

function renderAt(path, user, handlers = {}) {
  useSessionStore.setState({ status: 'authenticated', user, accessToken: 'token' });
  mockApi = installMockApi({
    'GET /auth/me': () => sessionResponse(user),
    'POST /auth/refresh': () => sessionResponse(user),
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

describe('delivery and settlement UI (ESC)', () => {
  it('freelancer can request delivery once', async () => {
    renderAt('/contracts/55', freelancer, {
      'GET /contracts/55': () => ({ data: { data: inProgressContract } }),
      'GET /contracts/55/settlement': () => ({
        data: {
          data: {
            amount: '3200000',
            feeRate: 0.1,
            feeAmount: '320000',
            payoutAmount: '2880000',
            escrowStatus: 'HELD',
            paidAt: '2026-10-16T04:00:00.000Z',
            releasedAt: null,
          },
        },
      }),
      'POST /contracts/55/delivery': ({ body }) => {
        expect(body.note).toBe('산출물 전달');
        return {
          data: {
            data: {
              ...inProgressContract,
              status: 'DELIVERY_REQUESTED',
              displayStatus: 'DELIVERY_REQUESTED',
              availableActions: [],
              delivery: {
                note: body.note,
                url: null,
                requestedAt: '2026-10-17T01:00:00.000Z',
              },
            },
          },
        };
      },
    });

    expect(
      await screen.findByRole('heading', { name: '납품 요청' }, { timeout: 15_000 }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('납품 메모'), { target: { value: '산출물 전달' } });
    fireEvent.click(screen.getByRole('button', { name: '납품 요청하기' }));
    await waitFor(() => expect(screen.getByText(/납품을 요청했습니다/)).toBeTruthy(), {
      timeout: 15_000,
    });
  }, 30_000);

  it('client can approve and see mock settlement', async () => {
    const awaiting = {
      ...inProgressContract,
      status: 'DELIVERY_REQUESTED',
      displayStatus: 'DELIVERY_REQUESTED',
      viewerRole: 'CLIENT',
      availableActions: ['APPROVE'],
      delivery: {
        note: '산출물 전달',
        url: 'https://example.com/a',
        requestedAt: '2026-10-17T01:00:00.000Z',
      },
    };

    renderAt('/contracts/55', client, {
      'GET /contracts/55': () => ({ data: { data: awaiting } }),
      'GET /contracts/55/settlement': () => ({
        data: {
          data: {
            amount: '3200000',
            feeRate: 0.1,
            feeAmount: '320000',
            payoutAmount: '2880000',
            escrowStatus: 'HELD',
            paidAt: '2026-10-16T04:00:00.000Z',
            releasedAt: null,
          },
        },
      }),
      'POST /contracts/55/approve': () => ({
        data: {
          data: {
            contract: {
              ...awaiting,
              status: 'COMPLETED',
              displayStatus: 'COMPLETED',
              availableActions: [],
              completedAt: '2026-10-17T02:00:00.000Z',
              projectStatus: 'COMPLETED',
              payment: {
                ...awaiting.payment,
                escrowStatus: 'RELEASED',
                feeAmount: '320000',
                payoutAmount: '2880000',
                releasedAt: '2026-10-17T02:00:00.000Z',
                escrowNote: '모의 지급 처리됨 (실제 송금 없음)',
              },
            },
            settlement: {
              amount: '3200000',
              feeRate: 0.1,
              feeAmount: '320000',
              payoutAmount: '2880000',
              escrowStatus: 'RELEASED',
              paidAt: '2026-10-16T04:00:00.000Z',
              releasedAt: '2026-10-17T02:00:00.000Z',
            },
          },
        },
      }),
    });

    expect(
      await screen.findByRole('heading', { name: '완료 승인' }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: /정산 정보/ }, { timeout: 15_000 }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '완료 승인 및 모의 정산' }));
    await waitFor(() => expect(screen.getByText(/모의 정산/)).toBeTruthy(), { timeout: 15_000 });
  }, 30_000);
});
