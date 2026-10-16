import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { fetchContract } from '../lib/applicationApi.js';
import { parseApiError } from '../lib/authApi.js';
import { preparePayment, startFakeCheckout, startTossCheckout } from '../lib/paymentApi.js';
import { formatWon } from '../lib/profileForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/**
 * PAY-01 이후 테스트 결제 시작. mock이면 Fake 리다이렉트, toss SDK면 결제창.
 */
export function PaymentCheckoutPage() {
  const { contractId } = useParams();
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const [localError, setLocalError] = useState(null);

  const contract = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => fetchContract(contractId),
    enabled: Boolean(user?.id && contractId),
    staleTime: 0,
  });

  const pay = useMutation({
    mutationFn: () => preparePayment(contractId),
    onSuccess: async (data) => {
      setLocalError(null);
      const origin = window.location.origin;
      const successUrl = `${origin}/payments/success`;
      const failUrl = `${origin}/payments/fail`;
      try {
        if (data.pg?.usesBrowserSdk && data.pg.clientKey) {
          await startTossCheckout({
            clientKey: data.pg.clientKey,
            orderId: data.orderId,
            orderName: data.orderName,
            amount: data.amount,
            customerName: data.customerName,
            successUrl,
            failUrl,
          });
        } else {
          startFakeCheckout({
            orderId: data.orderId,
            amount: data.amount,
            successUrl,
          });
        }
      } catch (error) {
        setLocalError(error?.message ?? '결제창을 열지 못했습니다.');
      }
    },
  });

  if (user?.role !== 'CLIENT') {
    return (
      <NoticeCard title="의뢰인만 결제할 수 있습니다">
        <p>테스트 결제는 계약을 체결한 의뢰인 계정에서만 가능합니다.</p>
        <Link to={`/contracts/${contractId}`}>계약서로</Link>
      </NoticeCard>
    );
  }

  if (contract.isLoading || (!contract.data && !contract.isError)) {
    return <p className="page-status">결제 정보를 불러오는 중…</p>;
  }
  if (contract.isError) {
    return (
      <NoticeCard title="결제를 시작할 수 없습니다">
        <p>{parseApiError(contract.error).message}</p>
        <Link to="/me/contracts">내 계약으로</Link>
      </NoticeCard>
    );
  }

  const data = contract.data;
  const canPay = data.availableActions?.includes('PAY');
  const snap = data.partiesSnapshot ?? {};

  return (
    <article className="profile-card contract-preview" aria-labelledby="pay-heading">
      <h1 id="pay-heading">테스트 결제</h1>
      <p className="form-field__hint" role="status">
        토스페이먼츠 샌드박스(또는 Fake PG)로만 결제합니다. 실제 대금이 청구·보관되지 않습니다.
      </p>

      <dl className="project-review" aria-label="결제 요약">
        <div>
          <dt>프로젝트명</dt>
          <dd>{data.projectTitle}</dd>
        </div>
        <div>
          <dt>의뢰인</dt>
          <dd>{snap.client?.name ?? '—'}</dd>
        </div>
        <div>
          <dt>프리랜서</dt>
          <dd>{snap.freelancer?.name ?? '—'}</dd>
        </div>
        <div>
          <dt>확정 계약 금액</dt>
          <dd>{formatWon(data.agreedAmount)}</dd>
        </div>
        <div>
          <dt>계약 상태</dt>
          <dd>{data.status}</dd>
        </div>
        <div>
          <dt>결제 상태</dt>
          <dd>{data.payment?.status ?? '미결제'}</dd>
        </div>
      </dl>

      {!canPay && (
        <p className="form-alert" role="status">
          {data.payment?.status === 'PAID'
            ? '이미 테스트 결제가 완료되었습니다.'
            : '지금 결제할 수 없는 계약 상태입니다. 양측 서명 완료·계약 대기 프로젝트인지 확인해 주세요.'}
        </p>
      )}

      {(pay.isError || localError) && (
        <p className="form-alert" role="alert">
          {localError ?? parseApiError(pay.error).message}
        </p>
      )}

      <div className="funnel-actions">
        <button
          type="button"
          className="button"
          disabled={!canPay || pay.isPending}
          onClick={() => pay.mutate()}
        >
          {pay.isPending ? '결제 준비 중…' : '테스트 카드 결제하기'}
        </button>
        <button type="button" className="button button--ghost" onClick={() => navigate(-1)}>
          돌아가기
        </button>
      </div>
    </article>
  );
}
