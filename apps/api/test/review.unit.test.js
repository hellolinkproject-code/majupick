import { describe, expect, it } from 'vitest';
import { averageRating } from '../src/modules/reviews/reviewMath.js';
import { parseReviewBody } from '../src/modules/reviews/review.validation.js';
import {
  REVIEW_TAGS_FOR_CLIENT,
  REVIEW_TAGS_FOR_FREELANCER,
  allowedTagsForReviewerRole,
} from '../src/modules/reviews/reviewTags.js';

describe('review tags (D-20)', () => {
  it('returns role-specific allow lists', () => {
    expect(allowedTagsForReviewerRole('CLIENT')).toEqual([...REVIEW_TAGS_FOR_FREELANCER]);
    expect(allowedTagsForReviewerRole('FREELANCER')).toEqual([...REVIEW_TAGS_FOR_CLIENT]);
    expect(allowedTagsForReviewerRole('ADMIN')).toEqual([]);
  });
});

describe('parseReviewBody (REV-01)', () => {
  it('accepts client→freelancer review with allowed tags', () => {
    const ok = parseReviewBody(
      { rating: 5, content: '  좋았습니다  ', tags: ['책임감', '기술력'] },
      'CLIENT',
    );
    expect(ok.fields).toEqual({});
    expect(ok.rating).toBe(5);
    expect(ok.content).toBe('좋았습니다');
    expect(ok.tags).toEqual(['책임감', '기술력']);
  });

  it('accepts rating bounds 1 and 5', () => {
    expect(parseReviewBody({ rating: 1, content: 'a', tags: ['소통'] }, 'CLIENT').rating).toBe(1);
    expect(parseReviewBody({ rating: 5, content: 'a', tags: ['소통'] }, 'CLIENT').rating).toBe(5);
  });

  it('rejects rating 0 and 6', () => {
    expect(
      parseReviewBody({ rating: 0, content: 'a', tags: ['소통'] }, 'CLIENT').fields,
    ).toHaveProperty('rating');
    expect(
      parseReviewBody({ rating: 6, content: 'a', tags: ['소통'] }, 'CLIENT').fields,
    ).toHaveProperty('rating');
  });

  it('rejects freelancer tags when reviewer is client', () => {
    const bad = parseReviewBody({ rating: 4, content: 'ok', tags: ['명확한 요구사항'] }, 'CLIENT');
    expect(bad.fields).toHaveProperty('tags');
  });

  it('rejects unknown fields like revieweeId', () => {
    const bad = parseReviewBody(
      { rating: 4, content: 'ok', tags: ['소통'], revieweeId: 99 },
      'CLIENT',
    );
    expect(bad.fields).toHaveProperty('revieweeId');
  });
});

describe('averageRating (D-22)', () => {
  it('returns null for zero reviews and one decimal otherwise', () => {
    expect(averageRating(0, 0)).toBeNull();
    expect(averageRating(9, 2)).toBe(4.5);
    expect(averageRating(10, 3)).toBe(3.3);
  });
});
