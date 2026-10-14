import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard, StatusBadge } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { fetchMyProjects } from '../lib/projectApi.js';
import { formatDay, formatPeriod, toKstDay } from '../lib/projectForm.js';
import { useFlashNotice } from '../lib/useFlashNotice.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** PRJ-05 내 프로젝트(의뢰인). 최신 등록순 10개씩. 검색·필터·정렬은 STEP 05-B. */
export function MyProjectsPage() {
  const role = useSessionStore((state) => state.user?.role);
  const notice = useFlashNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const list = useQuery({
    queryKey: ['my-projects', page],
    queryFn: () => fetchMyProjects(page),
    enabled: role === 'CLIENT',
    staleTime: 0,
  });

  if (role !== 'CLIENT') {
    return (
      <NoticeCard title="의뢰인 전용 화면입니다">
        <p>내 프로젝트는 프로젝트를 등록한 의뢰인 계정에서 볼 수 있습니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isPending) {
    body = <p className="page-status">내 프로젝트를 불러오는 중…</p>;
  } else if (list.isError) {
    body = (
      <p className="form-alert" role="alert">
        {parseApiError(list.error).message}
      </p>
    );
  } else if (list.data.data.length === 0) {
    body = (
      <div className="profile-card empty-state">
        <p>
          {page > 1 ? '이 페이지에는 프로젝트가 없습니다.' : '아직 등록한 프로젝트가 없습니다.'}
        </p>
        <Link to="/projects/new" className="button">
          첫 프로젝트 등록하기
        </Link>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 프로젝트 목록">
          {list.data.data.map((project) => (
            <li key={project.id} className="project-list__item">
              <div className="project-detail__badges">
                <StatusBadge status={project.status} />
                <span className="project-list__date">
                  등록 {formatDay(toKstDay(project.createdAt))}
                </span>
              </div>
              <Link to={`/projects/${project.id}`} className="project-list__title">
                {project.title}
              </Link>
              <p className="project-list__meta">
                {formatWon(project.budget)} ·{' '}
                {formatPeriod(project.recruitStartDate, project.recruitEndDate)}
              </p>
              <p className="project-list__meta">
                <Link
                  to={`/projects/${project.id}#applicants`}
                  aria-label={`${project.title} 지원자 ${project.applicantCount}명 관리`}
                >
                  지원자 {project.applicantCount}명 관리
                </Link>
              </p>
            </li>
          ))}
        </ul>
        <nav className="pagination" aria-label="페이지">
          <button
            type="button"
            className="button button--small button--ghost"
            disabled={page <= 1}
            onClick={() => setSearchParams({ page: String(page - 1) })}
          >
            이전
          </button>
          <span>
            {page} / {Math.max(pagination.totalPages, 1)} 페이지 (총 {pagination.totalCount}개)
          </span>
          <button
            type="button"
            className="button button--small button--ghost"
            disabled={page >= pagination.totalPages}
            onClick={() => setSearchParams({ page: String(page + 1) })}
          >
            다음
          </button>
        </nav>
      </>
    );
  }

  return (
    <section className="project-page">
      <div className="project-page__heading">
        <h1>내 프로젝트</h1>
        <Link to="/projects/new" className="button button--small">
          새 프로젝트 등록
        </Link>
      </div>
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {body}
    </section>
  );
}
