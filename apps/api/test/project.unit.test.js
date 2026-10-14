// 프로젝트 입력 검증·날짜(KST)·상태 계산·응답 변환 단위 테스트(DB 없음).
import { describe, expect, it } from 'vitest';
import { toProjectDetail } from '../src/modules/projects/project.service.js';
import {
  parseDateOnly,
  parseIdempotencyKey,
  parsePage,
  parseProjectId,
  validateProjectCreate,
  validateProjectUpdate,
} from '../src/modules/projects/project.validation.js';
import {
  fromDbDate,
  initialRecruitStatus,
  toDbDate,
  todayKst,
  toPublicStatus,
} from '../src/modules/projects/projectStatus.js';

const TODAY = '2026-10-14';
const errorOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      fields: error.details?.fields,
    };
  }
  throw new Error('expected an error');
};

const valid = {
  title: '  쇼핑몰 리뉴얼  ',
  description: ' 반응형 쇼핑몰 프론트엔드 개발 ',
  category: 'WEB',
  recruitStartDate: '2026-10-20',
  recruitEndDate: '2026-11-05',
  budget: '9007199254740993123',
  techStackIds: [1, 5],
};

describe('KST dates', () => {
  it('uses the Korean calendar day regardless of the UTC day', () => {
    expect(todayKst(new Date('2026-10-13T14:59:59.999Z'))).toBe('2026-10-13');
    expect(todayKst(new Date('2026-10-13T15:00:00.000Z'))).toBe('2026-10-14');
  });

  it('round-trips DB dates without a time zone shift', () => {
    expect(fromDbDate(toDbDate('2026-12-31'))).toBe('2026-12-31');
    expect(toDbDate(null)).toBeNull();
    expect(fromDbDate(null)).toBeNull();
  });

  it('accepts only real calendar dates', () => {
    expect(parseDateOnly('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '20261014', 20261014, null]) {
      expect(parseDateOnly(bad)).toBeNull();
    }
  });
});

describe('project status', () => {
  it('starts recruiting today or without a start date, otherwise scheduled (A-24)', () => {
    expect(initialRecruitStatus(null, TODAY)).toBe('RECRUITING');
    expect(initialRecruitStatus(TODAY, TODAY)).toBe('RECRUITING');
    expect(initialRecruitStatus('2026-10-15', TODAY)).toBe('SCHEDULED');
  });

  it('shows deal stages and cancellation as CLOSED to the public (A-26)', () => {
    expect(toPublicStatus('SCHEDULED')).toBe('SCHEDULED');
    expect(toPublicStatus('RECRUITING')).toBe('RECRUITING');
    for (const status of ['CLOSED', 'CONTRACTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(toPublicStatus(status)).toBe('CLOSED');
    }
  });
});

describe('validateProjectCreate (PRJ-01)', () => {
  it('trims text and keeps the budget as an exact BigInt', () => {
    expect(validateProjectCreate(valid, TODAY)).toEqual({
      title: '쇼핑몰 리뉴얼',
      description: '반응형 쇼핑몰 프론트엔드 개발',
      category: 'WEB',
      recruitStartDate: '2026-10-20',
      recruitEndDate: '2026-11-05',
      budget: 9007199254740993123n,
      techStackIds: [1, 5],
    });
    expect(validateProjectCreate({ ...valid, recruitStartDate: '' }, TODAY).recruitStartDate).toBe(
      null,
    );
    expect(validateProjectCreate({ ...valid, budget: 3000000 }, TODAY).budget).toBe(3000000n);
  });

  it('reports every missing required field', () => {
    const error = errorOf(() => validateProjectCreate({}, TODAY));
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(Object.keys(error.fields).sort()).toEqual([
      'budget',
      'category',
      'description',
      'recruitEndDate',
      'techStackIds',
      'title',
    ]);
  });

  it('rejects past dates, end before start and invalid values', () => {
    const past = errorOf(() =>
      validateProjectCreate(
        { ...valid, recruitStartDate: '2026-10-13', recruitEndDate: '2026-10-13' },
        TODAY,
      ),
    );
    expect(past.fields).toEqual({
      recruitStartDate: '모집 시작일은 오늘 이후 날짜로 입력해 주세요.',
      recruitEndDate: '모집 마감일은 오늘 이후 날짜로 입력해 주세요.',
    });

    const order = errorOf(() =>
      validateProjectCreate(
        { ...valid, recruitStartDate: '2026-11-01', recruitEndDate: '2026-10-31' },
        TODAY,
      ),
    );
    expect(order.fields).toEqual({
      recruitEndDate: '모집 마감일은 시작일과 같거나 이후여야 합니다.',
    });

    const bad = errorOf(() =>
      validateProjectCreate(
        {
          ...valid,
          title: 'x'.repeat(101),
          description: 'y'.repeat(5001),
          category: 'GAME',
          budget: '0',
          techStackIds: [1, 1],
        },
        TODAY,
      ),
    );
    expect(Object.keys(bad.fields).sort()).toEqual([
      'budget',
      'category',
      'description',
      'techStackIds',
      'title',
    ]);
  });

  it('rejects budgets that are fractional, negative, unsafe numbers or above bigint', () => {
    for (const budget of [1.5, -1, '-1', '1e6', 2 ** 53, '9223372036854775808']) {
      expect(
        errorOf(() => validateProjectCreate({ ...valid, budget }, TODAY)).fields,
      ).toHaveProperty('budget');
    }
    expect(validateProjectCreate({ ...valid, budget: '9223372036854775807' }, TODAY).budget).toBe(
      9223372036854775807n,
    );
  });
});

describe('validateProjectUpdate (PRJ-03)', () => {
  it('returns only the sent fields', () => {
    expect(validateProjectUpdate({ title: ' 새 제목 ', budget: '5000000', clientId: 99 })).toEqual({
      title: '새 제목',
      budget: 5000000n,
    });
    expect(validateProjectUpdate({ recruitStartDate: null })).toEqual({ recruitStartDate: null });
  });

  it('rejects status changes, empty bodies and clearing the end date', () => {
    expect(errorOf(() => validateProjectUpdate({ status: 'COMPLETED' })).fields).toEqual({
      status: '상태는 직접 바꿀 수 없습니다.',
    });
    expect(errorOf(() => validateProjectUpdate({}))).toMatchObject({
      status: 400,
      message: '수정할 항목을 하나 이상 보내 주세요.',
    });
    expect(errorOf(() => validateProjectUpdate({ recruitEndDate: null })).fields).toHaveProperty(
      'recruitEndDate',
    );
    expect(errorOf(() => validateProjectUpdate({ techStackIds: [] })).fields).toHaveProperty(
      'techStackIds',
    );
  });
});

describe('request parameters', () => {
  it('requires a UUID idempotency key', () => {
    const key = 'B0E1C7A4-1F55-4B1A-9C3E-2D8F6A7B9C10';
    expect(parseIdempotencyKey(key)).toBe(key.toLowerCase());
    for (const bad of [undefined, '', 'abc', `${key}x`]) {
      expect(errorOf(() => parseIdempotencyKey(bad)).fields).toHaveProperty('idempotencyKey');
    }
  });

  it('treats malformed project IDs as not found and validates pages', () => {
    expect(parseProjectId('42')).toBe(42);
    for (const bad of ['0', '-1', 'abc', '1.5', '9999999999']) {
      expect(errorOf(() => parseProjectId(bad)).status).toBe(404);
    }
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('3')).toBe(3);
    expect(errorOf(() => parsePage('0')).status).toBe(400);
  });
});

describe('toProjectDetail', () => {
  const row = {
    id: 1,
    clientId: 10,
    title: 't',
    description: 'd',
    category: 'WEB',
    recruitStartDate: null,
    recruitEndDate: toDbDate('2026-11-05'),
    budget: 9007199254740993123n,
    status: 'CLOSED',
    createdAt: new Date('2026-10-14T00:00:00Z'),
    updatedAt: new Date('2026-10-14T00:00:00Z'),
    client: { id: 10, name: '의뢰인', profileImageUrl: null, clientProfile: { companyName: 'WB' } },
    techStacks: [
      { techStack: { id: 2, name: 'React' } },
      { techStack: { id: 1, name: 'Node.js' } },
    ],
  };

  it('gives the owner the internal status and allowed actions only', () => {
    const owner = toProjectDetail(row, 10);
    expect(owner).toMatchObject({
      budget: '9007199254740993123',
      recruitEndDate: '2026-11-05',
      publicStatus: 'CLOSED',
      isOwner: true,
      status: 'CLOSED',
      availableActions: ['EDIT', 'DELETE'],
      lockedFields: ['recruitStartDate', 'recruitEndDate'],
      techStacks: [
        { id: 1, name: 'Node.js' },
        { id: 2, name: 'React' },
      ],
      client: { id: 10, name: '의뢰인', profileImageUrl: null, companyName: 'WB' },
    });

    const visitor = toProjectDetail({ ...row, status: 'CONTRACTING' }, 11);
    expect(visitor.isOwner).toBe(false);
    expect(visitor.publicStatus).toBe('CLOSED');
    expect(visitor).not.toHaveProperty('status');
    expect(visitor).not.toHaveProperty('availableActions');
    expect(toProjectDetail({ ...row, status: 'CONTRACTING' }, 10).availableActions).toEqual([]);
  });

  it('offers the manual close (STAT-01) only while recruiting', () => {
    expect(toProjectDetail({ ...row, status: 'RECRUITING' }, 10).availableActions).toEqual([
      'EDIT',
      'DELETE',
      'CLOSE',
    ]);
    expect(toProjectDetail({ ...row, status: 'SCHEDULED' }, 10).availableActions).toEqual([
      'EDIT',
      'DELETE',
    ]);
  });
});
