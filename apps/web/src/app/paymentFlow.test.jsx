import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { installMockApi, sessionResponse } from '../test/mockApi.js';
import * as paymentApi from '../lib/paymentApi.js';

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

const signedContract = {
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
  displayStatus: 'PAYMENT_PENDING',
  clientSignedAt: '2026-10-16T02:00:00.000Z',
  freelancerSignedAt: '2026-10-16T03:00:00.000Z',
  signedAt: '2026-10-16T03:00:00.000Z',
  isFullySigned: true,
  cancelledAt: null,
  createdAt: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-16T03:00:00.000Z',
  viewerRole: 'CLIENT',
  availableActions: ['PAY'],
  projectStatus: 'CONTRACTING',
  payment: null,
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
  vi.restoreAllMocks();
});

describe('payment UI (PAY-01)', () => {
  it('shows pay CTA on signed contract and starts Fake checkout', async () => {
    const spy = vi.spyOn(paymentApi, 'startFakeCheckout').mockImplementation(() => {});
    renderAt('/contracts/55/pay', client, {
      'GET /contracts/55': () => ({ data: { data: signedContract } }),
      'POST /contracts/55/payments': () => ({
        data: {
          data: {
            paymentId: 9,
            orderId: 'wb_test_1',
            orderName: '쇼핑몰 리뉴얼',
            amount: '3200000',
            currency: 'KRW',
            customerName: '김의뢰',
            contractId: 55,
            projectId: 41,
            pg: { mode: 'mock', usesBrowserSdk: false, clientKey: null },
            testNotice: 'Fake PG',
          },
        },
      }),
    });

    expect(await screen.findByRole('heading', { name: '테스트 결제' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '테스트 카드 결제하기' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].orderId).toBe('wb_test_1');
  });

  it('confirms payment from success callback query', async () => {
    renderAt('/payments/success?paymentKey=pk1&orderId=wb_1&amount=3200000', client, {
      'POST /payments/confirm': ({ body }) => {
        expect(body).toEqual({
          paymentKey: 'pk1',
          orderId: 'wb_1',
          amount: '3200000',
        });
        return {
          data: {
            data: {
              payment: {
                id: 1,
                contractId: 55,
                orderId: 'wb_1',
                amount: '3200000',
                status: 'PAID',
                escrowStatus: 'HELD',
                escrowNote: '테스트 결제 완료 / 에스크로 보관 시뮬레이션',
              },
              contractId: 55,
            },
          },
        };
      },
    });

    expect(await screen.findByRole('heading', { name: '테스트 결제 완료' })).toBeTruthy();
    expect(screen.getByText(/에스크로 보관 시뮬레이션/)).toBeTruthy();
  });
});
