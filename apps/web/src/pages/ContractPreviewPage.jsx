import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { ReviewForm } from '../components/review/ReviewForm.jsx';
import { ReviewCard } from '../components/review/ReviewList.jsx';
import {
  approveDelivery,
  createReview,
  fetchContract,
  fetchContractReviews,
  fetchSettlement,
  requestDelivery,
  signContract,
} from '../lib/applicationApi.js';
import {
  CONTRACT_DISPLAY_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  SIGNATURE_CONSENT_LABEL,
} from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function formatSignedAt(value) {
  return value ? formatDay(toKstDay(value)) : '대기';
}

/**
 * CTR-04·CTR-05 계약서 상세 + 체크박스 전자서명 + ESC 납품·승인·정산.
 * 과제용 동의 방식이며 외부 전자서명 인증 서비스를 쓰지 않는다.
 * 정산은 모의 에스크로이며 실제 송금이 없다.
 */
export function ContractPreviewPage() {
  const { contractId } = useParams();
  const userId = useSessionStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [signNotice, setSignNotice] = useState(null);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [flowNotice, setFlowNotice] = useState(null);

  const contract = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => fetchContract(contractId),
    enabled: Boolean(userId && contractId),
    staleTime: 0,
  });

  const settlement = useQuery({
    queryKey: ['settlement', contractId],
    queryFn: () => fetchSettlement(contractId),
    enabled: Boolean(
      userId &&
      contractId &&
      contract.data?.payment?.status === 'PAID' &&
      (contract.data?.status === 'DELIVERY_REQUESTED' ||
        contract.data?.status === 'COMPLETED' ||
        contract.data?.workStartedAt),
    ),
    staleTime: 0,
  });

  const reviews = useQuery({
    queryKey: ['contract-reviews', contractId],
    queryFn: () => fetchContractReviews(contractId),
    enabled: Boolean(userId && contractId && contract.data?.status === 'COMPLETED'),
    staleTime: 0,
  });

  const meta = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });

  const sign = useMutation({
    mutationFn: () => signContract(contractId),
    onSuccess: (data) => {
      setAgreed(false);
      queryClient.setQueryData(['contract', contractId], data);
      queryClient.invalidateQueries({ queryKey: ['my-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['my-projects'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      setSignNotice(
        data.isFullySigned
          ? '양측 전자서명이 완료되어 계약이 체결되었습니다. 결제는 다음 단계에서 진행합니다.'
          : '전자서명을 완료했습니다. 상대방 서명을 기다리는 중입니다.',
      );
    },
  });

  const deliver = useMutation({
    mutationFn: () =>
      requestDelivery(contractId, {
        note: deliveryNote.trim(),
        url: deliveryUrl.trim() || undefined,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['contract', contractId], data);
      queryClient.invalidateQueries({ queryKey: ['settlement', contractId] });
      queryClient.invalidateQueries({ queryKey: ['my-contracts'] });
      setDeliveryNote('');
      setDeliveryUrl('');
      setFlowNotice('납품을 요청했습니다. 의뢰인의 완료 승인을 기다립니다.');
    },
  });

  const approve = useMutation({
    mutationFn: () => approveDelivery(contractId),
    onSuccess: (data) => {
      queryClient.setQueryData(['contract', contractId], data.contract);
      queryClient.setQueryData(['settlement', contractId], data.settlement);
      queryClient.invalidateQueries({ queryKey: ['my-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['my-projects'] });
      queryClient.invalidateQueries({ queryKey: ['my-payments'] });
      queryClient.invalidateQueries({ queryKey: ['contract-reviews', contractId] });
      setFlowNotice(
        `완료 승인되었습니다. 모의 정산: 수수료 ${formatWon(data.settlement.feeAmount)} / 지급액 ${formatWon(data.settlement.payoutAmount)} (실제 송금 없음)`,
      );
    },
  });

  const review = useMutation({
    mutationFn: (payload) => createReview(contractId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['contract-reviews', contractId], (prev) => ({
        myReview: data,
        counterpartReview: prev?.counterpartReview ?? null,
      }));
      queryClient.setQueryData(['contract', contractId], (prev) =>
        prev
          ? {
              ...prev,
              availableActions: (prev.availableActions ?? []).filter(
                (action) => action !== 'WRITE_REVIEW',
              ),
              hasWrittenReview: true,
            }
          : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({
        queryKey: ['public-reviews', data.revieweeId],
      });
      queryClient.invalidateQueries({ queryKey: ['public-profile', String(data.revieweeId)] });
      setFlowNotice('리뷰를 작성했습니다. 작성한 리뷰는 수정할 수 없습니다.');
    },
  });

  if (contract.isLoading || (!contract.data && !contract.isError)) {
    return <p className="page-status">계약서를 불러오는 중…</p>;
  }
  if (contract.isError) {
    return (
      <NoticeCard title="계약서를 불러올 수 없습니다">
        <p>{parseApiError(contract.error).message}</p>
        <Link to="/me/contracts">내 계약으로</Link>
      </NoticeCard>
    );
  }

  const data = contract.data;
  const snap = data.partiesSnapshot ?? {};
  const statusLabel = CONTRACT_STATUS_LABELS[data.status] ?? data.status;
  const displayLabel =
    CONTRACT_DISPLAY_STATUS_LABELS[data.displayStatus] ??
    CONTRACT_DISPLAY_STATUS_LABELS[data.status] ??
    statusLabel;
  const canSign = data.availableActions?.includes('SIGN');
  const canPay = data.availableActions?.includes('PAY');
  const canRequestDelivery = data.availableActions?.includes('REQUEST_DELIVERY');
  const canApprove = data.availableActions?.includes('APPROVE');
  const canWriteReview = data.availableActions?.includes('WRITE_REVIEW');
  const myReview = reviews.data?.myReview ?? null;
  const reviewTags =
    data.viewerRole === 'CLIENT'
      ? (meta.data?.reviewTags?.forFreelancer ?? [])
      : data.viewerRole === 'FREELANCER'
        ? (meta.data?.reviewTags?.forClient ?? [])
        : [];
  const waitingOther =
    data.status === 'SIGNATURE_PENDING' &&
    !canSign &&
    ((data.viewerRole === 'CLIENT' && data.clientSignedAt && !data.freelancerSignedAt) ||
      (data.viewerRole === 'FREELANCER' && data.freelancerSignedAt && !data.clientSignedAt));
  const settlementData = settlement.data;
  const delivery = data.delivery;

  return (
    <article className="profile-card contract-preview" aria-labelledby="contract-heading">
      <h1 id="contract-heading">계약서</h1>
      <p className="form-field__hint" role="status">
        이 화면의 전자서명은 계약 내용 확인 후 체크박스에 동의하는 방식입니다. 양측 서명이 끝나야
        계약이 체결되며, 결제·납품·정산은 이후 단계에서 진행합니다. 정산은 모의 에스크로이며 실제
        송금은 없습니다.
      </p>

      {signNotice && (
        <p className="form-success" role="status">
          {signNotice}
        </p>
      )}
      {flowNotice && (
        <p className="form-success" role="status">
          {flowNotice}
        </p>
      )}

      <dl className="project-review" aria-label="계약 요약">
        <div>
          <dt>계약 상태</dt>
          <dd>
            <span className="status-badge">{statusLabel}</span>
            {data.isFullySigned ? (
              <span className="chip">계약 체결 완료</span>
            ) : (
              <span className="chip">미체결</span>
            )}
          </dd>
        </div>
        <div>
          <dt>진행 안내</dt>
          <dd>{displayLabel}</dd>
        </div>
        <div>
          <dt>프로젝트명</dt>
          <dd>{data.projectTitle}</dd>
        </div>
        <div>
          <dt>의뢰인</dt>
          <dd>
            {snap.client?.name ?? '—'}
            {snap.client?.companyName ? ` · ${snap.client.companyName}` : ''}
          </dd>
        </div>
        <div>
          <dt>프리랜서</dt>
          <dd>{snap.freelancer?.name ?? '—'}</dd>
        </div>
        <div>
          <dt>합의 금액</dt>
          <dd>{formatWon(data.agreedAmount)}</dd>
        </div>
        <div>
          <dt>계약 기간</dt>
          <dd>{data.durationDays.toLocaleString('ko-KR')}일</dd>
        </div>
        <div>
          <dt>생성일</dt>
          <dd>{formatDay(toKstDay(data.createdAt))}</dd>
        </div>
        <div>
          <dt>의뢰인 서명</dt>
          <dd>{formatSignedAt(data.clientSignedAt)}</dd>
        </div>
        <div>
          <dt>프리랜서 서명</dt>
          <dd>{formatSignedAt(data.freelancerSignedAt)}</dd>
        </div>
        {data.signedAt && (
          <div>
            <dt>체결 시각</dt>
            <dd>{formatSignedAt(data.signedAt)}</dd>
          </div>
        )}
        {data.workStartedAt && (
          <div>
            <dt>작업 시작</dt>
            <dd>{formatSignedAt(data.workStartedAt)}</dd>
          </div>
        )}
        {data.completedAt && (
          <div>
            <dt>완료 승인</dt>
            <dd>{formatSignedAt(data.completedAt)}</dd>
          </div>
        )}
      </dl>

      <section className="contract-preview__terms" aria-labelledby="terms-heading">
        <h2 id="terms-heading">계약 본문</h2>
        <pre className="contract-preview__body">{data.terms}</pre>
      </section>

      {data.status === 'CANCELLED' && (
        <p className="form-alert" role="status">
          이 계약은 취소되어 더 이상 서명할 수 없습니다. 기록은 그대로 보관됩니다.
        </p>
      )}

      {data.isFullySigned && !data.payment && (
        <p className="form-success" role="status">
          계약 체결이 완료되었습니다. 아직 결제가 완료되지 않았으므로 작업은 시작되지 않습니다.
        </p>
      )}

      {data.payment?.status === 'PAID' && (
        <p className="form-success" role="status">
          {data.payment.escrowNote ?? '테스트 결제 완료 / 에스크로 보관 시뮬레이션'}
          {data.projectStatus === 'IN_PROGRESS' ? ' · 프로젝트는 작업 중입니다.' : ''}
          {data.projectStatus === 'COMPLETED' ? ' · 프로젝트가 완료되었습니다.' : ''}
        </p>
      )}

      {delivery?.requestedAt && (
        <section className="contract-preview__delivery" aria-labelledby="delivery-info-heading">
          <h2 id="delivery-info-heading">납품 정보</h2>
          <dl className="project-review">
            <div>
              <dt>납품 메모</dt>
              <dd>{delivery.note ?? '—'}</dd>
            </div>
            {delivery.url && (
              <div>
                <dt>납품 링크</dt>
                <dd>
                  <a href={delivery.url} target="_blank" rel="noreferrer">
                    {delivery.url}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>요청 시각</dt>
              <dd>{formatSignedAt(delivery.requestedAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {settlementData && (
        <section className="contract-preview__settlement" aria-labelledby="settlement-heading">
          <h2 id="settlement-heading">정산 정보 (모의)</h2>
          <p className="form-field__hint">
            플랫폼 수수료 10%(버림). 실제 계좌 이체·송금은 수행하지 않습니다.
          </p>
          <dl className="project-review" aria-label="정산 금액">
            <div>
              <dt>결제액</dt>
              <dd>{formatWon(settlementData.amount)}</dd>
            </div>
            <div>
              <dt>수수료 (10%)</dt>
              <dd>{formatWon(settlementData.feeAmount)}</dd>
            </div>
            <div>
              <dt>프리랜서 지급액</dt>
              <dd>{formatWon(settlementData.payoutAmount)}</dd>
            </div>
            <div>
              <dt>에스크로</dt>
              <dd>
                {settlementData.escrowStatus === 'RELEASED'
                  ? '모의 지급 처리됨 (RELEASED)'
                  : '보관 시뮬레이션 (HELD)'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {waitingOther && (
        <p className="form-field__hint" role="status">
          상대방 서명 대기 중입니다. 이미 서명하셨으므로 다시 서명할 수 없습니다.
        </p>
      )}

      {canSign && (
        <section className="contract-preview__sign" aria-labelledby="sign-heading">
          <h2 id="sign-heading">전자서명</h2>
          <label className="form-field form-field--checkbox">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              disabled={sign.isPending}
            />
            <span>{SIGNATURE_CONSENT_LABEL}</span>
          </label>
          {sign.isError && (
            <p className="form-alert" role="alert">
              {parseApiError(sign.error).message}
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={!agreed || sign.isPending}
            onClick={() => sign.mutate()}
          >
            {sign.isPending ? '서명 처리 중…' : '전자서명 완료'}
          </button>
        </section>
      )}

      {canRequestDelivery && (
        <section className="contract-preview__deliver" aria-labelledby="deliver-heading">
          <h2 id="deliver-heading">납품 요청</h2>
          <p className="form-field__hint">
            작업 완료 후 납품을 요청합니다. 요청은 1회만 가능합니다.
          </p>
          <label className="form-field">
            <span>납품 메모</span>
            <textarea
              value={deliveryNote}
              onChange={(event) => setDeliveryNote(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={deliver.isPending}
              required
            />
          </label>
          <label className="form-field">
            <span>납품 링크 (선택)</span>
            <input
              type="url"
              value={deliveryUrl}
              onChange={(event) => setDeliveryUrl(event.target.value)}
              placeholder="https://"
              disabled={deliver.isPending}
            />
          </label>
          {deliver.isError && (
            <p className="form-alert" role="alert">
              {parseApiError(deliver.error).message}
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={!deliveryNote.trim() || deliver.isPending}
            onClick={() => deliver.mutate()}
          >
            {deliver.isPending ? '요청 중…' : '납품 요청하기'}
          </button>
        </section>
      )}

      {canApprove && (
        <section className="contract-preview__approve" aria-labelledby="approve-heading">
          <h2 id="approve-heading">완료 승인</h2>
          <p className="form-field__hint">
            납품물을 확인한 뒤 완료를 승인하면 모의 에스크로가 지급 처리(RELEASED)되고 프로젝트가
            완료됩니다. 실제 송금은 없습니다.
          </p>
          {approve.isError && (
            <p className="form-alert" role="alert">
              {parseApiError(approve.error).message}
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={approve.isPending}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? '승인 처리 중…' : '완료 승인 및 모의 정산'}
          </button>
        </section>
      )}

      {canWriteReview && (
        <ReviewForm
          tags={reviewTags}
          pending={review.isPending}
          error={review.isError ? parseApiError(review.error).message : ''}
          onSubmit={(payload) => review.mutate(payload)}
        />
      )}

      {myReview && !canWriteReview && <ReviewCard review={myReview} />}

      <div className="funnel-actions">
        {canPay && (
          <Link to={`/contracts/${contractId}/pay`} className="button">
            테스트 결제하기
          </Link>
        )}
        <Link to="/me/contracts" className="button button--ghost">
          내 계약
        </Link>
        <Link to="/me/payments" className="button button--ghost">
          내 결제
        </Link>
        <Link to="/me/applications" className="button button--ghost">
          내 지원 현황
        </Link>
        <Link to="/me/projects" className="button button--ghost">
          내 프로젝트
        </Link>
      </div>
    </article>
  );
}
