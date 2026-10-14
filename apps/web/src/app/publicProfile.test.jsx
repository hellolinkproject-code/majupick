import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { apiError, installMockApi, sessionResponse } from '../test/mockApi.js';

const OPTIONS = {
  projectCategories: [
    { value: 'WEB', label: '웹' },
    { value: 'DESIGN', label: '디자인' },
  ],
  businessFields: [
    { value: 'COMMERCE', label: '커머스' },
    { value: 'ETC', label: '기타' },
  ],
};
const IMAGE = `/api/uploads/profile-images/${'a'.repeat(32)}.webp`;

const clientProfile = {
  id: 11,
  name: '김의뢰',
  role: 'CLIENT',
  profileImageUrl: IMAGE,
  bio: '의뢰인 소개입니다.',
  profileComplete: true,
  clientProfile: {
    companyName: '브리지 주식회사',
    businessField: 'ETC',
    businessFieldEtc: '교육',
    websiteUrl: 'https://client.example.com',
  },
  freelancerProfile: null,
};
const freelancerProfile = {
  id: 12,
  name: '박프리',
  role: 'FREELANCER',
  profileImageUrl: null,
  bio: '긴소개'.repeat(80),
  profileComplete: true,
  clientProfile: null,
  freelancerProfile: {
    mainCategory: 'WEB',
    techStacks: [
      { id: 1, name: 'Node.js' },
      { id: 2, name: 'React' },
    ],
    careerYears: 5,
    portfolioUrl: 'https://portfolio.example.com/very/long/path',
  },
};

let api;
let router;

function renderAt(path, handlers = {}, user = null) {
  api = installMockApi({
    'POST /auth/refresh': () => (user ? sessionResponse(user) : apiError(401, 'UNAUTHORIZED')),
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

const calledEditApi = () =>
  api.calls.some((call) => /^(PATCH|PUT|POST|DELETE) \/(users|uploads)/.test(call.key));

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
  vi.restoreAllMocks();
});

describe('public profile page (PROF-05)', () => {
  it('shows a client profile to anonymous visitors with company info and a safe website link', async () => {
    renderAt('/users/11', { 'GET /users/11': () => ({ data: { data: clientProfile } }) });

    expect(await screen.findByRole('heading', { level: 1, name: '브리지 주식회사' })).toBeTruthy();
    expect(screen.getByText('의뢰인 · 담당자 김의뢰')).toBeTruthy();
    expect(screen.getByText('기타 (교육)')).toBeTruthy();
    expect(screen.getByText('의뢰인 소개입니다.')).toBeTruthy();
    const image = screen.getByRole('img', { name: '김의뢰 프로필 이미지' });
    expect(image.getAttribute('src')).toBe(IMAGE);

    const website = screen.getByRole('link', { name: '회사 웹사이트(새 창)' });
    expect(website.getAttribute('href')).toBe('https://client.example.com');
    expect(website.getAttribute('target')).toBe('_blank');
    expect(website.getAttribute('rel')).toBe('noopener noreferrer nofollow');

    expect(screen.queryByText(/기술 스택/)).toBeNull();
    expect(screen.queryByText('내 프로필 수정하기')).toBeNull();
    expect(calledEditApi()).toBe(false);
  });

  it('shows a freelancer profile with category, career, tech stacks and portfolio', async () => {
    renderAt('/users/12', { 'GET /users/12': () => ({ data: { data: freelancerProfile } }) });

    expect(await screen.findByRole('heading', { level: 1, name: '박프리' })).toBeTruthy();
    expect(screen.getByText('프리랜서 · 웹')).toBeTruthy();
    expect(screen.getByText('5년')).toBeTruthy();
    const stacks = screen.getByRole('list', { name: '기술 스택' });
    expect(
      within(stacks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Node.js', 'React']);
    const portfolio = screen.getByRole('link', { name: '포트폴리오(새 창)' });
    expect(portfolio.getAttribute('href')).toBe('https://portfolio.example.com/very/long/path');
    expect(portfolio.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('img', { name: '기본 프로필 이미지' }).textContent).toBe('박');
    expect(screen.queryByText(/단가/)).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('falls back to the default image when the stored image cannot be loaded', async () => {
    renderAt('/users/11', { 'GET /users/11': () => ({ data: { data: clientProfile } }) });

    fireEvent.error(await screen.findByRole('img', { name: '김의뢰 프로필 이미지' }));
    expect(screen.getByRole('img', { name: '기본 프로필 이미지' }).textContent).toBe('김');
  });

  it('shows an incomplete profile with a notice and empty values', async () => {
    renderAt('/users/13', {
      'GET /users/13': () => ({
        data: {
          data: {
            ...freelancerProfile,
            id: 13,
            bio: null,
            profileComplete: false,
            freelancerProfile: null,
          },
        },
      }),
    });

    expect(await screen.findByText(/아직 프로필을 작성 중인 사용자입니다/)).toBeTruthy();
    expect(screen.getByText('프리랜서', { selector: '.public-profile__subtitle' })).toBeTruthy();
    expect(screen.getAllByText('등록되지 않음')).toHaveLength(3);
    expect(screen.getByText('등록된 기술 스택이 없습니다.')).toBeTruthy();
    expect(screen.getByText('등록된 소개가 없습니다.')).toBeTruthy();
  });

  it('does not render a non-http link stored in a profile', async () => {
    renderAt('/users/11', {
      'GET /users/11': () => ({
        data: {
          data: {
            ...clientProfile,
            clientProfile: { ...clientProfile.clientProfile, websiteUrl: 'javascript:alert(1)' },
          },
        },
      }),
    });

    await screen.findByRole('heading', { level: 1, name: '브리지 주식회사' });
    expect(screen.queryByRole('link', { name: /회사 웹사이트/ })).toBeNull();
  });

  it('shows not-found for unknown users and malformed IDs without calling the API', async () => {
    renderAt('/users/999', { 'GET /users/999': () => apiError(404, 'NOT_FOUND', '없음') });
    expect(await screen.findByRole('heading', { name: '사용자를 찾을 수 없습니다' })).toBeTruthy();
    cleanup();
    api.restore();

    renderAt('/users/abc');
    expect(await screen.findByRole('heading', { name: '사용자를 찾을 수 없습니다' })).toBeTruthy();
    expect(api.calls.some((call) => call.key.startsWith('GET /users/'))).toBe(false);
  });

  it('retries after a server error', async () => {
    let fail = true;
    renderAt('/users/12', {
      'GET /users/12': () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', '잠시 후 다시 시도해 주세요.')
          : { data: { data: freelancerProfile } },
    });

    // 화면 자체 정책대로 404가 아닌 오류는 한 번 더 시도한 뒤 안내한다.
    expect(
      await screen.findByRole(
        'heading',
        { name: '프로필을 불러오지 못했습니다' },
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(api.count('GET /users/12')).toBe(2);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { level: 1, name: '박프리' })).toBeTruthy();
  });

  it('offers the owner a link to edit on /me instead of editing in place', async () => {
    const me = {
      id: 12,
      email: 'me@workbridge.test',
      name: '박프리',
      role: 'FREELANCER',
      profileImageUrl: null,
      bio: null,
      hasPassword: true,
      socialProviders: [],
      clientProfile: null,
      freelancerProfile: null,
      profileCompletion: { isComplete: true, missingFields: [] },
    };
    renderAt(
      '/users/12',
      {
        'GET /auth/me': () => ({ data: { data: me } }),
        'GET /users/12': () => ({ data: { data: freelancerProfile } }),
      },
      me,
    );

    const edit = await screen.findByRole('link', { name: '내 프로필 수정하기' });
    expect(edit.getAttribute('href')).toBe('/me');
    expect(screen.queryByRole('button', { name: /저장|삭제/ })).toBeNull();
    expect(screen.queryByLabelText(/프로필 이미지/, { selector: 'input' })).toBeNull();
    expect(calledEditApi()).toBe(false);
  });

  it('stacks the header and wraps long text on narrow screens', () => {
    const styles = readFileSync(path.resolve('src/styles.css'), 'utf8');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(/\.public-profile__header\s*\{[^}]*flex-direction:\s*column/);
    expect(styles).toMatch(/\.public-profile__name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.profile-summary dd\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe('my profile → public profile', () => {
  it('links to the read-only public view of my own profile', async () => {
    const me = {
      id: 11,
      email: 'client@workbridge.test',
      name: '김의뢰',
      role: 'CLIENT',
      profileImageUrl: null,
      bio: null,
      hasPassword: true,
      socialProviders: [],
      clientProfile: null,
      freelancerProfile: null,
      profileCompletion: { isComplete: false, missingFields: ['companyName', 'businessField'] },
    };
    renderAt(
      '/me',
      {
        'GET /auth/me': () => ({ data: { data: me } }),
        'GET /users/11': () => ({ data: { data: clientProfile } }),
      },
      me,
    );

    fireEvent.click(await screen.findByRole('link', { name: '공개 프로필 보기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '브리지 주식회사' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/users/11');
  });
});

describe('project detail → client public profile', () => {
  it('links the client name to the public profile', async () => {
    renderAt('/projects/5', {
      'GET /projects/5': () => ({
        data: {
          data: {
            id: 5,
            title: '쇼핑몰 리뉴얼',
            description: '설명',
            category: 'WEB',
            status: 'RECRUITING',
            publicStatus: 'RECRUITING',
            recruitStartDate: '2026-10-01',
            recruitEndDate: '2026-10-30',
            budget: '1000000',
            applicantCount: 0,
            techStacks: [],
            client: {
              id: 11,
              name: '김의뢰',
              profileImageUrl: null,
              companyName: '브리지 주식회사',
            },
            isOwner: false,
          },
        },
      }),
      'GET /users/11': () => ({ data: { data: clientProfile } }),
    });

    fireEvent.click(
      await screen.findByRole('link', { name: '브리지 주식회사 의뢰인 프로필 보기' }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: '브리지 주식회사' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/users/11');
  });
});
