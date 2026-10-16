import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptApplication,
  fetchProjectApplications,
  projectApplicationsKey,
  proposeOffer,
  rejectApplication,
} from '../../lib/applicationApi.js';
import {
  APPLICATION_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  OWNER_REJECT_REASON_LABELS,
} from '../../lib/applicationForm.js';
import { parseApiError } from '../../lib/authApi.js';
import { formatWon } from '../../lib/profileForm.js';
import { ConfirmDialog } from '../ConfirmDialog.jsx';
import { formatDay, toKstDay } from '../../lib/projectForm.js';

const FILTERS = [
  { value: null, label: '전체', countKey: 'total' },
  { value: 'PENDING', label: APPLICATION_STATUS_LABELS.PENDING, countKey: 'PENDING' },
  { value: 'ACCEPTED', label: APPLICATION_STATUS_LABELS.ACCEPTED, countKey: 'ACCEPTED' },
  { value: 'REJECTED', label: APPLICATION_STATUS_LABELS.REJECTED, countKey: 'REJECTED' },
];

const CLOSED_NOTICES = {
  SCHEDULED: '모집 시작 전이라 아직 선정하거나 거절할 수 없습니다.',
  CLOSED: '모집이 마감되어 지원자를 선정하거나 거절할 수 없습니다.',
  CANCELLED:
    '취소된 프로젝트라 지원자를 선정하거나 거절할 수 없습니다. 기존 선정·거절 기록은 그대로 남습니다.',
};

function decisionNotice(projectStatus, acceptedCount) {
  if (projectStatus === 'CANCELLED') return CLOSED_NOTICES.CANCELLED;
  if (projectStatus === 'CONTRACTING') {
    return '지원자를 선정했습니다. 합의 금액을 제안한 뒤 프리랜서 동의를 기다립니다.';
  }
  if (acceptedCount > 0 || ['IN_PROGRESS', 'COMPLETED'].includes(projectStatus)) {
    return '지원자 선정이 끝났습니다. 계약 체결과 결제는 별도 단계에서 진행합니다.';
  }
  return CLOSED_NOTICES[projectStatus] ?? null;
}

function ApplicantStatus({ application }) {
  return (
    <span className="project-detail__badges">
      <span className={`status-badge application-badge--${application.status.toLowerCase()}`}>
        {APPLICATION_STATUS_LABELS[application.status] ?? application.status}
      </span>
      {application.offerStatus && (
        <span className="chip">
          {OFFER_STATUS_LABELS[application.offerStatus] ?? application.offerStatus}
        </span>
      )}
      {application.status === 'REJECTED' && application.rejectReason && (
        <span className="chip">
          {OWNER_REJECT_REASON_LABELS[application.rejectReason] ?? application.rejectReason}
        </span>
      )}
    </span>
  );
}

function ConfirmDecision({ type, application, otherPendingCount, pending, onCancel, onConfirm }) {
  const name = application.freelancer.name;
  const accepting = type === 'accept';
  return (
    <ConfirmDialog
      title={accepting ? `${name}님을 선정할까요?` : `${name}님의 지원을 거절할까요?`}
      confirmLabel={accepting ? '선정 확정' : '거절 확정'}
      pendingLabel={accepting ? '선정하는 중…' : '거절하는 중…'}
      danger={!accepting}
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {accepting ? (
        <>
          <p>이 지원자를 선정하면 다른 대기 지원은 자동으로 거절됩니다.</p>
          <p className="form-field__hint">
            지금 다른 대기 지원 {otherPendingCount}건 · 선정 후에는 되돌릴 수 없고 새 지원도 받지
            않습니다. 제안 금액은 계약 금액이 아니며, 계약 조건은 다음 단계에서 정합니다.
          </p>
        </>
      ) : (
        <p>거절하면 되돌릴 수 없으며, 지원자 화면에 &lsquo;거절됨&rsquo;으로 표시됩니다.</p>
      )}
    </ConfirmDialog>
  );
}

function ApplicantItem({ application, children, onAsk, busy }) {
  const { freelancer } = application;
  const profile = freelancer.freelancerProfile;
  const actions = application.availableActions ?? [];
  return (
    <li className="applicant-card">
      <div className="applicant-card__header">
        <Link
          to={`/users/${freelancer.id}`}
          className="applicant-card__name"
          aria-label={`${freelancer.name} 공개 프로필 보기`}
        >
          {freelancer.name}
        </Link>
        <ApplicantStatus application={application} />
      </div>
      {profile && (
        <p className="project-list__meta">
          경력 {profile.careerYears}년
          {profile.techStacks.length > 0 &&
            ` · ${profile.techStacks
              .slice(0, 5)
              .map((stack) => stack.name)
              .join(', ')}`}
        </p>
      )}
      <dl className="applicant-card__terms">
        <div>
          <dt>지원자 제안 금액</dt>
          <dd>{formatWon(application.proposedAmount)}</dd>
        </div>
        {application.offerAmount && (
          <div>
            <dt>의뢰인 합의 제안</dt>
            <dd>{formatWon(application.offerAmount)}</dd>
          </div>
        )}
        <div>
          <dt>예상 기간</dt>
          <dd>{application.proposedDurationDays.toLocaleString('ko-KR')}일</dd>
        </div>
        <div>
          <dt>지원일</dt>
          <dd>{formatDay(toKstDay(application.createdAt))}</dd>
        </div>
        {application.decidedAt && (
          <div>
            <dt>처리일</dt>
            <dd>{formatDay(toKstDay(application.decidedAt))}</dd>
          </div>
        )}
      </dl>
      <details className="application-item__letter">
        <summary>자기소개 보기</summary>
        <p className="project-detail__description">{application.coverLetter}</p>
      </details>
      {actions.length > 0 && (
        <div className="funnel-actions funnel-actions--start applicant-card__actions">
          {actions.includes('REJECT') && (
            <button
              type="button"
              className="button button--ghost"
              aria-label={`${freelancer.name} 거절`}
              disabled={busy}
              onClick={() => onAsk('reject')}
            >
              거절
            </button>
          )}
          {actions.includes('ACCEPT') && (
            <button
              type="button"
              className="button"
              aria-label={`${freelancer.name} 선정`}
              disabled={busy}
              onClick={() => onAsk('accept')}
            >
              선정
            </button>
          )}
          {actions.includes('PROPOSE_OFFER') && (
            <button
              type="button"
              className="button"
              aria-label={`${freelancer.name} 합의 금액 제안`}
              disabled={busy}
              onClick={() => onAsk('propose')}
            >
              합의 금액 제안
            </button>
          )}
        </div>
      )}
      {children}
    </li>
  );
}

function ProposeOfferDialog({ application, pending, onCancel, onConfirm }) {
  const [amount, setAmount] = useState(() => String(application.proposedAmount ?? ''));
  const [localError, setLocalError] = useState('');
  return (
    <ConfirmDialog
      title={`${application.freelancer.name}님에게 합의 금액을 제안할까요?`}
      confirmLabel="제안 전송"
      pendingLabel="제안하는 중…"
      pending={pending}
      onCancel={onCancel}
      onConfirm={() => {
        const trimmed = amount.trim().replace(/^0+(?=\d)/, '');
        if (!/^\d{1,30}$/.test(trimmed) || BigInt(trimmed) <= 0n) {
          setLocalError('합의 금액은 1원 이상의 정수로 입력해 주세요.');
          return;
        }
        setLocalError('');
        onConfirm(trimmed);
      }}
    >
      <p>한 번 제안한 금액은 바꿀 수 없습니다. 프리랜서가 동의하면 계약서가 만들어집니다.</p>
      <label className="form-field">
        <span className="form-field__label">합의 금액(원)</span>
        <input
          type="text"
          inputMode="numeric"
          className="form-field__input"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
          disabled={pending}
        />
        <span className="form-field__hint">
          기본값은 지원자 제안 금액 {formatWon(application.proposedAmount)}입니다.
        </span>
      </label>
      {localError && (
        <p className="form-alert" role="alert">
          {localError}
        </p>
      )}
    </ConfirmDialog>
  );
}

/**
 * 프로젝트 소유자에게만 보이는 지원자 관리(APP-02, DEC-01·02, A-31~33).
 * 선정·거절 가능 여부는 서버가 준 availableActions로만 정하고, 서버 성공 응답 뒤에만 결과를 보여 준다.
 */
export function ApplicantsPanel({ project }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(null);
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const scrolled = useRef(false);
  const listKey = projectApplicationsKey(project.id);

  const list = useQuery({
    queryKey: [...listKey, status ?? 'ALL', page],
    queryFn: () => fetchProjectApplications(project.id, { page, status }),
    staleTime: 0,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: ['project', String(project.id)] });
    queryClient.invalidateQueries({ queryKey: ['my-projects'] });
    queryClient.invalidateQueries({ queryKey: ['project-search'] });
  };

  const decide = useMutation({
    mutationFn: ({ type, application, offerAmount }) => {
      if (type === 'accept') return acceptApplication(application.id);
      if (type === 'propose') return proposeOffer(application.id, offerAmount);
      return rejectApplication(application.id);
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (data, { type, application }) => {
      const name = application.freelancer.name;
      setConfirming(null);
      if (type === 'accept') {
        setResult(
          `${name}님을 선정했습니다. 다른 대기 지원 ${data.autoRejectedCount}건은 자동으로 거절되었습니다.`,
        );
      } else if (type === 'propose') {
        setResult(
          `${name}님에게 합의 금액 ${formatWon(data.offerAmount)}을 제안했습니다. 프리랜서 동의를 기다립니다.`,
        );
      } else {
        setResult(`${name}님의 지원을 거절했습니다.`);
      }
      refreshAll();
    },
    onError: (mutationError) => {
      setConfirming(null);
      setError(parseApiError(mutationError).message);
      // 다른 탭·동시 요청으로 상태가 바뀌었을 수 있으니 서버 기준으로 다시 그린다.
      refreshAll();
    },
  });

  const hasData = Boolean(list.data);
  useEffect(() => {
    if (scrolled.current || !hasData || location.hash !== '#applicants') return;
    scrolled.current = true;
    document.getElementById('applicants')?.scrollIntoView?.({ block: 'start' });
  }, [hasData, location.hash]);

  const counts = list.data?.counts;
  const notice = counts ? decisionNotice(project.status, counts.ACCEPTED) : null;

  const ask = (type, application) => {
    setResult('');
    setError('');
    setConfirming({ type, id: application.id });
  };
  const confirm = (type, application, offerAmount) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    decide.mutate({ type, application, offerAmount });
  };

  let body;
  if (list.isPending) {
    body = <p className="page-status">지원자 목록을 불러오는 중…</p>;
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
    let emptyText = '이 상태의 지원이 없습니다.';
    if (page > 1) emptyText = '이 페이지에는 지원이 없습니다.';
    else if (counts.total === 0) emptyText = '아직 지원자가 없습니다.';
    body = <p className="page-status">{emptyText}</p>;
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <p className="form-field__hint">
          제안 금액은 지원자가 적은 예상 단가이며 최종 계약 금액이 아닙니다.
        </p>
        <ul className="applicant-list" aria-label="지원자 목록">
          {list.data.data.map((application) => {
            const open = confirming?.id === application.id ? confirming.type : null;
            return (
              <ApplicantItem
                key={application.id}
                application={application}
                busy={decide.isPending}
                onAsk={(type) => ask(type, application)}
              >
                {open === 'propose' && (
                  <ProposeOfferDialog
                    application={application}
                    pending={decide.isPending}
                    onCancel={() => setConfirming(null)}
                    onConfirm={(offerAmount) => confirm('propose', application, offerAmount)}
                  />
                )}
                {(open === 'accept' || open === 'reject') && (
                  <ConfirmDecision
                    type={open}
                    application={application}
                    otherPendingCount={Math.max(counts.PENDING - 1, 0)}
                    pending={decide.isPending}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => confirm(open, application)}
                  />
                )}
              </ApplicantItem>
            );
          })}
        </ul>
        {pagination.totalPages > 1 && (
          <nav className="pagination" aria-label="지원자 페이지">
            <button
              type="button"
              className="button button--small button--ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <span>
              {page} / {pagination.totalPages} 페이지
            </span>
            <button
              type="button"
              className="button button--small button--ghost"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </nav>
        )}
      </>
    );
  }

  return (
    <section
      id="applicants"
      className="profile-card applicants-panel"
      aria-labelledby="applicants-heading"
    >
      <h2 id="applicants-heading">지원자 관리</h2>
      {counts && (
        <p className="applicants-panel__summary">
          총 지원자 {counts.total}명 · 검토 대기 {counts.PENDING} · 선정 {counts.ACCEPTED} · 거절{' '}
          {counts.REJECTED}
        </p>
      )}
      <div className="applicants-panel__filters" role="group" aria-label="지원 상태 필터">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            className="button button--small button--ghost"
            aria-pressed={status === filter.value}
            onClick={() => {
              setStatus(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
            {counts && ` ${counts[filter.countKey]}`}
          </button>
        ))}
      </div>
      {notice && (
        <p className="completion completion--done applicants-panel__notice" role="status">
          {notice}
        </p>
      )}
      {result && (
        <p className="form-success" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {body}
    </section>
  );
}
