import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApplicantsPanel } from '../components/application/ApplicantsPanel.jsx';
import { ApplyPanel } from '../components/application/ApplyPanel.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { BookmarkButton } from '../components/project/BookmarkButton.jsx';
import { CancelProjectControl } from '../components/project/CancelProjectControl.jsx';
import { CloseRecruitControl } from '../components/project/CloseRecruitControl.jsx';
import { NoticeCard, StatusBadge } from '../components/project/ProjectBits.jsx';
import { RecommendedProjects } from '../components/project/RecommendedProjects.jsx';
import { parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { formatWon } from '../lib/profileForm.js';
import { deleteProject, fetchProject, projectQueryKey } from '../lib/projectApi.js';
import { formatDay, formatPeriod, toKstDay } from '../lib/projectForm.js';
import { useFlashNotice } from '../lib/useFlashNotice.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/** 삭제는 되돌릴 수 없으므로 한 번 더 확인한다(D-50). 실제로는 소프트 삭제(D-53). */
function DeleteControl({ project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['project', String(project.id)] });
      queryClient.invalidateQueries({ queryKey: ['my-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-search'] });
      navigate('/me/projects', { replace: true, state: { notice: '프로젝트를 삭제했습니다.' } });
    },
  });

  return (
    <>
      <button
        type="button"
        className="button button--danger"
        onClick={() => {
          remove.reset();
          setConfirming(true);
        }}
      >
        삭제
      </button>
      {confirming && (
        <ConfirmDialog
          title="이 프로젝트를 삭제할까요?"
          confirmLabel="삭제 확인"
          pendingLabel="삭제하는 중…"
          danger
          pending={remove.isPending}
          error={remove.isError ? parseApiError(remove.error).message : ''}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate()}
        >
          <p>삭제하면 목록과 상세 화면에서 보이지 않습니다.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** 소유자는 7개 상태, 취소된 프로젝트를 보는 지원자는 '취소', 그 밖에는 공개 상태(3개). */
function badgeStatusOf(project) {
  if (project.isOwner) return project.status;
  return project.isCancelled ? 'CANCELLED' : project.publicStatus;
}

/** 소유자에게 동작이 없을 때의 안내. 취소·거래 단계를 구분한다. */
function ownerLockedMessage(status) {
  if (status === 'CANCELLED') {
    return '취소된 프로젝트입니다. 수정·삭제·모집 마감·지원자 선정을 할 수 없습니다.';
  }
  return '계약이 체결된 프로젝트는 수정·삭제·취소할 수 없습니다. 정상 완료 또는 환불 절차를 거쳐야 합니다.';
}

/**
 * PRJ-02 프로젝트 상세. 소유자에게만 7개 상태·지원자 관리·모집 마감·수정·삭제를, 프리랜서에게는 지원 영역을 보여 준다.
 */
export function ProjectDetailPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const notice = useFlashNotice();
  const [closeNotice, setCloseNotice] = useState(null);
  const sessionStatus = useSessionStore((state) => state.status);
  const viewerId = useSessionStore((state) => state.user?.id ?? null);
  const sessionSettled = sessionStatus !== 'idle' && sessionStatus !== 'restoring';
  const project = useQuery({
    queryKey: projectQueryKey(projectId, viewerId),
    queryFn: () => fetchProject(projectId),
    staleTime: 0,
    // 새로고침 직후 토큰 복원 전에 요청하면 비로그인 응답(소유자 정보·지원 여부 없음)이 남는다.
    enabled: sessionSettled,
  });
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });

  // 하단 추천 카드로 다른 프로젝트에 가면 같은 화면이 재사용되므로 맨 위부터 보여 준다.
  const shownProjectId = useRef(projectId);
  useEffect(() => {
    if (shownProjectId.current === projectId) return;
    shownProjectId.current = projectId;
    window.scrollTo(0, 0);
  }, [projectId]);

  // RQ v5: enabled=false여도 isPending은 true라 세션 대기와 혼동된다.
  // 세션 복원 전·실제 요청 중·아직 data 없음은 로딩, 그다음에 오류를 본다.
  if (!sessionSettled || project.isLoading || (!project.data && !project.isError)) {
    return <p className="page-status">프로젝트를 불러오는 중…</p>;
  }
  if (project.isError) {
    const error = parseApiError(project.error);
    return (
      <NoticeCard
        title={
          error.code === 'NOT_FOUND'
            ? '프로젝트를 찾을 수 없습니다'
            : '프로젝트를 불러오지 못했습니다'
        }
      >
        <p>{error.code === 'NOT_FOUND' ? '삭제되었거나 없는 프로젝트입니다.' : error.message}</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  const data = project.data;
  const from = location.state?.from;
  const fromSearch = typeof from === 'string' && /^\/projects(\?|$)/.test(from);
  const categoryLabelOf = (value) =>
    options.data?.projectCategories.find((option) => option.value === value)?.label ?? value;
  const category = categoryLabelOf(data.category);
  const actions = data.availableActions ?? [];

  return (
    <article className="project-page">
      <p className="project-detail__nav">
        <Link to={fromSearch ? from : '/projects'}>
          {fromSearch ? '← 검색 결과로 돌아가기' : '← 프로젝트 찾기'}
        </Link>
      </p>
      {(closeNotice ?? notice) && (
        <p className="form-success" role="status">
          {closeNotice ?? notice}
        </p>
      )}
      <header className="project-detail__header">
        <div className="project-detail__badges">
          <StatusBadge status={badgeStatusOf(data)} />
          <span className="chip">{category}</span>
        </div>
        {data.isCancelled && (
          <p className="completion project-detail__cancelled" role="status">
            {data.isOwner ? '' : '의뢰인이 '}계약 체결 전에 이 프로젝트를 취소했습니다
            {data.cancelledAt && ` (${formatDay(toKstDay(data.cancelledAt))})`}. 새 지원을 받지
            않습니다.
          </p>
        )}
        <h1>{data.title}</h1>
        <p className="project-detail__client">
          <Link
            to={`/users/${data.client.id}`}
            aria-label={`${data.client.companyName ?? data.client.name} 의뢰인 프로필 보기`}
          >
            {data.client.companyName ?? data.client.name}
          </Link>{' '}
          · {data.client.name}
        </p>
        {!data.isCancelled && <BookmarkButton key={`bookmark-${data.id}`} project={data} />}
      </header>

      <section className="profile-card" aria-labelledby="project-info-heading">
        <h2 id="project-info-heading">모집 정보</h2>
        <dl className="profile-summary">
          <div>
            <dt>예산</dt>
            <dd>{formatWon(data.budget)}</dd>
          </div>
          <div>
            <dt>모집 기간</dt>
            <dd>{formatPeriod(data.recruitStartDate, data.recruitEndDate)}</dd>
          </div>
          <div>
            <dt>지원자 수</dt>
            <dd>{data.applicantCount}명</dd>
          </div>
        </dl>
        <h3 className="project-detail__subheading">필요 기술 스택</h3>
        <ul className="tech-picker__chips" aria-label="필요 기술 스택">
          {data.techStacks.map((stack) => (
            <li key={stack.id} className="chip">
              {stack.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="profile-card" aria-labelledby="project-description-heading">
        <h2 id="project-description-heading">프로젝트 설명</h2>
        <p className="project-detail__description">{data.description}</p>
      </section>

      <ApplyPanel key={data.id} project={data} />

      {data.isOwner && <ApplicantsPanel key={`applicants-${data.id}`} project={data} />}

      {data.isOwner && (
        <section className="profile-card" aria-labelledby="project-owner-heading">
          <h2 id="project-owner-heading">프로젝트 관리</h2>
          {actions.length === 0 ? (
            <p className="page-status">{ownerLockedMessage(data.status)}</p>
          ) : (
            <>
              {data.status === 'CONTRACTING' && (
                <p className="page-status">
                  계약 대기 중이라 수정·삭제·모집 마감은 할 수 없습니다. 계약 체결 전까지는
                  프로젝트를 취소할 수 있습니다.
                </p>
              )}
              <div className="funnel-actions funnel-actions--start">
                {actions.includes('EDIT') && (
                  <Link to={`/projects/${data.id}/edit`} className="button">
                    수정
                  </Link>
                )}
                {actions.includes('CLOSE') && (
                  <CloseRecruitControl project={data} onClosed={setCloseNotice} />
                )}
                {actions.includes('DELETE') && <DeleteControl project={data} />}
                {actions.includes('CANCEL') && (
                  <CancelProjectControl project={data} onCancelled={setCloseNotice} />
                )}
              </div>
            </>
          )}
          <p className="form-field__hint project-detail__back">
            <Link to="/me/projects">내 프로젝트 목록으로</Link>
          </p>
        </section>
      )}

      <RecommendedProjects projectId={data.id} categoryLabelOf={categoryLabelOf} />
    </article>
  );
}
