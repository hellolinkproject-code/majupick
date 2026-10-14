import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormField, TextAreaField } from '../FormField.jsx';
import { ProfileRequiredNotice } from '../project/ProjectBits.jsx';
import { applyToProject } from '../../lib/applicationApi.js';
import {
  APPLICATION_LIMITS,
  APPLICATION_STATUS_LABELS,
  emptyApplicationForm,
  REJECT_REASON_LABELS,
  toApplicationPayload,
  validateApplicationForm,
} from '../../lib/applicationForm.js';
import { parseApiError } from '../../lib/authApi.js';
import { formatWon } from '../../lib/profileForm.js';
import { formatDay, toKstDay } from '../../lib/projectForm.js';
import { loginPathFor } from '../../lib/returnTo.js';
import { useSessionStore } from '../../stores/useSessionStore.js';

/** 서버가 상태 때문에 거절했으면 상세를 다시 불러와 지금 상태(지원 완료·마감)를 보여 준다. */
const REFRESH_ON = new Set(['ALREADY_APPLIED', 'INVALID_STATE_TRANSITION', 'NOT_FOUND']);

function Panel({ children }) {
  return (
    <section className="profile-card apply-panel" aria-labelledby="apply-heading">
      <h2 id="apply-heading">프로젝트 지원</h2>
      {children}
    </section>
  );
}

function AppliedState({ application, cancelled }) {
  return (
    <div className="completion completion--done" role="status">
      <strong>이 프로젝트에 지원했습니다.</strong>
      <span>
        지원 상태: {APPLICATION_STATUS_LABELS[application.status] ?? application.status} · 지원일{' '}
        {formatDay(toKstDay(application.createdAt))}
      </span>
      {application.status === 'REJECTED' && application.rejectReason && (
        <span>{REJECT_REASON_LABELS[application.rejectReason] ?? application.rejectReason}</span>
      )}
      {application.status === 'ACCEPTED' &&
        (cancelled ? (
          <span>
            의뢰인이 이 지원을 선정했지만, 계약 체결 전에 프로젝트가 취소되어 계약이 진행되지
            않습니다.
          </span>
        ) : (
          <span>의뢰인이 이 지원을 선정했습니다.</span>
        ))}
      <span>
        <Link to="/me/applications">내 지원 현황 보기</Link>
      </span>
    </div>
  );
}

function NotRecruiting({ project }) {
  let message = '모집이 마감되어 지원할 수 없습니다.';
  if (project.isCancelled) message = '취소된 프로젝트라 지원할 수 없습니다.';
  else if (project.publicStatus === 'SCHEDULED') {
    message = `모집 시작 전입니다. ${formatDay(project.recruitStartDate)}부터 지원할 수 있습니다.`;
  }
  return (
    <p className="apply-panel__closed" role="status">
      {message}
    </p>
  );
}

function ApplicationFields({ form, setField, errors }) {
  const amountText = formatWon(form.proposedAmount.trim());
  return (
    <>
      <TextAreaField
        id="coverLetter"
        label="자기소개"
        required
        rows={6}
        maxLength={APPLICATION_LIMITS.coverLetter}
        placeholder="관련 경험, 작업 방식, 이 프로젝트에 맞는 이유를 적어 주세요."
        hint={`${form.coverLetter.length.toLocaleString('ko-KR')} / ${APPLICATION_LIMITS.coverLetter.toLocaleString('ko-KR')}자`}
        value={form.coverLetter}
        onChange={(event) => setField('coverLetter', event.target.value)}
        error={errors.coverLetter}
      />
      <div className="form-row">
        <FormField
          id="proposedAmount"
          label="예상 단가(원)"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="예: 2500000"
          hint={amountText ? `= ${amountText}` : '숫자만 입력해 주세요.'}
          value={form.proposedAmount}
          onChange={(event) => setField('proposedAmount', event.target.value.replace(/[^\d]/g, ''))}
          error={errors.proposedAmount}
        />
        <FormField
          id="proposedDurationDays"
          label="예상 기간(일)"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="예: 30"
          hint={`1~${APPLICATION_LIMITS.durationDays.toLocaleString('ko-KR')}일`}
          value={form.proposedDurationDays}
          onChange={(event) =>
            setField('proposedDurationDays', event.target.value.replace(/[^\d]/g, ''))
          }
          error={errors.proposedDurationDays}
        />
      </div>
    </>
  );
}

/**
 * 프로젝트 상세의 지원 영역(A-29). 화면은 안내일 뿐이고 권한·모집 상태·중복은 서버(APP-01)가 판단한다.
 * 입력 → 확인 → 제출 순서이며, 제출 성공 응답을 받은 뒤에만 내 지원 현황으로 이동한다(A-30).
 */
export function ApplyPanel({ project }) {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState('idle');
  const [form, setForm] = useState(emptyApplicationForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [missingFields, setMissingFields] = useState(null);
  const inFlight = useRef(false);
  const projectKey = ['project', String(project.id)];

  const submit = useMutation({
    mutationFn: () => applyToProject(project.id, toApplicationPayload(form)),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKey });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      queryClient.invalidateQueries({ queryKey: ['project-search'] });
      navigate('/me/applications', {
        state: { notice: `"${project.title}"에 지원했습니다.` },
      });
    },
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'PROFILE_INCOMPLETE') {
        setMissingFields(error.response?.data?.error?.details?.missingFields ?? []);
        return;
      }
      if (apiError.code === 'VALIDATION_ERROR' && Object.keys(apiError.fields).length > 0) {
        setErrors(apiError.fields);
        setStage('editing');
      }
      if (REFRESH_ON.has(apiError.code)) {
        setStage('idle');
        queryClient.invalidateQueries({ queryKey: projectKey });
      }
      setFormError(apiError.message);
    },
  });

  if (project.isOwner) return null;

  if (status !== 'authenticated' || !user) {
    if (status === 'idle' || status === 'restoring') return null;
    return (
      <Panel>
        {project.publicStatus === 'RECRUITING' ? (
          <p>
            프리랜서로 로그인하면 이 프로젝트에 지원할 수 있습니다.{' '}
            <Link to={loginPathFor(location)} className="button button--small">
              로그인하고 지원하기
            </Link>
          </p>
        ) : (
          <NotRecruiting project={project} />
        )}
      </Panel>
    );
  }

  if (user.role !== 'FREELANCER') return null;

  if (project.myApplication) {
    return (
      <Panel>
        <AppliedState application={project.myApplication} cancelled={project.isCancelled} />
      </Panel>
    );
  }

  const returnTo = `/projects/${project.id}`;
  const incomplete =
    missingFields ??
    (user.profileCompletion?.isComplete === false ? user.profileCompletion.missingFields : null);

  let body;
  if (project.publicStatus !== 'RECRUITING') {
    body = <NotRecruiting project={project} />;
  } else if (incomplete) {
    body = (
      <ProfileRequiredNotice action="지원하려면" missingFields={incomplete} returnTo={returnTo} />
    );
  } else if (stage === 'idle') {
    body = (
      <div className="apply-panel__start">
        <p>자기소개, 예상 단가, 예상 기간을 입력해 지원합니다.</p>
        <button type="button" className="button" onClick={() => setStage('editing')}>
          지원하기
        </button>
      </div>
    );
  } else if (stage === 'editing') {
    body = (
      <form
        noValidate
        aria-label="지원서 작성"
        onSubmit={(event) => {
          event.preventDefault();
          const nextErrors = validateApplicationForm(form);
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length > 0) {
            setFormError('입력한 내용을 확인해 주세요.');
            return;
          }
          setFormError('');
          setStage('confirming');
        }}
      >
        <ApplicationFields
          form={form}
          errors={errors}
          setField={(field, value) => {
            setFormError('');
            setForm((prev) => ({ ...prev, [field]: value }));
            // 고친 항목의 오류는 바로 지운다. 다시 검사는 "다음"을 누를 때 한다.
            setErrors((prev) => {
              if (!prev[field]) return prev;
              const { [field]: _fixed, ...rest } = prev;
              return rest;
            });
          }}
        />
        <div className="funnel-actions">
          <button type="button" className="button button--ghost" onClick={() => setStage('idle')}>
            취소
          </button>
          <button type="submit" className="button">
            다음
          </button>
        </div>
      </form>
    );
  } else {
    const payload = toApplicationPayload(form);
    body = (
      <div className="apply-panel__confirm" role="group" aria-labelledby="apply-confirm-title">
        <p id="apply-confirm-title">
          <strong>이 내용으로 지원할까요?</strong> 제출한 지원서는 수정하거나 철회할 수 없습니다.
        </p>
        <dl className="project-review">
          <dt>예상 단가</dt>
          <dd>{formatWon(payload.proposedAmount)}</dd>
          <dt>예상 기간</dt>
          <dd>{payload.proposedDurationDays.toLocaleString('ko-KR')}일</dd>
          <dt>자기소개</dt>
          <dd className="project-detail__description">{payload.coverLetter}</dd>
        </dl>
        <div className="funnel-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setStage('editing')}
            disabled={submit.isPending}
          >
            수정하기
          </button>
          <button
            type="button"
            className="button"
            disabled={submit.isPending}
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              setFormError('');
              submit.mutate();
            }}
          >
            {submit.isPending ? '지원하는 중…' : '지원 확정'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Panel>
      {formError && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      {body}
    </Panel>
  );
}
