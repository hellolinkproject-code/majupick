// 프로필 입력 검증·이미지 검증·완성 판정 단위 테스트(DB 없음).
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createRequireCompleteProfile } from '../src/middlewares/requireCompleteProfile.js';
import {
  parseAmount,
  validateClientProfile,
  validateFreelancerProfile,
  validateTechStackName,
  validateUserUpdate,
} from '../src/modules/profiles/profile.validation.js';
import { normalizeTechStackName } from '../src/modules/techStacks/techStack.js';
import {
  createLocalImageStorage,
  fileNameFromUrl,
  isStoredFileName,
} from '../src/modules/uploads/imageStorage.js';
import { detectImageType, processProfileImage } from '../src/modules/uploads/profileImage.js';
import { getMissingProfileFields } from '../src/modules/users/userMe.js';

const fieldsOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return { status: error.status, code: error.code, fields: error.details?.fields };
  }
  throw new Error('expected a validation error');
};

const tempDirs = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('client profile validation', () => {
  it('requires company name and business field, and the free text only for ETC', () => {
    expect(fieldsOf(() => validateClientProfile({}))).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { companyName: expect.any(String), businessField: expect.any(String) },
    });
    expect(
      fieldsOf(() => validateClientProfile({ companyName: 'A', businessField: 'ETC' })).fields,
    ).toEqual({ businessFieldEtc: '기타 사업 분야를 입력해 주세요.' });
    expect(
      fieldsOf(() =>
        validateClientProfile({ companyName: 'A', businessField: 'IT', businessFieldEtc: '로봇' }),
      ).fields,
    ).toEqual({ businessFieldEtc: '사업 분야가 기타일 때만 입력할 수 있습니다.' });
  });

  it('trims values, turns empty optional values into null and accepts only http(s) URLs', () => {
    expect(
      validateClientProfile({
        companyName: '  워크브릿지 ',
        businessField: 'ETC',
        businessFieldEtc: ' 로봇 ',
        websiteUrl: ' ',
      }),
    ).toEqual({
      companyName: '워크브릿지',
      businessField: 'ETC',
      businessFieldEtc: '로봇',
      websiteUrl: null,
    });
    for (const websiteUrl of ['javascript:alert(1)', 'ftp://a.example', 'https://u:p@a.example']) {
      expect(
        fieldsOf(() => validateClientProfile({ companyName: 'A', businessField: 'IT', websiteUrl }))
          .fields,
      ).toHaveProperty('websiteUrl');
    }
  });
});

describe('freelancer profile validation', () => {
  const valid = { mainCategory: 'WEB', techStackIds: [1, 2], careerYears: 3, hourlyRate: '50000' };

  it('requires category, at least one tech stack, career years and hourly rate', () => {
    expect(fieldsOf(() => validateFreelancerProfile({})).fields).toEqual({
      mainCategory: expect.any(String),
      techStackIds: '기술 스택을 1개 이상 선택해 주세요.',
      careerYears: expect.any(String),
      hourlyRate: expect.any(String),
    });
  });

  it('rejects duplicate tech stacks in the same request', () => {
    expect(
      fieldsOf(() => validateFreelancerProfile({ ...valid, techStackIds: [3, 3] })).fields,
    ).toEqual({ techStackIds: '같은 기술 스택을 두 번 선택할 수 없습니다.' });
  });

  it('keeps hourly rates beyond Number.MAX_SAFE_INTEGER exact as BigInt', () => {
    const huge = '9007199254740993123';
    expect(validateFreelancerProfile({ ...valid, hourlyRate: huge }).hourlyRate).toBe(BigInt(huge));
    expect(parseAmount(50000)).toBe(50000n);
    expect(parseAmount(2 ** 60)).toBeNull();
    expect(parseAmount('1.5')).toBeNull();
    expect(parseAmount('-1')).toBeNull();
    expect(
      fieldsOf(() => validateFreelancerProfile({ ...valid, hourlyRate: '9223372036854775808' }))
        .fields,
    ).toEqual({ hourlyRate: '저장할 수 있는 최대 금액을 넘었습니다.' });
    expect(fieldsOf(() => validateFreelancerProfile({ ...valid, hourlyRate: '0' })).fields).toEqual(
      { hourlyRate: expect.any(String) },
    );
  });

  it('rejects non-integer or negative career years', () => {
    for (const careerYears of [-1, 1.5, '3', 81]) {
      expect(
        fieldsOf(() => validateFreelancerProfile({ ...valid, careerYears })).fields,
      ).toHaveProperty('careerYears');
    }
  });
});

describe('common profile validation', () => {
  it('refuses to change email or role and only allows removing the image URL', () => {
    expect(
      fieldsOf(() =>
        validateUserUpdate({
          email: 'x@y.z',
          role: 'CLIENT',
          profileImageUrl: 'https://evil.example/a.png',
        }),
      ).fields,
    ).toEqual({
      email: '이메일은 바꿀 수 없습니다.',
      role: '역할은 바꿀 수 없습니다.',
      profileImageUrl: '프로필 이미지는 업로드 기능으로만 바꿀 수 있습니다.',
    });
    expect(validateUserUpdate({ name: ' 김 ', bio: '  ', profileImageUrl: null })).toEqual({
      name: '김',
      bio: null,
      removeProfileImage: true,
    });
  });

  it('normalizes custom tech stack names', () => {
    expect(validateTechStackName({ name: '  Node.js  ' })).toEqual({
      name: 'Node.js',
      normalizedName: 'nodejs',
    });
    expect(normalizeTechStackName('React Native')).toBe('reactnative');
    expect(normalizeTechStackName('C++')).toBe('c++');
    expect(fieldsOf(() => validateTechStackName({ name: ' .- ' })).fields).toHaveProperty('name');
  });
});

describe('profile completion', () => {
  it('lists missing required fields per role', () => {
    expect(getMissingProfileFields({ role: null })).toEqual(['role']);
    expect(getMissingProfileFields({ role: 'CLIENT', clientProfile: null })).toEqual([
      'companyName',
      'businessField',
    ]);
    expect(
      getMissingProfileFields({
        role: 'FREELANCER',
        freelancerProfile: { mainCategory: 'WEB', techStacks: [], careerYears: 0, hourlyRate: 1n },
      }),
    ).toEqual(['techStacks']);
  });

  it('blocks incomplete profiles with 403 PROFILE_INCOMPLETE and lets complete ones through', async () => {
    const users = {
      1: { id: 1, role: 'CLIENT', clientProfile: null },
      2: { id: 2, role: 'CLIENT', clientProfile: { companyName: 'A', businessField: 'IT' } },
    };
    const prisma = { user: { findUnique: async ({ where }) => users[where.id] ?? null } };
    const guard = createRequireCompleteProfile(prisma);
    const run = (userId) =>
      new Promise((resolve) => {
        guard({ auth: { userId } }, {}, resolve);
      });

    expect(await run(1)).toMatchObject({
      status: 403,
      code: 'PROFILE_INCOMPLETE',
      details: { missingFields: ['companyName', 'businessField'] },
    });
    expect(await run(2)).toBeUndefined();
    expect(await run(3)).toMatchObject({ status: 401 });
  });
});

describe('profile image checks', () => {
  const pngOf = (width = 8, height = 8) =>
    sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
      .png()
      .toBuffer();

  it('detects formats from file bytes, not from names or declared types', async () => {
    expect(detectImageType(await pngOf())).toBe('image/png');
    expect(
      detectImageType(
        await sharp(await pngOf())
          .jpeg()
          .toBuffer(),
      ),
    ).toBe('image/jpeg');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('MZ\x90\x00 fake executable payload'))).toBeNull();
  });

  it('re-encodes to a small WebP without metadata', async () => {
    const withExif = await sharp(await pngOf(1200, 800))
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-location' } } })
      .toBuffer();
    const out = await processProfileImage(withExif);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width, meta.height)).toBe(512);
    expect(meta.exif).toBeUndefined();
  });

  it('rejects SVG, disguised and truncated files', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(processProfileImage(svg)).rejects.toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    const disguised = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really a png, just text pretending to be one'),
    ]);
    await expect(processProfileImage(disguised)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_IMAGE',
    });
  });

  it('stores files under random names and refuses path traversal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wb-img-'));
    tempDirs.push(dir);
    const storage = createLocalImageStorage({ directory: dir });
    const url = await storage.save(Buffer.from('webp'));

    expect(url).toMatch(/^\/api\/uploads\/profile-images\/[a-f0-9]{32}\.webp$/);
    expect(url).not.toContain(dir);
    expect(await readdir(dir)).toHaveLength(1);

    for (const name of ['../secret.webp', '..\\secret.webp', 'a.webp', `${'a'.repeat(32)}.svg`]) {
      expect(isStoredFileName(name)).toBe(false);
    }
    expect(fileNameFromUrl('https://evil.example/x.webp')).toBeNull();
    await storage.remove('/api/uploads/profile-images/../../package.json');
    expect(await readdir(dir)).toHaveLength(1);
    await storage.remove(url);
    expect(await readdir(dir)).toHaveLength(0);
  });
});

describe('GET /api/meta/options', () => {
  it('returns the selectable categories, business fields, and review tags without a database', async () => {
    const res = await request(createApp(loadConfig({}))).get('/api/meta/options');
    expect(res.status).toBe(200);
    expect(res.body.data.projectCategories).toContainEqual({
      value: 'DATA_AI',
      label: '데이터·AI',
    });
    expect(res.body.data.businessFields).toContainEqual({ value: 'ETC', label: '기타' });
    expect(res.body.data.reviewTags.forFreelancer).toContain('책임감');
    expect(res.body.data.reviewTags.forClient).toContain('명확한 요구사항');
  });
});
