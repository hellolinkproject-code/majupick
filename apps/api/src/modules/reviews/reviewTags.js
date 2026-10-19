/**
 * 역할별 평가 태그(D-20 제안). 서버·메타 API·FE가 같은 목록을 쓴다.
 * 의뢰인→프리랜서 / 프리랜서→의뢰인.
 */
export const REVIEW_TAGS_FOR_FREELANCER = Object.freeze([
  '책임감',
  '소통',
  '기술력',
  '일정 준수',
  '품질',
]);

export const REVIEW_TAGS_FOR_CLIENT = Object.freeze([
  '명확한 요구사항',
  '신속한 피드백',
  '원활한 소통',
  '정확한 정산',
  '존중',
]);

/** @param {'CLIENT' | 'FREELANCER'} reviewerRole */
export function allowedTagsForReviewerRole(reviewerRole) {
  if (reviewerRole === 'CLIENT') return REVIEW_TAGS_FOR_FREELANCER;
  if (reviewerRole === 'FREELANCER') return REVIEW_TAGS_FOR_CLIENT;
  return [];
}

export function reviewTagsMeta() {
  return {
    forFreelancer: [...REVIEW_TAGS_FOR_FREELANCER],
    forClient: [...REVIEW_TAGS_FOR_CLIENT],
  };
}
