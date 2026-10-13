import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const STACKS = [
  { id: 1, name: 'React', isCustom: false },
  { id: 2, name: 'Node.js', isCustom: false },
  { id: 3, name: 'Figma', isCustom: false },
];
const BIG_RATE = '9007199254740993123';

const base = {
  id: 7,
  email: 'me@workbridge.test',
  name: '김사용',
  profileImageUrl: null,
  bio: null,
  hasPassword: true,
  socialProviders: [],
  clientProfile: null,
  freelancerProfile: null,
};
const client = {
  ...base,
  role: 'CLIENT',
  profileCompletion: { isComplete: false, missingFields: ['companyName', 'businessField'] },
};
const freelancer = {
  ...base,
  role: 'FREELANCER',
  hasPassword: false,
  socialProviders: ['GOOGLE'],
  profileCompletion: {
    isComplete: false,
    missingFields: ['mainCategory', 'techStacks', 'careerYears', 'hourlyRate'],
  },
};
const complete = { isComplete: true, missingFields: [] };

let api;
let router;

function renderProfile(user, handlers = {}, path = '/me') {
  api = installMockApi({
    'POST /auth/refresh': () => sessionResponse(user),
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
const lastBody = (key) => api.calls.filter((call) => call.key === key).at(-1).body;

beforeEach(() => {
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
});

afterEach(() => {
  cleanup();
  api?.restore();
  vi.restoreAllMocks();
});

describe('my profile page', () => {
  it('shows an incomplete profile without forcing input and keeps the header', async () => {
    renderProfile(client);

    expect(await screen.findByRole('heading', { name: '내 프로필' })).toBeTruthy();
    expect(screen.getByText('프로필 미완성')).toBeTruthy();
    expect(screen.getByText('남은 필수 항목: 회사명, 사업 분야')).toBeTruthy();
    expect(screen.getByText('김사용님')).toBeTruthy();
    expect(screen.getByRole('img', { name: '기본 프로필 이미지' })).toBeTruthy();
    expect(screen.getByText('이메일', { selector: 'dd' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/me');
  });

  it('shows an error when the options cannot be loaded and retries', async () => {
    let fail = true;
    renderProfile(client, {
      'GET /meta/options': () =>
        fail ? apiError(500, 'INTERNAL_ERROR') : { data: { data: OPTIONS } },
    });

    expect(await screen.findByText(/선택 항목을 불러오지 못했습니다/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByLabelText(/^회사명/)).toBeTruthy();
  });

  it('updates the name and bio and refreshes the header', async () => {
    renderProfile(client, {
      'PATCH /users/me': ({ body }) => ({ data: { data: { ...client, ...body } } }),
    });

    await screen.findByLabelText(/^이름/);
    type(/^이름/, '  ');
    fireEvent.click(screen.getByRole('button', { name: '기본 정보 저장' }));
    expect(await screen.findByText('이름을 입력해 주세요.')).toBeTruthy();
    expect(api.count('PATCH /users/me')).toBe(0);

    type(/^이름/, ' 새이름 ');
    type(/^자기소개/, ' 반갑습니다 ');
    fireEvent.click(screen.getByRole('button', { name: '기본 정보 저장' }));

    expect(await screen.findByText('새이름님')).toBeTruthy();
    expect(lastBody('PATCH /users/me')).toEqual({ name: '새이름', bio: '반갑습니다' });
    expect(screen.getAllByRole('status').some((el) => el.textContent === '저장했습니다.')).toBe(
      true,
    );
  });
});

describe('client profile form', () => {
  it('validates required fields, saves, and shows the completed state', async () => {
    const saved = {
      ...client,
      clientProfile: {
        companyName: '워크브릿지',
        businessField: 'ETC',
        businessFieldEtc: '반려동물',
        websiteUrl: null,
      },
      profileCompletion: complete,
    };
    renderProfile(client, { 'PUT /users/me/client-profile': () => ({ data: { data: saved } }) });

    await screen.findByLabelText(/^회사명/);
    fireEvent.click(screen.getByRole('button', { name: '의뢰인 정보 저장' }));
    expect(await screen.findByText('회사명을 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText('사업 분야를 선택해 주세요.')).toBeTruthy();
    expect(api.count('PUT /users/me/client-profile')).toBe(0);

    type(/^회사명/, ' 워크브릿지 ');
    type(/^사업 분야/, 'ETC');
    type(/^웹사이트/, 'ftp://example.com');
    fireEvent.click(screen.getByRole('button', { name: '의뢰인 정보 저장' }));
    expect(await screen.findByText('기타 사업 분야를 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText(/올바른 주소/)).toBeTruthy();

    type(/^기타 사업 분야/, '반려동물');
    type(/^웹사이트/, '');
    fireEvent.click(screen.getByRole('button', { name: '의뢰인 정보 저장' }));

    expect(await screen.findByText('프로필 완성')).toBeTruthy();
    expect(lastBody('PUT /users/me/client-profile')).toEqual({
      companyName: '워크브릿지',
      businessField: 'ETC',
      businessFieldEtc: '반려동물',
      websiteUrl: null,
    });
    expect(screen.getByLabelText(/^회사명/).value).toBe('워크브릿지');
  });

  it('loads saved values and shows server validation and failure messages', async () => {
    const existing = {
      ...client,
      clientProfile: {
        companyName: '기존 회사',
        businessField: 'COMMERCE',
        businessFieldEtc: null,
        websiteUrl: 'https://example.com',
      },
      profileCompletion: complete,
    };
    let response = apiError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
      fields: { companyName: '서버가 거부한 회사명' },
    });
    renderProfile(existing, { 'PUT /users/me/client-profile': () => response });

    expect((await screen.findByLabelText(/^회사명/)).value).toBe('기존 회사');
    expect(screen.getByLabelText(/^사업 분야/).value).toBe('COMMERCE');
    expect(screen.getByLabelText(/^웹사이트/).value).toBe('https://example.com');

    fireEvent.click(screen.getByRole('button', { name: '의뢰인 정보 저장' }));
    expect(await screen.findByText('서버가 거부한 회사명')).toBeTruthy();

    response = apiError(500, 'INTERNAL_ERROR', '잠시 후 다시 시도해 주세요.');
    fireEvent.click(screen.getByRole('button', { name: '의뢰인 정보 저장' }));
    expect(await screen.findByText('잠시 후 다시 시도해 주세요.')).toBeTruthy();
  });
});

describe('freelancer profile form', () => {
  it('selects tech stacks without duplicates, keeps the bigint rate as a string and saves', async () => {
    renderProfile(freelancer, {
      'PUT /users/me/freelancer-profile': ({ body }) => ({
        data: {
          data: {
            ...freelancer,
            freelancerProfile: {
              mainCategory: body.mainCategory,
              techStacks: STACKS.filter((s) => body.techStackIds.includes(s.id)).map(
                ({ id, name }) => ({ id, name }),
              ),
              careerYears: body.careerYears,
              hourlyRate: body.hourlyRate,
              portfolioUrl: body.portfolioUrl,
            },
            profileCompletion: complete,
          },
        },
      }),
    });

    expect(await screen.findByText('Google', { selector: 'dd' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '프리랜서 정보 저장' }));
    expect(await screen.findByText('기술 스택을 1개 이상 선택해 주세요.')).toBeTruthy();
    expect(screen.getByText('주요 활동 카테고리를 선택해 주세요.')).toBeTruthy();

    const results = within(await screen.findByRole('list', { name: '기술 스택 검색 결과' }));
    fireEvent.click(results.getByRole('button', { name: 'React' }));
    fireEvent.click(
      within(screen.getByRole('list', { name: '기술 스택 검색 결과' })).getByRole('button', {
        name: 'Node.js',
      }),
    );
    const chips = within(screen.getByRole('list', { name: '선택한 기술 스택' }));
    expect(chips.getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: '기술 스택 검색 결과' }))
        .getByRole('button', { name: 'React ✓' })
        .hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.click(chips.getByRole('button', { name: 'Node.js 빼기' }));
    expect(
      within(screen.getByRole('list', { name: '선택한 기술 스택' })).getAllByRole('listitem'),
    ).toHaveLength(1);

    type(/^주요 활동 카테고리/, 'WEB');
    type(/^경력/, '3');
    type(/^시간당 희망 단가/, '9,007,199,254,740,993,123');
    expect(screen.getByLabelText(/^시간당 희망 단가/).value).toBe(BIG_RATE);
    expect(screen.getByText('= 9,007,199,254,740,993,123원')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '프리랜서 정보 저장' }));

    expect(await screen.findByText('프로필 완성')).toBeTruthy();
    expect(lastBody('PUT /users/me/freelancer-profile')).toEqual({
      mainCategory: 'WEB',
      techStackIds: [1],
      careerYears: 3,
      hourlyRate: BIG_RATE,
      portfolioUrl: null,
    });
  });

  it('adds a custom tech stack and reuses an already selected one', async () => {
    const existing = {
      ...freelancer,
      freelancerProfile: {
        mainCategory: 'DESIGN',
        techStacks: [{ id: 3, name: 'Figma' }],
        careerYears: 0,
        hourlyRate: '30000',
        portfolioUrl: null,
      },
      profileCompletion: complete,
    };
    renderProfile(existing, {
      'GET /tech-stacks': () => ({ data: { data: [] } }),
      'POST /tech-stacks': ({ body }) =>
        body.name === 'figma'
          ? { data: { data: { id: 3, name: 'Figma', isCustom: false } } }
          : { status: 201, data: { data: { id: 99, name: body.name, isCustom: true } } },
    });

    expect((await screen.findByLabelText(/^경력/)).value).toBe('0');
    expect(screen.getByLabelText(/^시간당 희망 단가/).value).toBe('30000');

    type('기술 스택 검색', 'Svelte Kit');
    fireEvent.click(await screen.findByRole('button', { name: '“Svelte Kit” 직접 추가' }));
    const chips = () => within(screen.getByRole('list', { name: '선택한 기술 스택' }));
    await waitFor(() => expect(chips().getAllByRole('listitem')).toHaveLength(2));
    expect(lastBody('POST /tech-stacks')).toEqual({ name: 'Svelte Kit' });

    type('기술 스택 검색', 'figma');
    fireEvent.click(await screen.findByRole('button', { name: '“figma” 직접 추가' }));
    expect(await screen.findByText('Figma은(는) 이미 선택했습니다.')).toBeTruthy();
    expect(chips().getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('profile image', () => {
  const file = (name, type, size = 10) => new File([new Uint8Array(size)], name, { type });

  it('previews, uploads and deletes an image', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const withImage = { ...client, profileImageUrl: '/api/uploads/profile-images/a.webp' };
    renderProfile(client, {
      'POST /uploads/profile-image': () => ({ status: 201, data: { data: withImage } }),
      'PATCH /users/me': () => ({ data: { data: client } }),
    });

    const input = await screen.findByLabelText(/^프로필 이미지/);
    fireEvent.change(input, { target: { files: [file('evil.svg', 'image/svg+xml')] } });
    expect(await screen.findByText('JPG, PNG, WebP 이미지만 올릴 수 있습니다.')).toBeTruthy();
    fireEvent.change(input, {
      target: { files: [file('big.png', 'image/png', 5 * 1024 * 1024 + 1)] },
    });
    expect(await screen.findByText('이미지는 5MB 이하만 올릴 수 있습니다.')).toBeTruthy();
    expect(api.count('POST /uploads/profile-image')).toBe(0);

    fireEvent.change(input, { target: { files: [file('me.png', 'image/png')] } });
    expect(screen.getByRole('img', { name: '선택한 이미지 미리보기' }).getAttribute('src')).toBe(
      'blob:preview',
    );
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }));

    expect(await screen.findByText('프로필 이미지를 저장했습니다.')).toBeTruthy();
    const upload = api.calls.find((call) => call.key === 'POST /uploads/profile-image');
    expect(upload.rawData).toBeInstanceOf(FormData);
    expect(upload.rawData.get('file').name).toBe('me.png');
    expect(screen.getByRole('img', { name: '프로필 이미지' }).getAttribute('src')).toBe(
      '/api/uploads/profile-images/a.webp',
    );

    fireEvent.click(screen.getByRole('button', { name: '이미지 삭제' }));
    expect(await screen.findByText('프로필 이미지를 삭제했습니다.')).toBeTruthy();
    expect(lastBody('PATCH /users/me')).toEqual({ profileImageUrl: null });
    expect(screen.getByRole('img', { name: '기본 프로필 이미지' })).toBeTruthy();
  });

  it('shows the server message when the upload is rejected', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderProfile(client, {
      'POST /uploads/profile-image': () =>
        apiError(400, 'INVALID_IMAGE', '이미지 파일을 읽을 수 없습니다.'),
    });

    const input = await screen.findByLabelText(/^프로필 이미지/);
    fireEvent.change(input, { target: { files: [file('broken.png', 'image/png')] } });
    fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }));
    expect(await screen.findByText('이미지 파일을 읽을 수 없습니다.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '기본 프로필 이미지' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '이미지 저장' })).toBeNull();
  });
});
