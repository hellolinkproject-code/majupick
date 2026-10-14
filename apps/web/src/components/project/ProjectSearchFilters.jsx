import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormField, SelectField } from '../FormField.jsx';
import { fetchTechStacks, fetchTechStacksByIds } from '../../lib/profileApi.js';
import { formatWon } from '../../lib/profileForm.js';
import {
  budgetErrors,
  normalizeAmount,
  SEARCH_LIMITS,
  SEARCH_STATUS_OPTIONS,
} from '../../lib/projectSearch.js';
import { useDebouncedValue } from '../../lib/useDebouncedValue.js';

const BUDGET_DELAY = 500;

/**
 * 기술 스택 필터. 이미 있는 기술 스택만 고른다(검색 필터에서 새로 만들지 않는다).
 * URL에는 ID만 남으므로 이름은 PROF-06 `ids`로 다시 읽는다.
 */
function TechStackFilter({ value, onChange }) {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), 250);
  const search = useQuery({
    queryKey: ['tech-stacks', term],
    queryFn: () => fetchTechStacks(term),
    staleTime: 60_000,
  });
  const selected = useQuery({
    queryKey: ['tech-stacks-by-id', value.join(',')],
    queryFn: () => fetchTechStacksByIds(value),
    enabled: value.length > 0,
    staleTime: 5 * 60_000,
  });
  const names = new Map((selected.data ?? []).map((stack) => [stack.id, stack.name]));
  for (const stack of search.data ?? []) names.set(stack.id, stack.name);
  const chosen = new Set(value);
  const full = value.length >= SEARCH_LIMITS.techStacks;

  return (
    <fieldset className="tech-picker search-filters__group">
      <legend>기술 스택</legend>
      <p className="form-field__hint">하나라도 포함된 프로젝트를 찾습니다.</p>
      {value.length > 0 && (
        <ul className="tech-picker__chips" aria-label="선택한 기술 스택">
          {value.map((id) => {
            const name = names.get(id) ?? (selected.isPending ? '불러오는 중…' : `#${id}`);
            return (
              <li key={id} className="chip">
                <span>{name}</span>
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`${name} 필터 빼기`}
                  onClick={() => onChange((ids) => ids.filter((item) => item !== id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="form-field">
        <label htmlFor="searchTechStack">기술 스택 찾기</label>
        <input
          id="searchTechStack"
          type="search"
          placeholder="예: React"
          value={query}
          maxLength={50}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </div>
      {search.isError ? (
        <p className="form-field__error">기술 스택 목록을 불러오지 못했습니다.</p>
      ) : (
        <ul className="tech-picker__results" aria-label="기술 스택 선택지">
          {search.data?.length === 0 && <li className="form-field__hint">검색 결과가 없습니다.</li>}
          {(search.data ?? []).map((stack) => {
            const isChosen = chosen.has(stack.id);
            return (
              <li key={stack.id}>
                <button
                  type="button"
                  className="chip chip--option"
                  aria-pressed={isChosen}
                  disabled={isChosen || full}
                  onClick={() =>
                    onChange((ids) =>
                      ids.includes(stack.id) || ids.length >= SEARCH_LIMITS.techStacks
                        ? ids
                        : [...ids, stack.id],
                    )
                  }
                >
                  {stack.name}
                  {isChosen && ' ✓'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {full && (
        <p className="form-field__hint">
          기술 스택은 {SEARCH_LIMITS.techStacks}개까지 고를 수 있습니다.
        </p>
      )}
    </fieldset>
  );
}

/**
 * 예산 범위. 입력이 잠시 멈추면 적용한다. 쉼표는 허용하고 금액은 문자열로만 다룬다(D-51).
 * 주소가 바뀌면(뒤로 가기·초기화) 입력칸도 주소 값을 따른다.
 */
function BudgetFilter({ min, max, onApply }) {
  const base = `${min}|${max}`;
  const [draft, setDraft] = useState({ min, max, base });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const current = draft.base === base ? draft : { min, max, base };
  const errors = budgetErrors(current.min, current.max);

  function change(key, text) {
    const next = { ...current, [key]: text };
    setDraft(next);
    clearTimeout(timer.current);
    const nextErrors = budgetErrors(next.min, next.max);
    if (Object.keys(nextErrors).length > 0) return;
    timer.current = setTimeout(() => {
      const budgetMin = normalizeAmount(next.min);
      const budgetMax = normalizeAmount(next.max);
      if (budgetMin === min && budgetMax === max) return;
      setDraft({ ...next, base: `${budgetMin}|${budgetMax}` });
      onApply({ budgetMin, budgetMax }, { replace: true });
    }, BUDGET_DELAY);
  }

  const hint = (text) => {
    const amount = normalizeAmount(text);
    return amount ? formatWon(amount) : undefined;
  };

  return (
    <fieldset className="search-filters__group search-filters__budget">
      <legend>예산 범위 (원)</legend>
      <FormField
        id="budgetMin"
        label="최소 예산"
        inputMode="numeric"
        placeholder="예: 1,000,000"
        value={current.min}
        error={errors.budgetMin}
        hint={errors.budgetMin ? undefined : hint(current.min)}
        onChange={(event) => change('min', event.target.value)}
      />
      <FormField
        id="budgetMax"
        label="최대 예산"
        inputMode="numeric"
        placeholder="예: 5,000,000"
        value={current.max}
        error={errors.budgetMax}
        hint={errors.budgetMax ? undefined : hint(current.max)}
        onChange={(event) => change('max', event.target.value)}
      />
    </fieldset>
  );
}

/** SRCH-01 필터 5종(A-21). 서로 다른 필터는 모두 만족해야 한다(AND). */
export function ProjectSearchFilters({ id, criteria, categories, onApply, onReset, className }) {
  return (
    <section id={id} className={className} aria-label="검색 필터">
      <SelectField
        id="filterCategory"
        label="카테고리"
        placeholder="전체"
        options={categories}
        value={criteria.category}
        onChange={(event) => onApply({ category: event.target.value })}
      />
      <BudgetFilter min={criteria.budgetMin} max={criteria.budgetMax} onApply={onApply} />
      <TechStackFilter
        value={criteria.techStackIds}
        onChange={(update) =>
          onApply((current) => ({
            techStackIds: [...update(current.techStackIds)].sort((a, b) => a - b),
          }))
        }
      />
      <FormField
        id="filterDeadline"
        label="마감일"
        type="date"
        value={criteria.deadline}
        hint="이 날짜까지 마감되는 프로젝트"
        onChange={(event) => onApply({ deadline: event.target.value })}
      />
      <SelectField
        id="filterStatus"
        label="모집 상태"
        placeholder="전체"
        options={SEARCH_STATUS_OPTIONS}
        value={criteria.status}
        onChange={(event) => onApply({ status: event.target.value })}
      />
      <button type="button" className="button button--ghost button--block" onClick={onReset}>
        조건 초기화
      </button>
    </section>
  );
}
