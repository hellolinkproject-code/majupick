import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { fetchContract, signContract } from '../lib/applicationApi.js';
import {
  CONTRACT_DISPLAY_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  SIGNATURE_CONSENT_LABEL,
} from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function formatSignedAt(value) {
  return value ? formatDay(toKstDay(value)) : '대기';
}

/**
 * CTR-04·CTR-05 계약서 상세 + 체크박스 전자서명.
 * 과제용 동의 방식이며 외부 전자서명 인증 서비스를 쓰지 않는다.
 */
export function ContractPreviewPage() {
  const { contractId } = useParams();
  const userId = useSessionStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [signNotice, setSignNotice] = useState(null);

  const contract = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => fetchContract(contractId),
    enabled: Boolean(userId && contractId),
    staleTime: 0,
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
  const waitingOther =
    data.status === 'SIGNATURE_PENDING' &&
    !canSign &&
    ((data.viewerRole === 'CLIENT' && data.clientSignedAt && !data.freelancerSignedAt) ||
      (data.viewerRole === 'FREELANCER' && data.freelancerSignedAt && !data.clientSignedAt));

  return (
    <article className="profile-card contract-preview" aria-labelledby="contract-heading">
      <h1 id="contract-heading">계약서</h1>
      <p className="form-field__hint" role="status">
        이 화면의 전자서명은 계약 내용 확인 후 체크박스에 동의하는 방식입니다. 양측 서명이 끝나야
        계약이 체결되며, 결제·작업 시작은 이후 단계에서 진행합니다.
      </p>

      {signNotice && (
        <p className="form-success" role="status">
          {signNotice}
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

      {data.isFullySigned && (
        <p className="form-success" role="status">
          계약 체결이 완료되었습니다. 아직 결제가 완료되지 않았으므로 작업은 시작되지 않습니다.
        </p>
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

      <div className="funnel-actions">
        <Link to="/me/contracts" className="button button--ghost">
          내 계약
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
