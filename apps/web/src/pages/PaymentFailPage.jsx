import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { failPayment } from '../lib/paymentApi.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/** PG failUrl. 실패를 기록하고 프로젝트는 계약 대기를 유지한다. */
export function PaymentFailPage() {
  const [params] = useSearchParams();
  const userId = useSessionStore((state) => state.user?.id);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState(null);
  const started = useRef(false);

  const orderId = params.get('orderId');
  const code = params.get('code') ?? 'PAY_PROCESS_CANCELED';
  const message = params.get('message') ?? '결제가 취소되거나 실패했습니다.';
  const skipRecord = Boolean(userId) && !orderId;

  useEffect(() => {
    if (!userId || started.current || !orderId) return;
    started.current = true;
    failPayment({ orderId, code, message })
      .then(() => setRecorded(true))
      .catch((err) => {
        setError(parseApiError(err).message);
        setRecorded(true);
      });
  }, [userId, orderId, code, message]);

  if (!skipRecord && !recorded) {
    return <p className="page-status">결제 실패를 기록하는 중…</p>;
  }

  return (
    <NoticeCard title="테스트 결제가 완료되지 않았습니다">
      <p>{message}</p>
      {error && <p className="form-alert">{error}</p>}
      <p className="form-field__hint">
        프로젝트는 작업 중으로 바뀌지 않습니다. 계약서에서 다시 결제할 수 있습니다.
      </p>
      <Link to="/me/contracts">내 계약으로</Link>
    </NoticeCard>
  );
}
