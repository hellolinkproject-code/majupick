import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { fetchContract } from '../lib/applicationApi.js';
import { CONTRACT_STATUS_LABELS } from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/**
 * CTR-04 계약서 미리보기. 전자서명·결제는 STEP 09-B 이후.
 */
export function ContractPreviewPage() {
  const { contractId } = useParams();
  const userId = useSessionStore((state) => state.user?.id);
  const contract = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => fetchContract(contractId),
    enabled: Boolean(userId && contractId),
    staleTime: 0,
  });

  if (contract.isLoading || (!contract.data && !contract.isError)) {
    return <p className="page-status">계약서를 불러오는 중…</p>;
  }
  if (contract.isError) {
    return (
      <NoticeCard title="계약서를 불러올 수 없습니다">
        <p>{parseApiError(contract.error).message}</p>
        <Link to="/me/applications">내 지원 현황으로</Link>
      </NoticeCard>
    );
  }

  const data = contract.data;
  const snap = data.partiesSnapshot ?? {};
  const statusLabel = CONTRACT_STATUS_LABELS[data.status] ?? data.status;

  return (
    <article className="profile-card contract-preview" aria-labelledby="contract-heading">
      <h1 id="contract-heading">계약서 미리보기</h1>
      <p className="form-field__hint" role="status">
        양측 전자서명이 완료되기 전에는 계약이 체결된 것이 아닙니다. 결제·작업 시작은 이후 단계에서
        진행합니다.
      </p>

      <dl className="project-review" aria-label="계약 요약">
        <div>
          <dt>계약 상태</dt>
          <dd>
            <span className="status-badge">{statusLabel}</span>
            {!data.isFullySigned && <span className="chip">미체결</span>}
          </dd>
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
          <dd>{data.clientSignedAt ? formatDay(toKstDay(data.clientSignedAt)) : '대기'}</dd>
        </div>
        <div>
          <dt>프리랜서 서명</dt>
          <dd>{data.freelancerSignedAt ? formatDay(toKstDay(data.freelancerSignedAt)) : '대기'}</dd>
        </div>
      </dl>

      <section className="contract-preview__terms" aria-labelledby="terms-heading">
        <h2 id="terms-heading">계약 본문</h2>
        <pre className="contract-preview__body">{data.terms}</pre>
      </section>

      <div className="funnel-actions">
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
