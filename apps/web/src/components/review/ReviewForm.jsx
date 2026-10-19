import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog.jsx';

const RATINGS = [1, 2, 3, 4, 5];

/**
 * B-15~B-18 리뷰 작성 폼. 서버 성공 전에는 완료로 표시하지 않는다.
 * @param {{
 *   tags: string[],
 *   pending?: boolean,
 *   error?: string,
 *   onSubmit: (payload: { rating: number, content: string, tags: string[] }) => void,
 * }} props
 */
export function ReviewForm({ tags, pending = false, error = '', onSubmit }) {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSubmit = rating >= 1 && content.trim().length > 0 && selected.length > 0;
  const summary = useMemo(
    () => ({
      rating,
      content: content.trim(),
      tags: selected,
    }),
    [rating, content, selected],
  );

  function toggleTag(tag) {
    setSelected((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  }

  return (
    <section className="contract-preview__review" aria-labelledby="review-heading">
      <h2 id="review-heading">리뷰 작성</h2>
      <p className="form-field__hint">
        완료된 거래에 대해 한 번만 작성할 수 있으며, 제출 후에는 수정할 수 없습니다.
      </p>

      <fieldset className="form-field review-form__rating" disabled={pending}>
        <legend>별점</legend>
        <div className="review-form__stars" role="group" aria-label="별점 1점에서 5점">
          {RATINGS.map((value) => (
            <button
              key={value}
              type="button"
              className={
                value <= rating ? 'review-form__star review-form__star--on' : 'review-form__star'
              }
              aria-label={`${value}점`}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
            >
              <span aria-hidden="true">{value <= rating ? '★' : '☆'}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="form-field">
        <span>리뷰 내용</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          maxLength={2000}
          disabled={pending}
          required
        />
      </label>

      <fieldset className="form-field review-form__tags" disabled={pending}>
        <legend>평가 태그</legend>
        <ul className="tech-picker__chips" aria-label="평가 태그">
          {tags.map((tag) => {
            const active = selected.includes(tag);
            return (
              <li key={tag}>
                <button
                  type="button"
                  className={active ? 'chip chip--option chip--selected' : 'chip chip--option'}
                  aria-pressed={active}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="button"
        disabled={!canSubmit || pending}
        onClick={() => setConfirmOpen(true)}
      >
        리뷰 제출하기
      </button>

      {confirmOpen && (
        <ConfirmDialog
          title="리뷰를 제출할까요?"
          confirmLabel="제출하기"
          pendingLabel="제출 중…"
          pending={pending}
          error={error}
          onCancel={() => {
            if (!pending) setConfirmOpen(false);
          }}
          onConfirm={() => onSubmit(summary)}
        >
          <p>
            별점 {summary.rating}점 · 태그 {summary.tags.join(', ')}
          </p>
          <p>제출 후에는 수정할 수 없습니다.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
