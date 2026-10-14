import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ProjectCard } from '../components/project/ProjectCard.jsx';
import { ProjectSearchFilters } from '../components/project/ProjectSearchFilters.jsx';
import { parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { searchProjects } from '../lib/projectApi.js';
import {
  activeFilterCount,
  criteriaFromParams,
  criteriaToParams,
  emptyCriteria,
  keywordError,
  pageWindow,
  SEARCH_LIMITS,
  SEARCH_SORT_OPTIONS,
} from '../lib/projectSearch.js';

const KEYWORD_DELAY = 300;
const normalizeKeyword = (text) => text.trim().replace(/\s+/g, ' ');

function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="페이지">
      <button
        type="button"
        className="button button--small button--ghost"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        이전
      </button>
      <ul className="pagination__pages">
        {pageWindow(page, totalPages).map((number) => (
          <li key={number}>
            <button
              type="button"
              className="button button--small button--ghost pagination__page"
              aria-current={number === page ? 'page' : undefined}
              aria-label={`${number}페이지`}
              onClick={() => onPage(number)}
            >
              {number}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button--small button--ghost"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        다음
      </button>
    </nav>
  );
}

/**
 * SRCH-01 프로젝트 찾기(A-19~A-23). 검색 조건은 모두 URL 쿼리에 두어 새로고침·뒤로 가기에도 유지한다.
 * 조건이 바뀌면 1페이지로 돌아간다. 응답은 조건별 쿼리 키에 저장되어 늦게 온 이전 응답이 화면을 덮지 않는다.
 */
export function ProjectSearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });
  const categories = options.data?.projectCategories ?? [];
  const categoryValues = options.data ? categories.map((option) => option.value) : null;
  const categoryKey = categoryValues?.join(',');
  const criteria = useMemo(
    () =>
      criteriaFromParams(searchParams, categoryKey === undefined ? null : categoryKey.split(',')),
    [searchParams, categoryKey],
  );

  const results = useQuery({
    queryKey: ['project-search', criteria],
    queryFn: ({ signal }) => searchProjects(criteria, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // 조건 변경은 화면이 다시 그려지기 전에 연달아 올 수 있다(입력 멈춤 타이머와 클릭 등).
  // 앞선 변경을 덮지 않도록 마지막으로 보낸 조건에 합치고, 주소가 바뀌었을 때만 주소 값으로 맞춘다.
  const latest = useRef(criteria);
  useLayoutEffect(() => {
    latest.current = criteria;
  }, [criteria]);
  const keywordTimer = useRef(null);
  useEffect(() => () => clearTimeout(keywordTimer.current), []);
  const resultsHeading = useRef(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resetCount, setResetCount] = useState(0);

  /** patch는 바꿀 값이나, 직전 조건을 받아 바꿀 값을 돌려주는 함수다. */
  function apply(patch, { replace = false, keepPage = false } = {}) {
    const previous = latest.current;
    const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) };
    if (!keepPage) next.page = 1;
    latest.current = next;
    const params = criteriaToParams(next).toString();
    navigate({ search: params ? `?${params}` : '' }, { replace });
  }

  // 검색어 입력칸: 주소의 q가 바뀌면(뒤로 가기·초기화) 주소 값을 따르고, 입력 중에는 입력값을 보여 준다.
  const [keywordDraft, setKeywordDraft] = useState({ text: criteria.q, base: criteria.q });
  const keyword = keywordDraft.base === criteria.q ? keywordDraft.text : criteria.q;
  const keywordMessage = keywordError(keyword);

  function changeKeyword(text) {
    setKeywordDraft({ text, base: criteria.q });
    clearTimeout(keywordTimer.current);
    if (keywordError(text)) return;
    keywordTimer.current = setTimeout(() => applyKeyword(text), KEYWORD_DELAY);
  }

  function applyKeyword(text) {
    clearTimeout(keywordTimer.current);
    const q = normalizeKeyword(text);
    if (keywordError(q) || q === latest.current.q) return;
    setKeywordDraft({ text, base: q });
    apply({ q }, { replace: true });
  }

  function reset() {
    clearTimeout(keywordTimer.current);
    setKeywordDraft({ text: '', base: '' });
    setResetCount((count) => count + 1);
    latest.current = emptyCriteria();
    navigate({ search: '' });
  }

  function goToPage(page) {
    apply({ page }, { keepPage: true });
    resultsHeading.current?.focus();
  }

  const filterCount = activeFilterCount(criteria);
  const hasConditions = filterCount > 0 || criteria.q !== '';
  const from = `${location.pathname}${location.search}`;
  const categoryLabel = (value) =>
    categories.find((option) => option.value === value)?.label ?? value;

  let body;
  if (results.isPending) {
    body = (
      <p className="page-status" role="status">
        프로젝트를 불러오는 중…
      </p>
    );
  } else if (results.isError) {
    const error = parseApiError(results.error);
    body = (
      <div className="form-alert search-page__error" role="alert">
        <p>{error.message}</p>
        <div className="funnel-actions funnel-actions--start">
          <button type="button" className="button button--small" onClick={() => results.refetch()}>
            다시 시도
          </button>
          <button type="button" className="button button--small button--ghost" onClick={reset}>
            조건 초기화
          </button>
        </div>
      </div>
    );
  } else {
    const { data, pagination } = results.data;
    if (data.length === 0) {
      const beyond = pagination.totalCount > 0 && criteria.page > pagination.totalPages;
      body = (
        <div className="profile-card empty-state">
          {beyond ? (
            <>
              <p>요청한 페이지가 없습니다. 마지막 페이지는 {pagination.totalPages}페이지입니다.</p>
              <button
                type="button"
                className="button button--small"
                onClick={() => goToPage(pagination.totalPages)}
              >
                마지막 페이지로
              </button>
            </>
          ) : hasConditions ? (
            <>
              <p>조건에 맞는 프로젝트가 없습니다.</p>
              <button type="button" className="button button--small" onClick={reset}>
                조건 초기화
              </button>
            </>
          ) : (
            <p>아직 등록된 프로젝트가 없습니다.</p>
          )}
        </div>
      );
    } else {
      body = (
        <>
          <ul
            className="project-list"
            aria-label="프로젝트 검색 결과"
            aria-busy={results.isPlaceholderData ? 'true' : undefined}
          >
            {data.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                categoryLabel={categoryLabel(project.category)}
                from={from}
              />
            ))}
          </ul>
          <Pagination page={criteria.page} totalPages={pagination.totalPages} onPage={goToPage} />
        </>
      );
    }
  }

  return (
    <section className="search-page">
      <div className="project-page__heading search-page__heading">
        <h1>프로젝트 찾기</h1>
      </div>

      <form
        role="search"
        className="search-page__keyword"
        onSubmit={(event) => {
          event.preventDefault();
          applyKeyword(keyword);
        }}
      >
        <div className="form-field">
          <label htmlFor="searchKeyword">검색어</label>
          <input
            id="searchKeyword"
            type="search"
            placeholder="제목·설명에서 찾기 (예: 쇼핑몰 React)"
            value={keyword}
            maxLength={SEARCH_LIMITS.keyword}
            aria-invalid={keywordMessage ? 'true' : undefined}
            aria-describedby={keywordMessage ? 'searchKeyword-error' : undefined}
            onChange={(event) => changeKeyword(event.target.value)}
          />
          {keywordMessage && (
            <p id="searchKeyword-error" className="form-field__error">
              {keywordMessage}
            </p>
          )}
        </div>
        <button type="submit" className="button">
          검색
        </button>
      </form>

      <button
        type="button"
        className="button button--ghost search-filters__toggle"
        aria-expanded={filtersOpen}
        aria-controls="search-filters"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        필터{filterCount > 0 ? ` (${filterCount})` : ''} {filtersOpen ? '접기' : '펼치기'}
      </button>

      <div className="search-page__body">
        <ProjectSearchFilters
          key={resetCount}
          id="search-filters"
          className={filtersOpen ? 'search-filters is-open' : 'search-filters'}
          criteria={criteria}
          categories={categories}
          onApply={apply}
          onReset={reset}
        />

        <div className="search-page__results">
          <div className="search-page__summary">
            <h2 ref={resultsHeading} tabIndex={-1} className="search-page__count">
              {results.data
                ? `총 ${results.data.pagination.totalCount.toLocaleString('ko-KR')}개`
                : '검색 결과'}
            </h2>
            {results.isFetching && !results.isPending && (
              <span className="page-status" role="status">
                새 결과를 불러오는 중…
              </span>
            )}
            <div className="form-field search-page__sort">
              <label htmlFor="searchSort">정렬</label>
              <select
                id="searchSort"
                value={criteria.sort}
                onChange={(event) => apply({ sort: event.target.value })}
              >
                {SEARCH_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {body}
        </div>
      </div>
    </section>
  );
}
