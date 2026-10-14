// SRCH-01 프로젝트 검색 조건. 쿼리 문자열 검사와 Prisma 조건·정렬 만들기만 하고 DB는 서비스가 읽는다.
import { HttpError } from '../../utils/httpError.js';
import { escapeLike } from '../../utils/like.js';
import { PROJECT_CATEGORY_VALUES } from '../profiles/options.js';
import { BIGINT_MAX, isDbId, TECH_STACKS_MAX } from '../profiles/profile.validation.js';
import { parseDateOnly } from './project.validation.js';
import { publicStatusWhere, stillOpenWhere, toDbDate } from './projectStatus.js';

export const SEARCH_PAGE_SIZE = 10;
export const KEYWORD_MAX_LENGTH = 100;
export const KEYWORD_MAX_TERMS = 5;
export const SEARCH_STATUSES = Object.freeze(['SCHEDULED', 'RECRUITING', 'CLOSED']);
export const SEARCH_SORTS = Object.freeze(['latest', 'deadline', 'budget']);
const PAGE_MAX = 100_000;

/** 같은 값이면 최신 등록순(D-33), 그래도 같으면 id로 순서를 고정한다. */
const NEWEST = [{ createdAt: 'desc' }, { id: 'desc' }];

/**
 * 쿼리 값 하나. 같은 이름을 여러 번 보내면(배열) 형식 오류로 본다.
 * @returns {string|null|undefined} 없거나 비었으면 null, 문자열이 아니면 undefined
 */
function single(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseKeyword(value, fields) {
  const raw = single(value);
  if (raw === undefined) fields.q = '검색어 형식이 올바르지 않습니다.';
  else if (raw !== null && raw.length > KEYWORD_MAX_LENGTH) {
    fields.q = `검색어는 ${KEYWORD_MAX_LENGTH}자 이하로 입력해 주세요.`;
  } else if (raw !== null) {
    const terms = [...new Set(raw.toLowerCase().split(/\s+/))];
    if (terms.length > KEYWORD_MAX_TERMS) {
      fields.q = `검색어는 ${KEYWORD_MAX_TERMS}단어까지 입력할 수 있습니다.`;
    } else return terms;
  }
  return [];
}

function parseBudget(value, key, fields) {
  const raw = single(value);
  if (raw === null) return null;
  if (raw === undefined || !/^\d{1,30}$/.test(raw)) {
    fields[key] = '예산은 0 이상의 정수로 입력해 주세요.';
    return null;
  }
  const amount = BigInt(raw);
  if (amount > BIGINT_MAX) {
    fields[key] = '저장할 수 있는 최대 금액을 넘었습니다.';
    return null;
  }
  return amount;
}

function parseTechStackIds(value, fields) {
  const raw = single(value);
  if (raw === null) return [];
  const parts = raw === undefined ? [] : raw.split(',').map((part) => part.trim());
  if (raw === undefined || !parts.every(isDbId)) {
    fields.techStackIds = '기술 스택 선택 값이 올바르지 않습니다.';
    return [];
  }
  const ids = [...new Set(parts.map(Number))];
  if (ids.length > TECH_STACKS_MAX) {
    fields.techStackIds = `기술 스택은 ${TECH_STACKS_MAX}개까지 선택할 수 있습니다.`;
    return [];
  }
  return ids;
}

function parseChoice(value, key, allowed, fields, message) {
  const raw = single(value);
  if (raw === null) return null;
  if (allowed.has(raw)) return raw;
  fields[key] = message;
  return null;
}

/**
 * SRCH-01 쿼리 검사. 잘못된 값은 조용히 무시하지 않고 항목별 400으로 알린다.
 * 알 수 없는 쿼리 이름은 무시한다(공유 링크의 추적 파라미터 등).
 */
export function parseProjectSearch(query = {}) {
  const fields = {};
  const criteria = {
    terms: parseKeyword(query.q, fields),
    category: parseChoice(
      query.category,
      'category',
      PROJECT_CATEGORY_VALUES,
      fields,
      '카테고리 값이 올바르지 않습니다.',
    ),
    budgetMin: parseBudget(query.budgetMin, 'budgetMin', fields),
    budgetMax: parseBudget(query.budgetMax, 'budgetMax', fields),
    techStackIds: parseTechStackIds(query.techStackIds, fields),
    deadline: null,
    status: parseChoice(
      query.status,
      'status',
      new Set(SEARCH_STATUSES),
      fields,
      '모집 상태 값이 올바르지 않습니다.',
    ),
    sort:
      parseChoice(
        query.sort,
        'sort',
        new Set(SEARCH_SORTS),
        fields,
        '정렬 값이 올바르지 않습니다.',
      ) ?? 'latest',
    page: 1,
  };

  const deadline = single(query.deadline);
  if (deadline !== null) {
    criteria.deadline = deadline === undefined ? null : parseDateOnly(deadline);
    if (!criteria.deadline) fields.deadline = '마감일은 YYYY-MM-DD 형식의 날짜로 입력해 주세요.';
  }

  const page = single(query.page);
  if (page !== null) {
    criteria.page = page !== undefined && /^\d{1,6}$/.test(page) ? Number(page) : 0;
    if (criteria.page < 1 || criteria.page > PAGE_MAX) {
      fields.page = '페이지는 1 이상의 정수로 입력해 주세요.';
    }
  }

  if (
    criteria.budgetMin !== null &&
    criteria.budgetMax !== null &&
    criteria.budgetMin > criteria.budgetMax
  ) {
    fields.budgetMax = '최대 예산은 최소 예산보다 크거나 같아야 합니다.';
  }

  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', '검색 조건을 확인해 주세요.', { fields });
  }
  return criteria;
}

/**
 * 검색 조건(서로 다른 필터는 AND, 기술 스택끼리는 OR, 검색어 단어끼리는 AND).
 * @param {object} criteria parseProjectSearch 결과
 * @param {Date} today KST 오늘(toDbDate 값). 상태 조건을 날짜로 계산한다(D-83)
 */
export function buildSearchWhere(criteria, today) {
  const and = criteria.terms.map((term) => {
    const contains = { contains: escapeLike(term), mode: 'insensitive' };
    return { OR: [{ title: contains }, { description: contains }] };
  });
  if (criteria.category) and.push({ category: criteria.category });
  if (criteria.budgetMin !== null || criteria.budgetMax !== null) {
    and.push({
      budget: {
        ...(criteria.budgetMin !== null && { gte: criteria.budgetMin }),
        ...(criteria.budgetMax !== null && { lte: criteria.budgetMax }),
      },
    });
  }
  if (criteria.techStackIds.length > 0) {
    and.push({ techStacks: { some: { techStackId: { in: criteria.techStackIds } } } });
  }
  if (criteria.deadline) and.push({ recruitEndDate: { lte: toDbDate(criteria.deadline) } });
  if (criteria.status) and.push(publicStatusWhere(criteria.status, today));
  return and;
}

/**
 * 정렬별로 이어 붙일 구간들. 마감임박순은 아직 모집 중·예정인 프로젝트를 마감일이 가까운 순서로 먼저,
 * 마감된 프로젝트는 그 뒤에 최근 마감순으로 둔다(D-84). 다른 정렬은 구간 하나.
 */
export function searchSegments(sort, today) {
  if (sort === 'budget') return [{ where: null, orderBy: [{ budget: 'desc' }, ...NEWEST] }];
  if (sort === 'deadline') {
    return [
      { where: stillOpenWhere(today), orderBy: [{ recruitEndDate: 'asc' }, ...NEWEST] },
      {
        where: { NOT: stillOpenWhere(today) },
        orderBy: [{ recruitEndDate: 'desc' }, ...NEWEST],
      },
    ];
  }
  return [{ where: null, orderBy: NEWEST }];
}
