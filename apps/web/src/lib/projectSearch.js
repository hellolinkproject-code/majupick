// SRCH-01 검색 조건 ↔ URL 쿼리. 화면 상태는 URL이 기준이라 새로고침·뒤로 가기·링크 공유에도 유지된다.
// 서버 규칙(apps/api/src/modules/projects/projectSearch.js)과 같은 기준. 최종 판단은 서버가 한다.

export const SEARCH_LIMITS = Object.freeze({ keyword: 100, keywordTerms: 5, techStacks: 20 });
const BIGINT_MAX = 9223372036854775807n;
const INTEGER_MAX = 2147483647;

export const SEARCH_STATUS_OPTIONS = Object.freeze([
  { value: 'SCHEDULED', label: '모집 예정' },
  { value: 'RECRUITING', label: '모집 중' },
  { value: 'CLOSED', label: '모집 마감' },
]);

export const SEARCH_SORT_OPTIONS = Object.freeze([
  { value: 'latest', label: '최신순' },
  { value: 'deadline', label: '마감임박순' },
  { value: 'budget', label: '예산 높은순' },
]);

const STATUS_VALUES = new Set(SEARCH_STATUS_OPTIONS.map((option) => option.value));
const SORT_VALUES = new Set(SEARCH_SORT_OPTIONS.map((option) => option.value));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const emptyCriteria = () => ({
  q: '',
  category: '',
  budgetMin: '',
  budgetMax: '',
  techStackIds: [],
  deadline: '',
  status: '',
  sort: 'latest',
  page: 1,
});

/** 금액 입력('3,000,000')을 숫자 문자열로. 비었으면 '', 형식이 틀리면 null. Number로 바꾸지 않는다(D-51). */
export function normalizeAmount(text) {
  const digits = String(text ?? '').replace(/[,\s]/g, '');
  if (digits === '') return '';
  if (!/^\d{1,19}$/.test(digits) || BigInt(digits) > BIGINT_MAX) return null;
  return BigInt(digits).toString();
}

/** 검색어 확인. 문제가 없으면 null, 있으면 화면에 보여 줄 문장. */
export function keywordError(text) {
  const keyword = text.trim();
  if (keyword.length > SEARCH_LIMITS.keyword) {
    return `검색어는 ${SEARCH_LIMITS.keyword}자 이하로 입력해 주세요.`;
  }
  const terms = new Set(keyword.toLowerCase().split(/\s+/).filter(Boolean));
  if (terms.size > SEARCH_LIMITS.keywordTerms) {
    return `검색어는 ${SEARCH_LIMITS.keywordTerms}단어까지 입력할 수 있습니다.`;
  }
  return null;
}

/** 예산 범위 확인. 문제가 있는 칸의 문장을 돌려준다. */
export function budgetErrors(minText, maxText) {
  const min = normalizeAmount(minText);
  const max = normalizeAmount(maxText);
  const errors = {};
  if (min === null) errors.budgetMin = '0 이상의 정수로 입력해 주세요.';
  if (max === null) errors.budgetMax = '0 이상의 정수로 입력해 주세요.';
  if (min && max && BigInt(min) > BigInt(max)) {
    errors.budgetMax = '최대 예산은 최소 예산보다 크거나 같아야 합니다.';
  }
  return errors;
}

function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * URL 쿼리 → 정규화한 검색 조건. 형식이 틀린 값(직접 고친 주소 등)은 버린다.
 * 같은 조건이면 항상 같은 객체 모양이 되어 TanStack Query 키로 그대로 쓸 수 있다.
 * @param {URLSearchParams} params
 * @param {string[]} categories 허용 카테고리 값(SRCH-03). 아직 모르면 null이면 그대로 둔다
 */
export function criteriaFromParams(params, categories = null) {
  const criteria = emptyCriteria();
  const q = (params.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (q && !keywordError(q)) criteria.q = q;

  const category = params.get('category') ?? '';
  if (category && (!categories || categories.includes(category))) criteria.category = category;

  const min = normalizeAmount(params.get('budgetMin'));
  const max = normalizeAmount(params.get('budgetMax'));
  if (min) criteria.budgetMin = min;
  if (max) criteria.budgetMax = max;
  if (criteria.budgetMin && criteria.budgetMax && BigInt(min) > BigInt(max)) {
    criteria.budgetMax = '';
  }

  const ids = (params.get('techStackIds') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d{1,10}$/.test(part) && Number(part) >= 1 && Number(part) <= INTEGER_MAX)
    .map(Number);
  criteria.techStackIds = [...new Set(ids)]
    .slice(0, SEARCH_LIMITS.techStacks)
    .sort((a, b) => a - b);

  const deadline = params.get('deadline') ?? '';
  if (isRealDate(deadline)) criteria.deadline = deadline;
  const status = params.get('status') ?? '';
  if (STATUS_VALUES.has(status)) criteria.status = status;
  const sort = params.get('sort') ?? '';
  if (SORT_VALUES.has(sort)) criteria.sort = sort;
  const page = Number(params.get('page'));
  if (Number.isInteger(page) && page >= 1 && page <= 100_000) criteria.page = page;
  return criteria;
}

/** 검색 조건 → URL 쿼리. 기본값(최신순, 1페이지, 빈 값)은 주소에 남기지 않는다. */
export function criteriaToParams(criteria) {
  const params = new URLSearchParams();
  if (criteria.q) params.set('q', criteria.q);
  if (criteria.category) params.set('category', criteria.category);
  if (criteria.budgetMin) params.set('budgetMin', criteria.budgetMin);
  if (criteria.budgetMax) params.set('budgetMax', criteria.budgetMax);
  if (criteria.techStackIds.length > 0) params.set('techStackIds', criteria.techStackIds.join(','));
  if (criteria.deadline) params.set('deadline', criteria.deadline);
  if (criteria.status) params.set('status', criteria.status);
  if (criteria.sort !== 'latest') params.set('sort', criteria.sort);
  if (criteria.page > 1) params.set('page', String(criteria.page));
  return params;
}

/** API로 보낼 쿼리(빈 값 제외). 기술 스택은 쉼표로 이어 보낸다(배열 표기 `ids[]=` 대신). */
export function criteriaToApiParams(criteria) {
  return Object.fromEntries(criteriaToParams(criteria));
}

/** 페이지·정렬을 뺀 필터가 하나라도 걸려 있는지(필터 개수 배지·초기화 버튼에 쓴다). */
export function activeFilterCount(criteria) {
  return [
    criteria.category,
    criteria.budgetMin || criteria.budgetMax,
    criteria.techStackIds.length > 0,
    criteria.deadline,
    criteria.status,
  ].filter(Boolean).length;
}

/** 번호형 페이지네이션(D-40)에 보여 줄 페이지 번호(현재 페이지 주변 최대 5개). */
export function pageWindow(page, totalPages, size = 5) {
  if (totalPages < 1) return [];
  const start = Math.max(1, Math.min(page - Math.floor(size / 2), totalPages - size + 1));
  const end = Math.min(totalPages, start + size - 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
