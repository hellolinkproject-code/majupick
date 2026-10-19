import { HttpError } from '../../utils/httpError.js';
import { allowedTagsForReviewerRole } from './reviewTags.js';

export const REVIEW_CONTENT_MAX = 2000;
export const REVIEW_LIST_PAGE_SIZE = 10;

/**
 * REV-01 본문. `{ rating, content, tags }`만. reviewer/reviewee/project는 받지 않는다.
 * @returns {{ fields: Record<string, string>, rating: number | null, content: string | null, tags: string[] | null }}
 */
export function parseReviewBody(body, reviewerRole) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  for (const key of Object.keys(input)) {
    if (!['rating', 'content', 'tags'].includes(key)) {
      fields[key] = '이 값은 보낼 수 없습니다.';
    }
  }

  let rating = null;
  if (input.rating === undefined || input.rating === null || input.rating === '') {
    fields.rating = '별점은 1~5 정수로 입력해 주세요.';
  } else if (typeof input.rating === 'number') {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      fields.rating = '별점은 1~5 정수로 입력해 주세요.';
    } else rating = input.rating;
  } else if (typeof input.rating === 'string' && /^[1-5]$/.test(input.rating)) {
    rating = Number(input.rating);
  } else {
    fields.rating = '별점은 1~5 정수로 입력해 주세요.';
  }

  let content = null;
  if (typeof input.content !== 'string' || input.content.trim() === '') {
    fields.content = '리뷰 내용을 입력해 주세요.';
  } else {
    content = input.content.trim();
    if (content.length > REVIEW_CONTENT_MAX) {
      fields.content = `리뷰 내용은 ${REVIEW_CONTENT_MAX.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
    }
  }

  const allowed = new Set(allowedTagsForReviewerRole(reviewerRole));
  let tags = null;
  if (input.tags === undefined || input.tags === null) {
    fields.tags = '평가 태그를 1개 이상 선택해 주세요.';
  } else if (!Array.isArray(input.tags)) {
    fields.tags = '평가 태그 형식이 올바르지 않습니다.';
  } else if (input.tags.length === 0) {
    fields.tags = '평가 태그를 1개 이상 선택해 주세요.';
  } else if (input.tags.length > allowed.size) {
    fields.tags = '평가 태그가 너무 많습니다.';
  } else {
    const seen = new Set();
    const normalized = [];
    for (const tag of input.tags) {
      if (typeof tag !== 'string' || !allowed.has(tag)) {
        fields.tags = '허용되지 않은 평가 태그가 포함되어 있습니다.';
        break;
      }
      if (seen.has(tag)) {
        fields.tags = '같은 평가 태그를 중복해 선택할 수 없습니다.';
        break;
      }
      seen.add(tag);
      normalized.push(tag);
    }
    if (!fields.tags) tags = normalized;
  }

  if (Object.keys(fields).length > 0) {
    return { fields, rating: null, content: null, tags: null };
  }
  return { fields, rating, content, tags };
}

export function parseReviewListQuery(query) {
  const pageRaw = query?.page;
  let page = 1;
  if (pageRaw !== undefined && pageRaw !== '') {
    const n = Number(pageRaw);
    if (!Number.isInteger(n) || n < 1) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
        fields: { page: '페이지는 1 이상의 정수여야 합니다.' },
      });
    }
    page = n;
  }
  return { page };
}
