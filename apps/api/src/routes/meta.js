import { Router } from 'express';
import { BUSINESS_FIELDS, PROJECT_CATEGORIES } from '../modules/profiles/options.js';
import { reviewTagsMeta } from '../modules/reviews/reviewTags.js';

/** SRCH-03 선택형 값 목록(D-59) + 리뷰 태그(D-20). */
export const metaRouter = Router();

metaRouter.get('/options', (_req, res) => {
  res.json({
    data: {
      projectCategories: PROJECT_CATEGORIES,
      businessFields: BUSINESS_FIELDS,
      reviewTags: reviewTagsMeta(),
    },
  });
});
