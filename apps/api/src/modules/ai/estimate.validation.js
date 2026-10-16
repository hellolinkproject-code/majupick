import { HttpError } from '../../utils/httpError.js';
import { PROJECT_CATEGORY_VALUES } from '../profiles/options.js';
import { TECH_STACKS_MAX } from '../profiles/profile.validation.js';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../projects/project.validation.js';

function validationError(fields, message = '입력값을 확인해 주세요.') {
  return new HttpError(400, 'VALIDATION_ERROR', message, fields && { fields });
}

/**
 * AI-01 요청 본문. 등록 전 퍼널 값으로도 호출할 수 있어 프로젝트 ID는 받지 않는다.
 * @returns {{ title: string, description: string, category: string | null, techStackIds: number[] }}
 */
export function validatePriceAnalysisRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError(undefined, '요청 본문이 올바르지 않습니다.');
  }

  const fields = {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) fields.title = '제목을 입력해 주세요.';
  else if (title.length > TITLE_MAX_LENGTH) {
    fields.title = `제목은 ${TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`;
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) fields.description = '프로젝트 설명을 입력해 주세요.';
  else if (description.length > DESCRIPTION_MAX_LENGTH) {
    fields.description = `설명은 ${DESCRIPTION_MAX_LENGTH.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
  }

  let category = null;
  if (body.category !== undefined && body.category !== null && body.category !== '') {
    if (PROJECT_CATEGORY_VALUES.has(body.category)) category = body.category;
    else fields.category = '카테고리를 선택해 주세요.';
  }

  let techStackIds = [];
  if (body.techStackIds !== undefined && body.techStackIds !== null) {
    const ids = body.techStackIds;
    if (!Array.isArray(ids)) {
      fields.techStackIds = '기술 스택 선택 값이 올바르지 않습니다.';
    } else if (ids.length > TECH_STACKS_MAX) {
      fields.techStackIds = `기술 스택은 ${TECH_STACKS_MAX}개까지 선택할 수 있습니다.`;
    } else if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
      fields.techStackIds = '기술 스택 선택 값이 올바르지 않습니다.';
    } else if (new Set(ids).size !== ids.length) {
      fields.techStackIds = '같은 기술 스택을 두 번 선택할 수 없습니다.';
    } else {
      techStackIds = ids;
    }
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { title, description, category, techStackIds };
}
