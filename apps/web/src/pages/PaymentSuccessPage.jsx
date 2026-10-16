import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { confirmPayment } from '../lib/paymentApi.js';
import { formatWon } from '../lib/profileForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/**
 * PG successUrl 콜백. 쿼리만으로는 성공 처리하지 않고 PAY-02로 서버 검증한다.
 */
export function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const userId = useSessionStore((state) => state.user?.id);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const started = useRef(false);

  const paymentKey = params.get('paymentKey');
  const orderId = params.get('orderId');
  const amount = params.get('amount');
  const paramsMissing = !paymentKey || !orderId || !amount;

  useEffect(() => {
    if (!userId || started.current || paramsMissing) return;
    started.current = true;
    confirmPayment({ paymentKey, orderId, amount })
      .then(setResult)
      .catch((err) => setError(parseApiError(err).message));
  }, [userId, paymentKey, orderId, amount, paramsMissing]);

  if (paramsMissing) {
    return (
      <NoticeCard title="결제 승인에 실패했습니다">
        <p>결제 결과 파라미터가 올바르지 않습니다.</p>
        <Link to="/me/contracts">내 계약으로</Link>
      </NoticeCard>
    );
  }

  if (error) {
    return (
      <NoticeCard title="결제 승인에 실패했습니다">
        <p>{error}</p>
        <p className="form-field__hint">
          프로젝트가 작업 중으로 바뀌지 않았다면 계약서에서 다시 시도할 수 있습니다.
        </p>
        <Link to="/me/contracts">내 계약으로</Link>
      </NoticeCard>
    );
  }

  if (!result) {
    return <p className="page-status">결제 승인을 검증하는 중…</p>;
  }

  const payment = result.payment;
  return (
    <article className="profile-card" aria-labelledby="pay-ok-heading">
      <h1 id="pay-ok-heading">테스트 결제 완료</h1>
      <p className="form-success" role="status">
        {payment.escrowNote ?? '테스트 결제 완료 / 에스크로 보관 시뮬레이션'}
      </p>
      <p className="form-field__hint">
        실제 대금이 플랫폼 계좌에 보관된 것이 아닙니다. 프로젝트는 작업 중으로 전환되었습니다.
      </p>
      <dl className="project-review">
        <div>
          <dt>결제 금액</dt>
          <dd>{formatWon(payment.amount)}</dd>
        </div>
        <div>
          <dt>주문 번호</dt>
          <dd>{payment.orderId}</dd>
        </div>
        <div>
          <dt>에스크로</dt>
          <dd>{payment.escrowStatus ?? '—'}</dd>
        </div>
      </dl>
      <div className="funnel-actions">
        <Link to={`/contracts/${result.contractId}`} className="button">
          계약서 보기
        </Link>
        <Link to="/me/payments" className="button button--ghost">
          내 결제 내역
        </Link>
      </div>
    </article>
  );
}
