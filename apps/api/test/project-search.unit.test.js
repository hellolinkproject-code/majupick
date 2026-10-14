// 프로젝트 검색 조건 검사·조건 만들기·계산 상태 단위 테스트(DB 없음). 실제 결과는 test/db에서 확인한다.
import { describe, expect, it } from 'vitest';
import {
  buildSearchWhere,
  parseProjectSearch,
  searchSegments,
} from '../src/modules/projects/projectSearch.js';
import { effectiveStatus, toDbDate } from '../src/modules/projects/projectStatus.js';
import { escapeLike } from '../src/utils/like.js';

const TODAY = '2026-10-14';
const fieldsOf = (query) => {
  try {
    parseProjectSearch(query);
  } catch (error) {
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    return error.details.fields;
  }
  throw new Error('expected a validation error');
};

describe('effectiveStatus (D-83)', () => {
  const row = (status, start, end) => ({
    status,
    recruitStartDate: start && toDbDate(start),
    recruitEndDate: toDbDate(end),
  });

  it('opens scheduled projects on the start day and closes them after the end day (KST)', () => {
    expect(effectiveStatus(row('SCHEDULED', '2026-10-15', '2026-10-20'), TODAY)).toBe('SCHEDULED');
    expect(effectiveStatus(row('SCHEDULED', TODAY, '2026-10-20'), TODAY)).toBe('RECRUITING');
    expect(effectiveStatus(row('RECRUITING', null, TODAY), TODAY)).toBe('RECRUITING');
    expect(effectiveStatus(row('RECRUITING', null, '2026-10-13'), TODAY)).toBe('CLOSED');
    expect(effectiveStatus(row('SCHEDULED', '2026-10-01', '2026-10-13'), TODAY)).toBe('CLOSED');
  });

  it('never changes deal stages, closed or cancelled projects', () => {
    for (const status of ['CLOSED', 'CONTRACTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(effectiveStatus(row(status, null, '2026-12-31'), TODAY)).toBe(status);
    }
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
    expect(escapeLike('쇼핑몰')).toBe('쇼핑몰');
  });
});

describe('parseProjectSearch (SRCH-01)', () => {
  it('defaults to every public project, newest first, page 1', () => {
    expect(parseProjectSearch({})).toEqual({
      terms: [],
      category: null,
      budgetMin: null,
      budgetMax: null,
      techStackIds: [],
      deadline: null,
      status: null,
      sort: 'latest',
      page: 1,
    });
    expect(parseProjectSearch({ q: '   ', category: '', status: '' }).terms).toEqual([]);
  });

  it('trims the keyword, splits it into unique words and limits its size', () => {
    expect(parseProjectSearch({ q: '  React   쇼핑몰 react ' }).terms).toEqual(['react', '쇼핑몰']);
    expect(parseProjectSearch({ q: 'x'.repeat(100) }).terms).toHaveLength(1);
    expect(fieldsOf({ q: 'x'.repeat(101) })).toHaveProperty('q');
    expect(fieldsOf({ q: 'a b c d e f' })).toHaveProperty('q');
  });

  it('keeps budgets as exact BigInts and rejects reversed or out-of-range ranges', () => {
    const criteria = parseProjectSearch({
      budgetMin: '9007199254740993',
      budgetMax: '9223372036854775807',
    });
    expect(criteria.budgetMin).toBe(9007199254740993n);
    expect(criteria.budgetMax).toBe(9223372036854775807n);
    expect(parseProjectSearch({ budgetMin: '5', budgetMax: '5' }).budgetMax).toBe(5n);

    expect(fieldsOf({ budgetMin: '2000', budgetMax: '1000' })).toEqual({
      budgetMax: '최대 예산은 최소 예산보다 크거나 같아야 합니다.',
    });
    for (const bad of ['-1', '1.5', '1e6', '1,000', '9223372036854775808']) {
      expect(fieldsOf({ budgetMin: bad })).toHaveProperty('budgetMin');
    }
  });

  it('parses comma-separated tech stack IDs once each and rejects bad lists', () => {
    expect(parseProjectSearch({ techStackIds: '5, 1,5' }).techStackIds).toEqual([5, 1]);
    expect(parseProjectSearch({ techStackIds: '2147483647' }).techStackIds).toEqual([2147483647]);
    for (const bad of ['a', '1,,2', '0', '-1', '1.5', '2147483648']) {
      expect(fieldsOf({ techStackIds: bad })).toHaveProperty('techStackIds');
    }
    const many = Array.from({ length: 21 }, (_, i) => i + 1).join(',');
    expect(fieldsOf({ techStackIds: many })).toHaveProperty('techStackIds');
  });

  it('accepts only allowed categories, statuses, sorts, real dates and pages', () => {
    expect(
      parseProjectSearch({
        category: 'DESIGN',
        status: 'CLOSED',
        sort: 'deadline',
        deadline: '2026-11-30',
        page: '3',
      }),
    ).toMatchObject({
      category: 'DESIGN',
      status: 'CLOSED',
      sort: 'deadline',
      deadline: '2026-11-30',
      page: 3,
    });
    expect(
      Object.keys(
        fieldsOf({
          category: 'GAME',
          status: 'CONTRACTING',
          sort: 'popular',
          deadline: '2026-02-30',
          page: '0',
        }),
      ).sort(),
    ).toEqual(['category', 'deadline', 'page', 'sort', 'status']);
  });

  it('rejects repeated parameters instead of guessing which one to use', () => {
    expect(
      Object.keys(fieldsOf({ q: ['a', 'b'], status: ['RECRUITING', 'CLOSED'] })).sort(),
    ).toEqual(['q', 'status']);
  });
});

describe('buildSearchWhere', () => {
  const today = toDbDate(TODAY);

  it('combines different filters with AND and escapes keyword wildcards', () => {
    const where = buildSearchWhere(
      parseProjectSearch({
        q: '100% 앱',
        category: 'WEB',
        budgetMin: '1000',
        techStackIds: '1,2',
        deadline: '2026-11-30',
      }),
      today,
    );
    expect(where).toEqual([
      {
        OR: [
          { title: { contains: '100\\%', mode: 'insensitive' } },
          { description: { contains: '100\\%', mode: 'insensitive' } },
        ],
      },
      {
        OR: [
          { title: { contains: '앱', mode: 'insensitive' } },
          { description: { contains: '앱', mode: 'insensitive' } },
        ],
      },
      { category: 'WEB' },
      { budget: { gte: 1000n } },
      { techStacks: { some: { techStackId: { in: [1, 2] } } } },
      { recruitEndDate: { lte: toDbDate('2026-11-30') } },
    ]);
    expect(buildSearchWhere(parseProjectSearch({}), today)).toEqual([]);
  });

  it('puts still-open projects first for the deadline sort and always ends with id', () => {
    const [open, closed] = searchSegments('deadline', today);
    expect(open.orderBy[0]).toEqual({ recruitEndDate: 'asc' });
    expect(closed.where).toEqual({ NOT: open.where });
    for (const sort of ['latest', 'deadline', 'budget']) {
      for (const segment of searchSegments(sort, today)) {
        expect(segment.orderBy.at(-1)).toEqual({ id: 'desc' });
      }
    }
  });
});
