import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/apiClient.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { SEARCH_LIMITS } from '../lib/projectSearch.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { BRAND_NAME_EN, BRAND_NAME_KO, BRAND_TAGLINE } from '../lib/brand.js';

function ApiStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  if (isPending) return <span className="status status--pending">확인 중…</span>;
  if (isError) return <span className="status status--error">연결 실패</span>;
  return <span className="status status--ok">정상 ({data.status})</span>;
}

/** 홈 검색창·카테고리 버튼(A-19). 헤더의 '프로젝트 찾기'와 함께 목록으로 들어가는 세 경로다. */
function HomeSearch() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });

  function submit(event) {
    event.preventDefault();
    const q = keyword.trim().replace(/\s+/g, ' ');
    navigate(q ? `/projects?${new URLSearchParams({ q })}` : '/projects');
  }

  return (
    <section className="home-search" aria-labelledby="home-search-heading">
      <h2 id="home-search-heading">프로젝트 찾기</h2>
      <form role="search" className="search-page__keyword" onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="homeSearch">검색어</label>
          <input
            id="homeSearch"
            type="search"
            placeholder="예: 쇼핑몰, React"
            value={keyword}
            maxLength={SEARCH_LIMITS.keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <button type="submit" className="button">
          검색
        </button>
      </form>
      {options.data && (
        <ul className="home-search__categories" aria-label="카테고리로 찾기">
          {options.data.projectCategories.map((option) => (
            <li key={option.value}>
              <Link
                to={`/projects?category=${encodeURIComponent(option.value)}`}
                className="chip chip--option"
              >
                {option.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomePage() {
  const isLoggedIn = useSessionStore((state) => state.accessToken !== null);

  return (
    <section className="home">
      <h1>{BRAND_NAME_KO}</h1>
      <p className="home__lead">
        {BRAND_NAME_EN}
        <br />
        {BRAND_TAGLINE}
      </p>

      <HomeSearch />

      {import.meta.env.MODE !== 'production' ? (
        <>
          <h2>개발 환경 확인</h2>
          <dl className="checklist">
            <div>
              <dt>프론트엔드</dt>
              <dd>
                <span className="status status--ok">React + Vite 실행 중</span>
              </dd>
            </div>
            <div>
              <dt>백엔드 API (GET /api/health)</dt>
              <dd>
                <ApiStatus />
              </dd>
            </div>
            <div>
              <dt>세션 상태 (Zustand)</dt>
              <dd>{isLoggedIn ? '로그인됨' : '로그인 전'}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
