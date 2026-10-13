import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';
import { createTechStack, fetchTechStacks } from '../../lib/profileApi.js';
import { normalizeTechStackName, PROFILE_LIMITS } from '../../lib/profileForm.js';

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * 기술 스택 선택(PROF-06 검색, PROF-07 직접 추가). 같은 스택은 두 번 고를 수 없고,
 * 목록에 없으면 직접 추가한다. 이름이 같은(정규화 기준) 스택이 있으면 서버가 기존 항목을 돌려준다.
 */
export function TechStackPicker({ value, onChange, error }) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const term = useDebouncedValue(query.trim(), 250);
  const search = useQuery({
    queryKey: ['tech-stacks', term],
    queryFn: () => fetchTechStacks(term),
    staleTime: 60_000,
  });

  const selectedIds = new Set(value.map((stack) => stack.id));

  function add(stack) {
    if (selectedIds.has(stack.id)) {
      setMessage(`${stack.name}은(는) 이미 선택했습니다.`);
      return;
    }
    if (value.length >= PROFILE_LIMITS.techStacks) {
      setMessage(`기술 스택은 ${PROFILE_LIMITS.techStacks}개까지 선택할 수 있습니다.`);
      return;
    }
    onChange([...value, { id: stack.id, name: stack.name }]);
    setQuery('');
    setMessage('');
  }

  const create = useMutation({
    mutationFn: createTechStack,
    onSuccess: add,
    onError: (requestError) => {
      const apiError = parseApiError(requestError);
      setMessage(apiError.fields.name ?? apiError.message);
    },
  });

  const typed = query.trim();
  const results = search.data ?? [];
  const hasExactMatch =
    typed !== '' &&
    results.some((stack) => normalizeTechStackName(stack.name) === normalizeTechStackName(typed));
  const errorId = error ? 'techStacks-error' : undefined;

  return (
    <fieldset
      className="tech-picker"
      aria-describedby={errorId}
      aria-invalid={error ? 'true' : undefined}
    >
      <legend>
        기술 스택<span className="form-field__badge form-field__badge--required">필수</span>
      </legend>

      {value.length > 0 ? (
        <ul className="tech-picker__chips" aria-label="선택한 기술 스택">
          {value.map((stack) => (
            <li key={stack.id} className="chip">
              <span>{stack.name}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`${stack.name} 빼기`}
                onClick={() => onChange(value.filter((item) => item.id !== stack.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="form-field__hint">아직 선택한 기술 스택이 없습니다.</p>
      )}

      <div className="form-field">
        <label htmlFor="techStackSearch">기술 스택 검색</label>
        <input
          id="techStackSearch"
          type="search"
          placeholder="예: React, Figma"
          value={query}
          maxLength={50}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </div>

      {search.isPending ? (
        <p className="form-field__hint">불러오는 중…</p>
      ) : search.isError ? (
        <p className="form-field__error">기술 스택 목록을 불러오지 못했습니다.</p>
      ) : (
        <ul className="tech-picker__results" aria-label="기술 스택 검색 결과">
          {results.length === 0 && <li className="form-field__hint">검색 결과가 없습니다.</li>}
          {results.map((stack) => {
            const selected = selectedIds.has(stack.id);
            return (
              <li key={stack.id}>
                <button
                  type="button"
                  className="chip chip--option"
                  aria-pressed={selected}
                  disabled={selected}
                  onClick={() => add(stack)}
                >
                  {stack.name}
                  {selected && ' ✓'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {typed && !hasExactMatch && !search.isPending && (
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => create.mutate(typed)}
          disabled={create.isPending}
        >
          {create.isPending ? '추가하는 중…' : `“${typed}” 직접 추가`}
        </button>
      )}

      {message && (
        <p className="form-field__error" role="alert">
          {message}
        </p>
      )}
      {error && (
        <p id="techStacks-error" className="form-field__error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
