import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { fetchPayment } from '../lib/paymentApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/** PAY-05 결제 상세. 카드번호·시크릿은 표시하지 않는다. */
export function PaymentDetailPage() {
  const { paymentId } = useParams();
  const userId = useSessionStore((state) => state.user?.id);
  const payment = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => fetchPayment(paymentId),
    enabled: Boolean(userId && paymentId),
    staleTime: 0,
  });

  if (payment.isLoading || (!payment.data && !payment.isError)) {
    return <p className="page-status">결제 상세를 불러오는 중…</p>;
  }
  if (payment.isError) {
    return (
      <NoticeCard title="결제 내역을 볼 수 없습니다">
        <p>{parseApiError(payment.error).message}</p>
        <Link to="/me/payments">내 결제 내역으로</Link>
      </NoticeCard>
    );
  }

  const data = payment.data;
  return (
    <article className="profile-card" aria-labelledby="payment-detail-heading">
      <h1 id="payment-detail-heading">결제 상세</h1>
      {data.escrowNote && (
        <p className="form-success" role="status">
          {data.escrowNote}
        </p>
      )}
      <dl className="project-review">
        <div>
          <dt>프로젝트</dt>
          <dd>{data.projectTitle ?? '—'}</dd>
        </div>
        <div>
          <dt>금액</dt>
          <dd>{formatWon(data.amount)}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>{data.status}</dd>
        </div>
        <div>
          <dt>주문 번호</dt>
          <dd>{data.orderId}</dd>
        </div>
        <div>
          <dt>결제 수단</dt>
          <dd>{data.method ?? '—'}</dd>
        </div>
        <div>
          <dt>승인 시각</dt>
          <dd>{data.paidAt ? formatDay(toKstDay(data.paidAt)) : '—'}</dd>
        </div>
        <div>
          <dt>에스크로</dt>
          <dd>{data.escrowStatus ?? '—'}</dd>
        </div>
        {data.failReason && (
          <div>
            <dt>실패 사유</dt>
            <dd>{data.failReason}</dd>
          </div>
        )}
      </dl>
      <div className="funnel-actions">
        <Link to={`/contracts/${data.contractId}`} className="button button--ghost">
          계약서
        </Link>
        <Link to="/me/payments" className="button button--ghost">
          목록
        </Link>
      </div>
    </article>
  );
}
