import { HttpError } from '../../utils/httpError.js';
import { PROJECT_CATEGORY_VALUES } from '../profiles/options.js';
import { BIGINT_MAX, parseAmount, TECH_STACKS_MAX } from '../profiles/profile.validation.js';

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const MY_PROJECTS_PAGE_SIZE = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE_KEYS = [
  'title',
  'description',
  'category',
  'recruitStartDate',
  'recruitEndDate',
  'budget',
  'techStackIds',
];

export const DATE_MESSAGES = Object.freeze({
  startPast: '모집 시작일은 오늘 이후 날짜로 입력해 주세요.',
  endPast: '모집 마감일은 오늘 이후 날짜로 입력해 주세요.',
  endBeforeStart: '모집 마감일은 시작일과 같거나 이후여야 합니다.',
});

function validationError(fields, message = '입력값을 확인해 주세요.') {
  return new HttpError(400, 'VALIDATION_ERROR', message, fields && { fields });
}

const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key);

/** 실제로 있는 날짜의 'YYYY-MM-DD'만 받는다(2026-02-30 같은 값은 거부). */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

/** 항목별 형식 검사. 결과 객체에는 입력에 있던 항목만 담는다. */
const parsers = {
  title(value, fields) {
    const title = typeof value === 'string' ? value.trim() : '';
    if (!title) fields.title = '제목을 입력해 주세요.';
    else if (title.length > TITLE_MAX_LENGTH) {
      fields.title = `제목은 ${TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`;
    } else return title;
    return undefined;
  },
  description(value, fields) {
    const description = typeof value === 'string' ? value.trim() : '';
    if (!description) fields.description = '프로젝트 설명을 입력해 주세요.';
    else if (description.length > DESCRIPTION_MAX_LENGTH) {
      fields.description = `설명은 ${DESCRIPTION_MAX_LENGTH.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
    } else return description;
    return undefined;
  },
  category(value, fields) {
    if (PROJECT_CATEGORY_VALUES.has(value)) return value;
    fields.category = '카테고리를 선택해 주세요.';
    return undefined;
  },
  recruitStartDate(value, fields) {
    if (value === null || value === undefined || value === '') return null;
    const day = parseDateOnly(value);
    if (!day) fields.recruitStartDate = '모집 시작일 형식이 올바르지 않습니다.';
    return day ?? undefined;
  },
  recruitEndDate(value, fields) {
    const day = parseDateOnly(value);
    if (!day) fields.recruitEndDate = '모집 마감일을 입력해 주세요.';
    return day ?? undefined;
  },
  budget(value, fields) {
    const budget = parseAmount(value);
    if (budget === null || budget <= 0n) fields.budget = '예산은 1원 이상의 정수로 입력해 주세요.';
    else if (budget > BIGINT_MAX) fields.budget = '저장할 수 있는 최대 금액을 넘었습니다.';
    else return budget;
    return undefined;
  },
  techStackIds(ids, fields) {
    if (!Array.isArray(ids) || ids.length === 0) {
      fields.techStackIds = '필요한 기술 스택을 1개 이상 선택해 주세요.';
    } else if (ids.length > TECH_STACKS_MAX) {
      fields.techStackIds = `기술 스택은 ${TECH_STACKS_MAX}개까지 선택할 수 있습니다.`;
    } else if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
      fields.techStackIds = '기술 스택 선택 값이 올바르지 않습니다.';
    } else if (new Set(ids).size !== ids.length) {
      fields.techStackIds = '같은 기술 스택을 두 번 선택할 수 없습니다.';
    } else return ids;
    return undefined;
  },
};

function parseKeys(input, keys, fields) {
  const result = {};
  for (const key of keys) {
    const value = parsers[key](input[key], fields);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * PRJ-01 등록(3단계 퍼널의 전체 입력). 날짜는 KST 오늘(today) 기준:
 * 과거 시작일 거부(D-47), 마감일은 오늘 이후이면서 시작일 이후.
 */
export function validateProjectCreate(body, today) {
  const input = body && typeof body === 'object' ? body : {};
  const fields = {};
  const project = parseKeys(input, EDITABLE_KEYS, fields);

  const { recruitStartDate: start, recruitEndDate: end } = project;
  if (start && start < today) fields.recruitStartDate = DATE_MESSAGES.startPast;
  if (end && end < today) fields.recruitEndDate = DATE_MESSAGES.endPast;
  else if (start && end && end < start) fields.recruitEndDate = DATE_MESSAGES.endBeforeStart;

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return project;
}

/**
 * PRJ-03 부분 수정의 형식 검사. 날짜의 오늘·시작일 비교와 상태별 잠금은 저장된 값과 합쳐 서비스가 판단한다.
 * 상태는 서버만 바꾼다(D-52).
 */
export function validateProjectUpdate(body) {
  const input = body && typeof body === 'object' ? body : {};
  const fields = {};
  if (has(input, 'status')) fields.status = '상태는 직접 바꿀 수 없습니다.';
  if (has(input, 'recruitEndDate') && input.recruitEndDate === null) {
    fields.recruitEndDate = '모집 마감일은 비울 수 없습니다.';
  }
  const keys = EDITABLE_KEYS.filter((key) => has(input, key) && !fields[key]);
  const changes = parseKeys(input, keys, fields);

  if (Object.keys(fields).length > 0) throw validationError(fields);
  if (Object.keys(changes).length === 0) {
    throw validationError(null, '수정할 항목을 하나 이상 보내 주세요.');
  }
  return changes;
}

/** 중복 등록 방지 키(`Idempotency-Key` 헤더, UUID). FE가 등록 화면마다 하나 만든다. */
export function parseIdempotencyKey(value) {
  if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  throw validationError({
    idempotencyKey: 'Idempotency-Key 헤더에 등록 요청 키(UUID)를 보내 주세요.',
  });
}

/** 경로의 프로젝트 ID. 형식이 틀리면 없는 프로젝트와 같이 404. */
export function parseProjectId(value) {
  const id = /^\d{1,9}$/.test(value) ? Number(value) : 0;
  if (id > 0) return id;
  throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
}

export function parsePage(value) {
  if (value === undefined) return 1;
  const page = /^\d{1,6}$/.test(String(value)) ? Number(value) : 0;
  if (page >= 1) return page;
  throw validationError({ page: '페이지는 1 이상의 정수로 입력해 주세요.' });
}
