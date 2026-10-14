import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard, StatusBadge } from '../components/project/ProjectBits.jsx';
import { fetchMyApplications } from '../lib/applicationApi.js';
import { APPLICATION_STATUS_LABELS, REJECT_REASON_LABELS } from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, formatPeriod, toKstDay } from '../lib/projectForm.js';
import { useFlashNotice } from '../lib/useFlashNotice.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function ApplicationStatusBadge({ status }) {
  return (
    <span className={`status-badge application-badge--${status.toLowerCase()}`}>
      {APPLICATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ApplicationItem({ application }) {
  const { project } = application;
  return (
    <li className="project-list__item">
      <div className="project-detail__badges">
        <ApplicationStatusBadge status={application.status} />
        <StatusBadge status={project.isCancelled ? 'CANCELLED' : project.publicStatus} />
        <span className="project-list__date">
          지원 {formatDay(toKstDay(application.createdAt))}
        </span>
      </div>
      {project.isDeleted ? (
        <p className="project-list__title application-item__deleted">
          {project.title} <span className="chip">삭제된 프로젝트</span>
        </p>
      ) : (
        <Link to={`/projects/${project.id}`} className="project-list__title">
          {project.title}
          {project.isCancelled && <span className="chip">취소된 프로젝트</span>}
        </Link>
      )}
      <p className="project-list__meta">
        예산 {formatWon(project.budget)} ·{' '}
        {formatPeriod(project.recruitStartDate, project.recruitEndDate)}
      </p>
      <p className="project-list__meta">
        내 제안 {formatWon(application.proposedAmount)} ·{' '}
        {application.proposedDurationDays.toLocaleString('ko-KR')}일
      </p>
      {application.status === 'ACCEPTED' && (
        <p className="application-item__result application-item__result--accepted">
          의뢰인이 이 지원을 선정했습니다
          {application.decidedAt && ` (${formatDay(toKstDay(application.decidedAt))})`}.{' '}
          {project.isCancelled
            ? '이후 계약 체결 전에 프로젝트가 취소되어 계약이 진행되지 않습니다.'
            : '계약 체결은 별도 단계에서 진행됩니다.'}
        </p>
      )}
      {application.status === 'REJECTED' && application.rejectReason && (
        <p className="application-item__result">
          {REJECT_REASON_LABELS[application.rejectReason] ?? application.rejectReason}
          {application.decidedAt && ` (${formatDay(toKstDay(application.decidedAt))})`}
        </p>
      )}
      {project.isCancelled &&
        application.status === 'REJECTED' &&
        application.rejectReason !== 'PROJECT_CANCELLED' && (
          <p className="application-item__result">이후 의뢰인이 프로젝트를 취소했습니다.</p>
        )}
      <details className="application-item__letter">
        <summary>제출한 자기소개 보기</summary>
        <p className="project-detail__description">{application.coverLetter}</p>
      </details>
    </li>
  );
}

/**
 * APP-04 내 지원 현황(프리랜서, A-30·A-35). 최신 지원순 10개씩. 결과(검토 대기·선정됨·거절됨)는
 * 서버 기준이라 새로고침해도 같다. 처리된 지원도 목록에 남는다.
 */
export function MyApplicationsPage() {
  const role = useSessionStore((state) => state.user?.role);
  const notice = useFlashNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const list = useQuery({
    queryKey: ['my-applications', page],
    queryFn: () => fetchMyApplications(page),
    enabled: role === 'FREELANCER',
    staleTime: 0,
  });

  if (role !== 'FREELANCER') {
    return (
      <NoticeCard title="프리랜서 전용 화면입니다">
        <p>내 지원 현황은 프로젝트에 지원한 프리랜서 계정에서 볼 수 있습니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isPending) {
    body = <p className="page-status">내 지원 현황을 불러오는 중…</p>;
  } else if (list.isError) {
    body = (
      <div className="form-alert" role="alert">
        {parseApiError(list.error).message}{' '}
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => list.refetch()}
        >
          다시 시도
        </button>
      </div>
    );
  } else if (list.data.data.length === 0) {
    body = (
      <div className="profile-card empty-state">
        <p>
          {page > 1 ? '이 페이지에는 지원 내역이 없습니다.' : '아직 지원한 프로젝트가 없습니다.'}
        </p>
        <Link to="/projects" className="button">
          프로젝트 찾아보기
        </Link>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 지원 목록">
          {list.data.data.map((application) => (
            <ApplicationItem key={application.id} application={application} />
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
        <h1>내 지원 현황</h1>
        <Link to="/projects" className="button button--small">
          프로젝트 찾기
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
