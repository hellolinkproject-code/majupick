import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { fetchMyContracts } from '../lib/applicationApi.js';
import { CONTRACT_DISPLAY_STATUS_LABELS, CONTRACT_STATUS_LABELS } from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** CTR-03 내 계약 목록. 당사자인 계약만 보여 준다. */
export function MyContractsPage() {
  const role = useSessionStore((state) => state.user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const list = useQuery({
    queryKey: ['my-contracts', page],
    queryFn: () => fetchMyContracts(page),
    enabled: Boolean(role),
    staleTime: 0,
  });

  if (!role) {
    return (
      <NoticeCard title="역할이 필요합니다">
        <p>계약을 보려면 역할을 선택한 뒤 이용해 주세요.</p>
        <Link to="/select-role">역할 선택</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isLoading || (!list.data && !list.isError)) {
    body = <p className="page-status">내 계약을 불러오는 중…</p>;
  } else if (list.isError) {
    body = (
      <p className="form-alert" role="alert">
        {parseApiError(list.error).message}
      </p>
    );
  } else if (list.data.data.length === 0) {
    body = (
      <div className="profile-card empty-state">
        <p>{page > 1 ? '이 페이지에는 계약이 없습니다.' : '아직 참여한 계약이 없습니다.'}</p>
        <Link to={role === 'CLIENT' ? '/me/projects' : '/me/applications'} className="button">
          {role === 'CLIENT' ? '내 프로젝트로' : '내 지원 현황으로'}
        </Link>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 계약 목록">
          {list.data.data.map((contract) => {
            const statusLabel = CONTRACT_STATUS_LABELS[contract.status] ?? contract.status;
            const displayLabel =
              CONTRACT_DISPLAY_STATUS_LABELS[contract.displayStatus] ?? statusLabel;
            return (
              <li key={contract.id} className="project-list__item">
                <div className="project-detail__badges">
                  <span className="status-badge">{statusLabel}</span>
                  <span className="project-list__date">
                    생성 {formatDay(toKstDay(contract.createdAt))}
                  </span>
                </div>
                <Link to={`/contracts/${contract.id}`} className="project-list__title">
                  {contract.projectTitle}
                </Link>
                <p className="project-list__meta">
                  {formatWon(contract.agreedAmount)} ·{' '}
                  {contract.durationDays.toLocaleString('ko-KR')}일 · {displayLabel}
                </p>
                <p className="project-list__meta">
                  의뢰인 {contract.clientName ?? '—'} · 프리랜서 {contract.freelancerName ?? '—'}
                </p>
                <p className="project-list__meta">
                  <Link to={`/contracts/${contract.id}`}>계약서 보기</Link>
                </p>
              </li>
            );
          })}
        </ul>
        <nav className="pagination" aria-label="계약 페이지">
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
        <h1>내 계약</h1>
      </div>
      {body}
    </section>
  );
}
