import { formatDay, toKstDay } from '../../lib/projectForm.js';
import { formatAverageRating } from '../../lib/reviewFormat.js';

function ReviewItem({ review }) {
  return (
    <li className="review-list__item">
      <div className="review-list__meta">
        <strong className="review-list__rating" aria-label={`별점 ${review.rating}점`}>
          {'★'.repeat(review.rating)}
          {'☆'.repeat(5 - review.rating)}
        </strong>
        <span>{review.reviewerName ?? '익명'}</span>
        <span>{formatDay(toKstDay(review.createdAt))}</span>
      </div>
      {review.projectTitle && <p className="review-list__project">{review.projectTitle}</p>}
      <p className="review-list__content">{review.content}</p>
      {review.tags?.length > 0 && (
        <ul className="tech-picker__chips" aria-label="평가 태그">
          {review.tags.map((tag) => (
            <li key={tag} className="chip">
              {tag}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 계약서·공개 프로필에서 쓰는 읽기 전용 리뷰 카드/목록.
 */
export function ReviewCard({ title = '내가 작성한 리뷰', review, immutableHint = true }) {
  if (!review) return null;
  return (
    <section className="contract-preview__review-done" aria-labelledby="my-review-heading">
      <h2 id="my-review-heading">{title}</h2>
      {immutableHint && (
        <p className="form-field__hint" role="status">
          작성한 리뷰는 수정할 수 없습니다.
        </p>
      )}
      <ul className="review-list">
        <ReviewItem review={review} />
      </ul>
    </section>
  );
}

/**
 * @param {{
 *   summary?: { average: number | null, count: number },
 *   reviews?: object[],
 *   pagination?: { page: number, totalPages: number, totalCount: number },
 *   onPageChange?: (page: number) => void,
 *   loading?: boolean,
 *   error?: string,
 *   onRetry?: () => void,
 * }} props
 */
export function PublicReviewSection({
  summary,
  reviews = [],
  pagination,
  onPageChange,
  loading = false,
  error = '',
  onRetry,
}) {
  const averageText = formatAverageRating(summary?.average);
  const count = summary?.count ?? 0;

  return (
    <section className="profile-card public-profile__reviews" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">받은 리뷰</h2>
      {count === 0 && !loading && !error ? (
        <p className="page-status" role="status">
          아직 리뷰가 없습니다
        </p>
      ) : (
        <>
          {count > 0 && (
            <p className="public-profile__rating" role="status">
              평균 별점 <strong>{averageText}</strong>
              <span> · 리뷰 {count.toLocaleString('ko-KR')}개</span>
            </p>
          )}
          {loading && <p className="page-status">리뷰를 불러오는 중…</p>}
          {error && (
            <div role="alert">
              <p className="form-alert">{error}</p>
              {onRetry && (
                <button type="button" className="button button--small" onClick={onRetry}>
                  다시 시도
                </button>
              )}
            </div>
          )}
          {!loading && !error && reviews.length > 0 && (
            <ul className="review-list">
              {reviews.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </ul>
          )}
          {pagination && pagination.totalPages > 1 && (
            <div className="funnel-actions">
              <button
                type="button"
                className="button button--ghost button--small"
                disabled={pagination.page <= 1}
                onClick={() => onPageChange?.(pagination.page - 1)}
              >
                이전
              </button>
              <span className="form-field__hint">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                className="button button--ghost button--small"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange?.(pagination.page + 1)}
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
