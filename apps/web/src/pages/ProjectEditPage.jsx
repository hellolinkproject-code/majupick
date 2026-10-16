import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AiEstimatePanel } from '../components/project/AiEstimatePanel.jsx';
import {
  BasicsFields,
  ScheduleFields,
  TechStackField,
} from '../components/project/ProjectFields.jsx';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { fetchProject, projectQueryKey, updateProject } from '../lib/projectApi.js';
import { diffProject, projectToForm, todayKst, validateProjectForm } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function EditForm({ project, categories, viewerId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => projectToForm(project));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const today = todayKst();

  const setField = (field, value) => {
    setFormError('');
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = useMutation({
    mutationFn: (changes) => updateProject(project.id, changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(projectQueryKey(updated.id, viewerId), updated);
      queryClient.invalidateQueries({ queryKey: ['my-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-search'] });
      navigate(`/projects/${updated.id}`, {
        replace: true,
        state: { notice: '프로젝트를 수정했습니다.' },
      });
    },
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'VALIDATION_ERROR') setErrors(apiError.fields);
      setFormError(apiError.message);
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors = validateProjectForm(form, today, project);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError('입력한 내용을 확인해 주세요.');
      return;
    }
    const changes = diffProject(form, project);
    if (Object.keys(changes).length === 0) {
      setFormError('변경한 내용이 없습니다.');
      return;
    }
    setFormError('');
    save.mutate(changes);
  }

  return (
    <form className="profile-card" onSubmit={handleSubmit} noValidate aria-label="프로젝트 수정">
      <h2>기본 정보</h2>
      <BasicsFields form={form} setField={setField} errors={errors} categories={categories} />
      <h2>일정·예산</h2>
      <ScheduleFields
        form={form}
        setField={setField}
        errors={errors}
        today={today}
        lockedFields={project.lockedFields}
      />
      <AiEstimatePanel
        form={form}
        setField={setField}
        budgetLocked={project.lockedFields?.includes('budget')}
      />
      <h2>기술 스택</h2>
      <TechStackField form={form} setField={setField} errors={errors} />

      {formError && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="funnel-actions">
        <Link to={`/projects/${project.id}`} className="button button--ghost">
          취소
        </Link>
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? '저장하는 중…' : '수정 내용 저장'}
        </button>
      </div>
    </form>
  );
}

/** PRJ-03 프로젝트 수정. 소유자이고 수정 가능한 상태일 때만 폼을 연다(최종 판단은 서버). */
export function ProjectEditPage() {
  const { projectId } = useParams();
  const viewerId = useSessionStore((state) => state.user?.id ?? null);
  const project = useQuery({
    queryKey: projectQueryKey(projectId, viewerId),
    queryFn: () => fetchProject(projectId),
    staleTime: 0,
  });
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });

  if (project.isPending || options.isPending) {
    return <p className="page-status">프로젝트를 불러오는 중…</p>;
  }
  if (project.isError || options.isError) {
    const error = parseApiError(project.error ?? options.error);
    return (
      <NoticeCard title="프로젝트를 불러오지 못했습니다">
        <p>{error.code === 'NOT_FOUND' ? '삭제되었거나 없는 프로젝트입니다.' : error.message}</p>
        <Link to="/me/projects">내 프로젝트로 돌아가기</Link>
      </NoticeCard>
    );
  }

  const data = project.data;
  if (!data.isOwner) {
    return (
      <NoticeCard title="수정 권한이 없습니다">
        <p>본인이 등록한 프로젝트만 수정할 수 있습니다.</p>
        <Link to={`/projects/${data.id}`}>프로젝트 상세로 돌아가기</Link>
      </NoticeCard>
    );
  }
  if (!data.availableActions.includes('EDIT')) {
    return (
      <NoticeCard title="수정할 수 없는 프로젝트입니다">
        <p>계약 단계에 들어갔거나 취소된 프로젝트는 수정할 수 없습니다.</p>
        <Link to={`/projects/${data.id}`}>프로젝트 상세로 돌아가기</Link>
      </NoticeCard>
    );
  }

  return (
    <section className="project-page">
      <h1>프로젝트 수정</h1>
      <EditForm
        key={data.updatedAt}
        project={data}
        categories={options.data.projectCategories}
        viewerId={viewerId}
      />
    </section>
  );
}
