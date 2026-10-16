import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { fetchMyPayments } from '../lib/paymentApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

const STATUS_LABELS = {
  READY: '결제 대기',
  PAID: '결제 완료(테스트)',
  FAILED: '결제 실패',
  REFUNDED: '환불',
};

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** PAY-04 내 결제 내역. */
export function MyPaymentsPage() {
  const role = useSessionStore((state) => state.user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const list = useQuery({
    queryKey: ['my-payments', page],
    queryFn: () => fetchMyPayments(page),
    enabled: Boolean(role),
    staleTime: 0,
  });

  if (!role) {
    return (
      <NoticeCard title="역할이 필요합니다">
        <Link to="/select-role">역할 선택</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isLoading || (!list.data && !list.isError)) {
    body = <p className="page-status">결제 내역을 불러오는 중…</p>;
  } else if (list.isError) {
    body = (
      <p className="form-alert" role="alert">
        {parseApiError(list.error).message}
      </p>
    );
  } else if (list.data.data.length === 0) {
    body = (
      <div className="profile-card empty-state">
        <p>{page > 1 ? '이 페이지에는 결제가 없습니다.' : '아직 결제 내역이 없습니다.'}</p>
        <Link to="/me/contracts" className="button">
          내 계약으로
        </Link>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 결제 내역">
          {list.data.data.map((payment) => (
            <li key={payment.id} className="project-list__item">
              <div className="project-detail__badges">
                <span className="status-badge">
                  {STATUS_LABELS[payment.status] ?? payment.status}
                </span>
                <span className="project-list__date">
                  {payment.paidAt
                    ? `승인 ${formatDay(toKstDay(payment.paidAt))}`
                    : `요청 ${formatDay(toKstDay(payment.createdAt))}`}
                </span>
              </div>
              <Link to={`/payments/${payment.id}`} className="project-list__title">
                {payment.projectTitle ?? `주문 ${payment.orderId}`}
              </Link>
              <p className="project-list__meta">
                {formatWon(payment.amount)}
                {payment.escrowStatus === 'HELD' ? ' · 에스크로 보관 시뮬레이션' : ''}
              </p>
              <p className="project-list__meta">
                <Link to={`/contracts/${payment.contractId}`}>계약서 보기</Link>
                {' · '}
                <Link to={`/payments/${payment.id}`}>결제 상세</Link>
              </p>
            </li>
          ))}
        </ul>
        <nav className="pagination" aria-label="결제 페이지">
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
        <h1>내 결제 내역</h1>
      </div>
      <p className="form-field__hint">테스트 결제만 표시됩니다. 실결제·실송금 내역이 아닙니다.</p>
      {body}
    </section>
  );
}
