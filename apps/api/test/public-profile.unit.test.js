// 공개 프로필(PROF-05) 응답 DTO·ID 해석 단위 테스트(DB 없음).
import { describe, expect, it } from 'vitest';
import { parseUserId } from '../src/modules/profiles/publicProfile.js';
import { publicUserSelect, toPublicUser } from '../src/modules/users/publicUser.js';

const IMAGE = `/api/uploads/profile-images/${'a'.repeat(32)}.webp`;

// DB 모델에 있는 비공개 값까지 넣어 DTO가 골라내는지 본다.
const row = (overrides = {}) => ({
  id: 7,
  email: 'secret@example.com',
  passwordHash: '$2b$10$hash',
  name: '홍길동',
  role: 'FREELANCER',
  profileImageUrl: IMAGE,
  bio: '소개',
  createdAt: new Date(),
  updatedAt: new Date(),
  socialAccounts: [{ provider: 'GOOGLE', providerUserId: 'google-sub' }],
  refreshTokens: [{ tokenHash: 'hash' }],
  clientProfile: null,
  freelancerProfile: {
    mainCategory: 'WEB',
    careerYears: 4,
    hourlyRate: 50000n,
    portfolioUrl: 'https://portfolio.example.com',
    techStacks: [
      { techStack: { id: 2, name: 'React', normalizedName: 'react', createdById: 9 } },
      { techStack: { id: 1, name: 'Node.js', normalizedName: 'nodejs', createdById: null } },
    ],
  },
  ...overrides,
});

describe('toPublicUser', () => {
  it('프리랜서는 공개 항목만 싣고 단가·이메일·인증 정보는 뺀다', () => {
    expect(toPublicUser(row())).toEqual({
      id: 7,
      name: '홍길동',
      role: 'FREELANCER',
      profileImageUrl: IMAGE,
      bio: '소개',
      profileComplete: true,
      clientProfile: null,
      freelancerProfile: {
        mainCategory: 'WEB',
        techStacks: [
          { id: 1, name: 'Node.js' },
          { id: 2, name: 'React' },
        ],
        careerYears: 4,
        portfolioUrl: 'https://portfolio.example.com',
      },
    });
    // BigInt가 남아 있으면 JSON.stringify가 실패한다.
    expect(() => JSON.stringify(toPublicUser(row()))).not.toThrow();
  });

  it('의뢰인은 회사 정보만 싣고, 역할과 맞지 않는 프로필 행은 무시한다', () => {
    const user = toPublicUser(
      row({
        role: 'CLIENT',
        clientProfile: {
          companyName: '워크브릿지',
          businessField: 'ETC',
          businessFieldEtc: '교육',
          websiteUrl: 'https://example.com',
        },
      }),
    );
    expect(user.clientProfile).toEqual({
      companyName: '워크브릿지',
      businessField: 'ETC',
      businessFieldEtc: '교육',
      websiteUrl: 'https://example.com',
    });
    expect(user.freelancerProfile).toBeNull();
    expect(user.profileComplete).toBe(true);
  });

  it('필수 항목이 비면 profileComplete=false, 역할 프로필이 없으면 null', () => {
    expect(toPublicUser(row({ freelancerProfile: null }))).toMatchObject({
      profileComplete: false,
      freelancerProfile: null,
    });
    const noRate = row();
    noRate.freelancerProfile.hourlyRate = null;
    expect(toPublicUser(noRate).profileComplete).toBe(false);
    expect(toPublicUser(row({ role: 'CLIENT' }))).toMatchObject({
      profileComplete: false,
      clientProfile: null,
      freelancerProfile: null,
    });
  });

  it('이 저장소 형식이 아닌 이미지 경로는 내보내지 않는다', () => {
    for (const url of [
      null,
      'https://evil.example.com/a.png',
      '/api/uploads/profile-images/../../etc/passwd',
      `/api/uploads/profile-images/${'A'.repeat(32)}.webp`,
      'javascript:alert(1)',
    ]) {
      expect(toPublicUser(row({ profileImageUrl: url })).profileImageUrl).toBeNull();
    }
  });
});

describe('publicUserSelect', () => {
  it('비공개 컬럼과 관계를 읽지 않는다', () => {
    const keys = JSON.stringify(publicUserSelect);
    for (const key of [
      'email',
      'passwordHash',
      'socialAccounts',
      'refreshTokens',
      'oauthTransactions',
      'createdTechStacks',
      'projects',
      'createdAt',
      'updatedAt',
      'normalizedName',
    ]) {
      expect(keys).not.toContain(`"${key}"`);
    }
  });
});

describe('parseUserId', () => {
  it('양의 정수 ID만 받는다', () => {
    expect(parseUserId('1')).toBe(1);
    expect(parseUserId('2147483647')).toBe(2147483647);
  });

  it.each(['0', '-1', '2147483648', '99999999999', '1.5', '1e3', 'me', 'abc', ' 1', '0x1f'])(
    '%s는 404 NOT_FOUND',
    (value) => {
      expect(() => parseUserId(value)).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
    },
  );
});
