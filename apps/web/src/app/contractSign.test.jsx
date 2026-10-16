import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { SIGNATURE_CONSENT_LABEL } from '../lib/applicationForm.js';
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

const pendingContract = {
  id: 55,
  projectId: 41,
  applicationId: 301,
  clientId: 7,
  freelancerId: 8,
  projectTitle: '쇼핑몰 리뉴얼',
  agreedAmount: '3200000',
  durationDays: 30,
  terms: '제1조 계약의 목적\n본 계약은 쇼핑몰 리뉴얼 업무에 관한 것이다.',
  partiesSnapshot: {
    client: { name: '김의뢰', companyName: '워크브릿지' },
    freelancer: { name: '박프리' },
  },
  status: 'SIGNATURE_PENDING',
  displayStatus: 'SIGNATURE_PENDING',
  clientSignedAt: null,
  freelancerSignedAt: null,
  signedAt: null,
  isFullySigned: false,
  cancelledAt: null,
  createdAt: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-16T01:00:00.000Z',
  viewerRole: 'CLIENT',
  availableActions: ['SIGN'],
};

let mockApi;

function renderAt(path, user, handlers = {}) {
  useSessionStore.setState({
    status: 'authenticated',
    user,
    accessToken: 'token',
  });
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
  return router;
}

afterEach(() => {
  cleanup();
  mockApi?.restore();
  mockApi = undefined;
  useSessionStore.setState({ status: 'idle', user: null, accessToken: null });
});

describe('contract signature UI (CTR-05)', () => {
  it('체크박스에 동의하기 전에는 전자서명 완료 버튼이 비활성이다', async () => {
    renderAt('/contracts/55', client, {
      'GET /contracts/55': () => ({ data: { data: pendingContract } }),
    });

    expect(await screen.findByRole('heading', { name: '계약서' })).toBeTruthy();
    expect(screen.getByText(SIGNATURE_CONSENT_LABEL)).toBeTruthy();
    const button = screen.getByRole('button', { name: '전자서명 완료' });
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
  });

  it('동의 후 서명하면 상대방 서명 대기로 바뀌고 버튼을 숨긴다', async () => {
    let signed = false;
    renderAt('/contracts/55', client, {
      'GET /contracts/55': () => ({
        data: {
          data: signed
            ? {
                ...pendingContract,
                clientSignedAt: '2026-10-16T02:00:00.000Z',
                displayStatus: 'WAITING_FREELANCER_SIGNATURE',
                availableActions: [],
              }
            : pendingContract,
        },
      }),
      'POST /contracts/55/sign': ({ body }) => {
        expect(body).toEqual({ agreed: true });
        signed = true;
        return {
          data: {
            data: {
              ...pendingContract,
              clientSignedAt: '2026-10-16T02:00:00.000Z',
              displayStatus: 'WAITING_FREELANCER_SIGNATURE',
              availableActions: [],
            },
          },
        };
      },
    });

    await screen.findByRole('button', { name: '전자서명 완료' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '전자서명 완료' }));

    await waitFor(() => {
      expect(screen.getByText(/상대방 서명을 기다리는 중/)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '전자서명 완료' })).toBeNull();
    expect(screen.getByText(/상대방 서명 대기/)).toBeTruthy();
  });

  it('양측 서명 완료 계약은 읽기 전용으로 체결 완료를 보여 준다', async () => {
    renderAt('/contracts/55', client, {
      'GET /contracts/55': () => ({
        data: {
          data: {
            ...pendingContract,
            status: 'SIGNED',
            displayStatus: 'PAYMENT_PENDING',
            clientSignedAt: '2026-10-16T02:00:00.000Z',
            freelancerSignedAt: '2026-10-16T03:00:00.000Z',
            signedAt: '2026-10-16T03:00:00.000Z',
            isFullySigned: true,
            availableActions: [],
          },
        },
      }),
    });

    expect(await screen.findByText('계약 체결 완료')).toBeTruthy();
    expect(screen.getByText(/아직 결제가 완료되지 않았으므로/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '전자서명 완료' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
