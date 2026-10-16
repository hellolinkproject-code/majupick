import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { NoticeCard, StatusBadge } from '../components/project/ProjectBits.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { agreeOffer, declineOffer, fetchMyApplications } from '../lib/applicationApi.js';
import {
  APPLICATION_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  REJECT_REASON_LABELS,
} from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, formatPeriod, toKstDay } from '../lib/projectForm.js';
import { useFlashNotice } from '../lib/useFlashNotice.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function ApplicationStatusBadge({ status }) {
  return (
    <span className={`status-badge application-badge--${status.toLowerCase()}`}>
      {APPLICATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ApplicationItem({ application, busy, onRespond }) {
  const { project } = application;
  const actions = application.availableActions ?? [];
  return (
    <li className="project-list__item">
      <div className="project-detail__badges">
        <ApplicationStatusBadge status={application.status} />
        {application.offerStatus && (
          <span className="chip">
            {OFFER_STATUS_LABELS[application.offerStatus] ?? application.offerStatus}
          </span>
        )}
        <StatusBadge status={project.isCancelled ? 'CANCELLED' : project.publicStatus} />
        <span className="project-list__date">
          지원 {formatDay(toKstDay(application.createdAt))}
        </span>
      </div>
      {project.isDeleted ? (
        <p className="project-list__title application-item__deleted">
          {project.title} <span className="chip">삭제된 프로젝트</span>
        </p>
      ) : (
        <Link to={`/projects/${project.id}`} className="project-list__title">
          {project.title}
          {project.isCancelled && <span className="chip">취소된 프로젝트</span>}
        </Link>
      )}
      <p className="project-list__meta">
        예산 {formatWon(project.budget)} ·{' '}
        {formatPeriod(project.recruitStartDate, project.recruitEndDate)}
      </p>
      <p className="project-list__meta">
        내 제안 {formatWon(application.proposedAmount)} ·{' '}
        {application.proposedDurationDays.toLocaleString('ko-KR')}일
        {application.offerAmount && (
          <>
            {' '}
            · 의뢰인 합의 제안 <strong>{formatWon(application.offerAmount)}</strong>
          </>
        )}
      </p>
      {application.status === 'ACCEPTED' && (
        <p className="application-item__result application-item__result--accepted">
          의뢰인이 이 지원을 선정했습니다
          {application.decidedAt && ` (${formatDay(toKstDay(application.decidedAt))})`}.{' '}
          {project.isCancelled
            ? '이후 계약 체결 전에 프로젝트가 취소되어 계약이 진행되지 않습니다.'
            : application.offerStatus === 'PENDING'
              ? '합의 금액을 확인하고 동의하거나 거부해 주세요.'
              : application.offerStatus === 'AGREED'
                ? '금액에 동의했습니다. 계약서를 확인할 수 있습니다.'
                : '합의 금액 제안이 오면 동의·거부를 진행합니다.'}
        </p>
      )}
      {application.status === 'REJECTED' && application.rejectReason && (
        <p className="application-item__result">
          {REJECT_REASON_LABELS[application.rejectReason] ?? application.rejectReason}
          {application.decidedAt && ` (${formatDay(toKstDay(application.decidedAt))})`}
        </p>
      )}
      {project.isCancelled &&
        application.status === 'REJECTED' &&
        application.rejectReason !== 'PROJECT_CANCELLED' && (
          <p className="application-item__result">이후 의뢰인이 프로젝트를 취소했습니다.</p>
        )}
      {(actions.includes('AGREE_OFFER') || actions.includes('DECLINE_OFFER')) && (
        <div className="funnel-actions funnel-actions--start">
          {actions.includes('DECLINE_OFFER') && (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => onRespond('decline', application)}
            >
              금액 거부
            </button>
          )}
          {actions.includes('AGREE_OFFER') && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => onRespond('agree', application)}
            >
              금액 동의
            </button>
          )}
        </div>
      )}
      {application.contractId && (
        <p className="project-list__meta">
          <Link to={`/contracts/${application.contractId}`}>계약서 미리보기</Link>
        </p>
      )}
      <details className="application-item__letter">
        <summary>제출한 자기소개 보기</summary>
        <p className="project-detail__description">{application.coverLetter}</p>
      </details>
    </li>
  );
}

/**
 * APP-04 내 지원 현황 + STEP 09-A 금액 합의 응답.
 */
export function MyApplicationsPage() {
  const role = useSessionStore((state) => state.user?.role);
  const notice = useFlashNotice();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const inFlight = useRef(false);

  const list = useQuery({
    queryKey: ['my-applications', page],
    queryFn: () => fetchMyApplications(page),
    enabled: role === 'FREELANCER',
    staleTime: 0,
  });

  const respond = useMutation({
    mutationFn: ({ type, application }) =>
      type === 'agree' ? agreeOffer(application.id) : declineOffer(application.id),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (data, { type }) => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      if (type === 'agree') {
        setResult('금액에 동의했습니다. 계약서 미리보기로 이동합니다.');
        navigate(`/contracts/${data.id}`, { replace: false });
        return;
      }
      setResult(
        data.reopenedRecruiting
          ? '금액을 거부했습니다. 프로젝트는 다시 모집 중입니다.'
          : '금액을 거부했습니다. 모집 기간이 끝나 프로젝트가 마감되었습니다.',
      );
    },
    onError: (mutationError) => {
      setConfirming(null);
      setError(parseApiError(mutationError).message);
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
  });

  if (role !== 'FREELANCER') {
    return (
      <NoticeCard title="프리랜서 전용 화면입니다">
        <p>내 지원 현황은 프로젝트에 지원한 프리랜서 계정에서 볼 수 있습니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isLoading || (!list.data && !list.isError)) {
    body = <p className="page-status">내 지원 현황을 불러오는 중…</p>;
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
    body =
      page > 1 ? (
        <p className="page-status">이 페이지에는 지원이 없습니다.</p>
      ) : (
        <p className="page-status">
          아직 지원한 프로젝트가 없습니다. <Link to="/projects">프로젝트 찾아보기</Link>
        </p>
      );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 지원 목록">
          {list.data.data.map((application) => (
            <ApplicationItem
              key={application.id}
              application={application}
              busy={respond.isPending}
              onRespond={(type, item) => {
                setError('');
                setResult('');
                setConfirming({ type, application: item });
              }}
            />
          ))}
        </ul>
        {pagination.totalPages > 1 && (
          <nav className="pagination" aria-label="지원 페이지">
            <button
              type="button"
              className="button button--small button--ghost"
              disabled={page <= 1}
              onClick={() => setSearchParams({ page: String(page - 1) })}
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
              onClick={() => setSearchParams({ page: String(page + 1) })}
            >
              다음
            </button>
          </nav>
        )}
      </>
    );
  }

  return (
    <section className="page" aria-labelledby="my-applications-heading">
      <h1 id="my-applications-heading">내 지원 현황</h1>
      {notice && (
        <p className="form-success" role="status">
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
      {confirming && (
        <ConfirmDialog
          title={
            confirming.type === 'agree' ? '합의 금액에 동의할까요?' : '합의 금액을 거부할까요?'
          }
          confirmLabel={confirming.type === 'agree' ? '동의하고 계약서 만들기' : '거부 확정'}
          pendingLabel={confirming.type === 'agree' ? '처리하는 중…' : '거부하는 중…'}
          danger={confirming.type === 'decline'}
          pending={respond.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (inFlight.current) return;
            inFlight.current = true;
            respond.mutate(confirming);
          }}
        >
          {confirming.type === 'agree' ? (
            <p>
              합의 금액 {formatWon(confirming.application.offerAmount)}에 동의하면 계약서가 자동으로
              만들어집니다. 전자서명은 이후 단계에서 진행합니다.
            </p>
          ) : (
            <p>
              거부하면 이 선정은 결렬되고, 모집 기간이 남아 있으면 프로젝트가 다시 모집될 수
              있습니다.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
