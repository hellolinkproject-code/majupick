import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BasicsFields,
  ScheduleFields,
  TechStackField,
} from '../components/project/ProjectFields.jsx';
import { NoticeCard, ProfileRequiredNotice } from '../components/project/ProjectBits.jsx';
import { fetchMe, parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { formatWon } from '../lib/profileForm.js';
import { createProject } from '../lib/projectApi.js';
import {
  clearProjectDraft,
  firstStepWithError,
  formatPeriod,
  loadProjectDraft,
  PROJECT_STEPS,
  saveProjectDraft,
  todayKst,
  toProjectPayload,
  validateBasics,
  validateSchedule,
  validateTechStacks,
} from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

const RETURN_TO = '/projects/new';
const STEP_VALIDATORS = [
  (form) => validateBasics(form),
  (form, today) => validateSchedule(form, today),
  (form) => validateTechStacks(form),
];

function StepIndicator({ current }) {
  return (
    <ol className="funnel-steps" aria-label="등록 단계">
      {PROJECT_STEPS.map((step, index) => (
        <li
          key={step.title}
          className={index === current ? 'funnel-steps__item is-current' : 'funnel-steps__item'}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="funnel-steps__number">{index + 1}</span>
          {step.title}
        </li>
      ))}
    </ol>
  );
}

function Review({ form, categories }) {
  const category = categories.find((option) => option.value === form.category)?.label;
  return (
    <dl className="project-review" aria-label="입력 내용 확인">
      <div>
        <dt>제목</dt>
        <dd>{form.title.trim()}</dd>
      </div>
      <div>
        <dt>카테고리</dt>
        <dd>{category ?? form.category}</dd>
      </div>
      <div>
        <dt>모집 기간</dt>
        <dd>{formatPeriod(form.recruitStartDate, form.recruitEndDate)}</dd>
      </div>
      <div>
        <dt>예산</dt>
        <dd>{formatWon(form.budget.trim())}</dd>
      </div>
    </dl>
  );
}

/**
 * 3단계 등록 퍼널(A-15). 단계를 오가도 입력값은 부모 상태와 탭 저장소에 남는다.
 * 등록 요청 키는 퍼널을 시작할 때 한 번 만들고 성공할 때까지 유지해 중복 등록을 막는다.
 */
function ProjectFunnel({ user, categories }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => loadProjectDraft(user.id));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [missingFields, setMissingFields] = useState(null);
  const headingRef = useRef(null);
  const today = todayKst();
  const { step, form } = draft;

  useEffect(() => {
    saveProjectDraft(user.id, draft);
  }, [user.id, draft]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const setField = (field, value) => {
    setFormError('');
    setDraft((prev) => ({ ...prev, form: { ...prev.form, [field]: value } }));
  };
  const goTo = (nextStep) => {
    setFormError('');
    setDraft((prev) => ({ ...prev, step: nextStep }));
  };

  const submit = useMutation({
    mutationFn: () => createProject(toProjectPayload(form), draft.idempotencyKey),
    onSuccess: (project) => {
      clearProjectDraft(user.id);
      queryClient.invalidateQueries({ queryKey: ['my-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-search'] });
      queryClient.setQueryData(['project', String(project.id)], project);
      navigate(`/projects/${project.id}`, {
        replace: true,
        state: { notice: '프로젝트를 등록했습니다.' },
      });
    },
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'PROFILE_INCOMPLETE') {
        setMissingFields(error.response.data.error.details?.missingFields ?? []);
        return;
      }
      if (apiError.code === 'VALIDATION_ERROR' && Object.keys(apiError.fields).length > 0) {
        setErrors(apiError.fields);
        const errorStep = firstStepWithError(apiError.fields);
        if (errorStep !== null) goTo(errorStep);
      }
      setFormError(apiError.message);
    },
  });

  function handleNext(event) {
    event.preventDefault();
    if (submit.isPending) return;
    const stepErrors = STEP_VALIDATORS[step](form, today);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      setFormError('입력한 내용을 확인해 주세요.');
      return;
    }
    if (step < PROJECT_STEPS.length - 1) {
      goTo(step + 1);
      return;
    }
    setFormError('');
    submit.mutate();
  }

  if (missingFields) {
    return <ProfileRequiredNotice missingFields={missingFields} returnTo={RETURN_TO} />;
  }

  const isLast = step === PROJECT_STEPS.length - 1;
  return (
    <form className="profile-card" onSubmit={handleNext} noValidate aria-label="프로젝트 등록">
      <StepIndicator current={step} />
      <h2 ref={headingRef} tabIndex={-1} className="funnel-title">
        {step + 1}단계 · {PROJECT_STEPS[step].title}
      </h2>

      {step === 0 && (
        <BasicsFields form={form} setField={setField} errors={errors} categories={categories} />
      )}
      {step === 1 && (
        <ScheduleFields form={form} setField={setField} errors={errors} today={today} />
      )}
      {step === 2 && (
        <>
          <TechStackField form={form} setField={setField} errors={errors} />
          <Review form={form} categories={categories} />
        </>
      )}

      {formError && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="funnel-actions">
        {step > 0 && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setErrors({});
              goTo(step - 1);
            }}
            disabled={submit.isPending}
          >
            이전
          </button>
        )}
        <button type="submit" className="button" disabled={submit.isPending}>
          {isLast ? (submit.isPending ? '등록하는 중…' : '프로젝트 등록') : '다음'}
        </button>
      </div>
    </form>
  );
}

/**
 * 프로젝트 등록 화면. 확인 순서는 서버와 같다: 로그인(RequireAuth) → 역할 → 의뢰인 → 필수 프로필.
 * 미완성 프로필이면 퍼널 대신 누락 항목과 프로필 입력 링크를 보여 준다(A-13).
 */
export function ProjectNewPage() {
  const sessionUser = useSessionStore((state) => state.user);
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 });
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });
  const user = me.data ?? sessionUser;

  if (!user) return <p className="page-status">사용자 정보를 불러오는 중…</p>;
  if (user.role !== 'CLIENT') {
    return (
      <NoticeCard title="프로젝트 등록은 의뢰인만 할 수 있습니다">
        <p>프리랜서 계정은 프로젝트를 등록할 수 없습니다. 등록된 프로젝트를 찾아 지원해 주세요.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  let body;
  if (!user.profileCompletion?.isComplete) {
    body = (
      <ProfileRequiredNotice
        missingFields={user.profileCompletion?.missingFields ?? []}
        returnTo={RETURN_TO}
      />
    );
  } else if (options.isPending) {
    body = <p className="page-status">선택 항목을 불러오는 중…</p>;
  } else if (options.isError) {
    body = (
      <div className="form-alert" role="alert">
        선택 항목을 불러오지 못했습니다.{' '}
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => options.refetch()}
        >
          다시 시도
        </button>
      </div>
    );
  } else {
    body = <ProjectFunnel user={user} categories={options.data.projectCategories} />;
  }

  return (
    <section className="project-page">
      <h1>프로젝트 등록</h1>
      {body}
    </section>
  );
}
