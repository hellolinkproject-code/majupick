import { HttpError } from '../../utils/httpError.js';
import { NAME_MAX_LENGTH } from '../auth/validation.js';
import { TECH_STACK_NAME_MAX_LENGTH, normalizeTechStackName } from '../techStacks/techStack.js';
import { BUSINESS_FIELD_VALUES, PROJECT_CATEGORY_VALUES } from './options.js';

export const BIO_MAX_LENGTH = 2000;
export const COMPANY_NAME_MAX_LENGTH = 100;
export const BUSINESS_FIELD_ETC_MAX_LENGTH = 100;
export const URL_MAX_LENGTH = 500;
export const CAREER_YEARS_MAX = 80;
export const TECH_STACKS_MAX = 20;
// PostgreSQL bigint 최대값. 정책 상한이 아니라 저장 가능한 범위다(D-42).
const BIGINT_MAX = 9223372036854775807n;

function validationError(fields) {
  return new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
}

const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key);

/** 문자열이면 앞뒤 공백을 지운 값, 비었으면 null. 문자열이 아니면 undefined(형식 오류). */
function optionalText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** http(s) 절대 주소만 받는다. 계정 정보가 들어간 주소는 거부한다. */
function optionalUrl(value, fields, key) {
  const text = optionalText(value);
  if (text === null) return null;
  const message = '올바른 주소(http:// 또는 https://)를 입력해 주세요.';
  if (text === undefined || text.length > URL_MAX_LENGTH) {
    fields[key] = text === undefined ? message : `주소는 ${URL_MAX_LENGTH}자 이하로 입력해 주세요.`;
    return null;
  }
  try {
    const url = new URL(text);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      fields[key] = message;
      return null;
    }
  } catch {
    fields[key] = message;
    return null;
  }
  return text;
}

/**
 * D-51: 금액은 숫자만으로 된 문자열 또는 안전 정수 JSON 숫자로 받아 BigInt로 바꾼다.
 * @returns {bigint | null} 형식이 틀리면 null
 */
export function parseAmount(value) {
  let digits;
  if (typeof value === 'number' && Number.isSafeInteger(value)) digits = String(value);
  else if (typeof value === 'string' && /^\d{1,30}$/.test(value.trim())) digits = value.trim();
  else return null;
  return BigInt(digits);
}

/** PROF-01 공통 프로필 수정(부분 수정). 이메일·역할은 바꿀 수 없다. */
export function validateUserUpdate(body) {
  const input = body && typeof body === 'object' ? body : {};
  const fields = {};
  const result = {};

  if (has(input, 'email')) fields.email = '이메일은 바꿀 수 없습니다.';
  if (has(input, 'role')) fields.role = '역할은 바꿀 수 없습니다.';

  if (has(input, 'name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) fields.name = '이름을 입력해 주세요.';
    else if (name.length > NAME_MAX_LENGTH) {
      fields.name = `이름은 ${NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
    } else result.name = name;
  }

  if (has(input, 'bio')) {
    const bio = optionalText(input.bio);
    if (bio === undefined) fields.bio = '자기소개 형식이 올바르지 않습니다.';
    else if (bio && bio.length > BIO_MAX_LENGTH) {
      fields.bio = `자기소개는 ${BIO_MAX_LENGTH}자 이하로 입력해 주세요.`;
    } else result.bio = bio;
  }

  if (has(input, 'profileImageUrl')) {
    if (input.profileImageUrl === null) result.removeProfileImage = true;
    else fields.profileImageUrl = '프로필 이미지는 업로드 기능으로만 바꿀 수 있습니다.';
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return result;
}

/** PROF-02 의뢰인 프로필 저장. 필수 항목(D-05)은 회사명과 사업 분야('기타'면 직접 입력 포함). */
export function validateClientProfile(body) {
  const input = body && typeof body === 'object' ? body : {};
  const fields = {};

  const companyName = optionalText(input.companyName);
  if (!companyName) fields.companyName = '회사명을 입력해 주세요.';
  else if (companyName.length > COMPANY_NAME_MAX_LENGTH) {
    fields.companyName = `회사명은 ${COMPANY_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;
  }

  const businessField = BUSINESS_FIELD_VALUES.has(input.businessField) ? input.businessField : null;
  if (!businessField) fields.businessField = '사업 분야를 선택해 주세요.';

  let businessFieldEtc = optionalText(input.businessFieldEtc);
  if (businessFieldEtc === undefined) {
    fields.businessFieldEtc = '기타 사업 분야 형식이 올바르지 않습니다.';
    businessFieldEtc = null;
  } else if (businessField === 'ETC') {
    if (!businessFieldEtc) fields.businessFieldEtc = '기타 사업 분야를 입력해 주세요.';
    else if (businessFieldEtc.length > BUSINESS_FIELD_ETC_MAX_LENGTH) {
      fields.businessFieldEtc = `기타 사업 분야는 ${BUSINESS_FIELD_ETC_MAX_LENGTH}자 이하로 입력해 주세요.`;
    }
  } else if (businessFieldEtc) {
    fields.businessFieldEtc = '사업 분야가 기타일 때만 입력할 수 있습니다.';
  }

  const websiteUrl = optionalUrl(input.websiteUrl, fields, 'websiteUrl');

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { companyName, businessField, businessFieldEtc, websiteUrl };
}

/** PROF-03 프리랜서 프로필 저장. 필수 항목(D-05)은 카테고리, 기술 스택 1개 이상, 경력, 시간당 단가. */
export function validateFreelancerProfile(body) {
  const input = body && typeof body === 'object' ? body : {};
  const fields = {};

  const mainCategory = PROJECT_CATEGORY_VALUES.has(input.mainCategory) ? input.mainCategory : null;
  if (!mainCategory) fields.mainCategory = '주요 활동 카테고리를 선택해 주세요.';

  const ids = input.techStackIds;
  let techStackIds = [];
  if (!Array.isArray(ids) || ids.length === 0) {
    fields.techStackIds = '기술 스택을 1개 이상 선택해 주세요.';
  } else if (ids.length > TECH_STACKS_MAX) {
    fields.techStackIds = `기술 스택은 ${TECH_STACKS_MAX}개까지 선택할 수 있습니다.`;
  } else if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    fields.techStackIds = '기술 스택 선택 값이 올바르지 않습니다.';
  } else if (new Set(ids).size !== ids.length) {
    fields.techStackIds = '같은 기술 스택을 두 번 선택할 수 없습니다.';
  } else {
    techStackIds = ids;
  }

  const careerYears = input.careerYears;
  if (!Number.isInteger(careerYears) || careerYears < 0 || careerYears > CAREER_YEARS_MAX) {
    fields.careerYears = `경력은 0~${CAREER_YEARS_MAX} 사이의 정수(년)로 입력해 주세요.`;
  }

  const hourlyRate = parseAmount(input.hourlyRate);
  if (hourlyRate === null || hourlyRate <= 0n) {
    fields.hourlyRate = '시간당 단가는 1원 이상의 정수로 입력해 주세요.';
  } else if (hourlyRate > BIGINT_MAX) {
    fields.hourlyRate = '저장할 수 있는 최대 금액을 넘었습니다.';
  }

  const portfolioUrl = optionalUrl(input.portfolioUrl, fields, 'portfolioUrl');

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { mainCategory, techStackIds, careerYears, hourlyRate, portfolioUrl };
}

/** PROF-07 커스텀 기술 스택 이름. 공백은 하나로 줄인다. */
export function validateTechStackName(body) {
  const raw = typeof body?.name === 'string' ? body.name : '';
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name || /\p{Cc}/u.test(name) || !normalizeTechStackName(name)) {
    throw validationError({ name: '기술 스택 이름을 입력해 주세요.' });
  }
  if (name.length > TECH_STACK_NAME_MAX_LENGTH) {
    throw validationError({
      name: `기술 스택 이름은 ${TECH_STACK_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
    });
  }
  return { name, normalizedName: normalizeTechStackName(name) };
}

/** PROF-06 검색 조건. */
export function parseTechStackQuery(query) {
  const q = typeof query?.q === 'string' ? query.q.trim().slice(0, TECH_STACK_NAME_MAX_LENGTH) : '';
  const requested = Number(query?.limit);
  const limit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, 100) : 20;
  return { q, limit };
}
