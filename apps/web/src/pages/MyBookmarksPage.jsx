import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NoticeCard, StatusBadge } from '../components/project/ProjectBits.jsx';
import { APPLICATION_STATUS_LABELS } from '../lib/applicationForm.js';
import { parseApiError } from '../lib/authApi.js';
import {
  applyBookmarkChange,
  bookmarksQueryKey,
  fetchMyBookmarks,
  removeBookmark,
} from '../lib/bookmarkApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { formatWon } from '../lib/profileForm.js';
import { formatDay, toKstDay } from '../lib/projectForm.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** 지원 동선. 모집 중이 아니면 지원할 수 있다고 안내하지 않는다. */
function ApplyGuide({ project }) {
  if (project.myApplication) {
    const label = APPLICATION_STATUS_LABELS[project.myApplication.status];
    return (
      <p className="bookmark-item__guide">
        이미 지원한 프로젝트입니다{label && ` (${label})`}.{' '}
        <Link to="/me/applications">내 지원 현황</Link>
      </p>
    );
  }
  if (project.publicStatus === 'RECRUITING') {
    return (
      <Link to={`/projects/${project.id}`} className="button button--small">
        지원하러 가기
      </Link>
    );
  }
  if (project.publicStatus === 'SCHEDULED') {
    return (
      <p className="bookmark-item__guide">
        {project.recruitStartDate
          ? `${formatDay(project.recruitStartDate)}부터 지원할 수 있습니다.`
          : '모집이 시작되면 지원할 수 있습니다.'}
      </p>
    );
  }
  return <p className="bookmark-item__guide">모집이 마감되어 지원할 수 없습니다.</p>;
}

function BookmarkItem({ project, categoryLabel, userId, onRemoved }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeBookmark(project.id),
    onSuccess: () => {
      applyBookmarkChange(queryClient, userId, project.id, false);
      onRemoved(`"${project.title}" 북마크를 해제했습니다.`);
    },
  });

  return (
    <li className="project-list__item bookmark-item">
      <div className="project-detail__badges">
        <StatusBadge status={project.publicStatus} />
        <span className="chip">{categoryLabel}</span>
        <span className="project-list__date">저장 {formatDay(toKstDay(project.bookmarkedAt))}</span>
      </div>
      <Link to={`/projects/${project.id}`} className="project-list__title">
        {project.title}
      </Link>
      <p className="project-list__meta">
        예산 {formatWon(project.budget)} · 마감 {formatDay(project.recruitEndDate)}
      </p>
      {project.techStacks.length > 0 && (
        <ul className="project-card__stacks" aria-label="필요 기술 스택">
          {project.techStacks.map((stack) => (
            <li key={stack.id} className="chip">
              {stack.name}
            </li>
          ))}
        </ul>
      )}
      <div className="bookmark-item__actions">
        <ApplyGuide project={project} />
        <button
          type="button"
          className="button button--small button--ghost"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          aria-label={`${project.title} 북마크 해제`}
        >
          {remove.isPending ? '해제하는 중…' : '북마크 해제'}
        </button>
      </div>
      {remove.isError && (
        <p className="form-field__error" role="alert">
          {parseApiError(remove.error).message}
        </p>
      )}
    </li>
  );
}

/**
 * BMK-03 내 북마크(프리랜서, A-40). 최근 저장순 10개씩. 상태는 오늘(KST) 기준이라 마감된 프로젝트는
 * 마감으로 보이고 지원 버튼을 주지 않는다. 삭제·취소된 프로젝트는 서버가 목록에서 뺀다.
 */
export function MyBookmarksPage() {
  const user = useSessionStore((state) => state.user);
  const isFreelancer = user?.role === 'FREELANCER';
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const [removedNotice, setRemovedNotice] = useState(null);
  const list = useQuery({
    queryKey: bookmarksQueryKey(user?.id, page),
    queryFn: () => fetchMyBookmarks(page),
    enabled: isFreelancer,
    staleTime: 0,
  });
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });
  const categoryLabelOf = (value) =>
    options.data?.projectCategories.find((option) => option.value === value)?.label ?? value;

  if (!isFreelancer) {
    return (
      <NoticeCard title="프리랜서 전용 화면입니다">
        <p>내 북마크는 프리랜서 계정에서 프로젝트를 저장하고 다시 볼 때 사용합니다.</p>
        <Link to="/">홈으로 돌아가기</Link>
      </NoticeCard>
    );
  }

  let body;
  if (list.isLoading || (!list.data && !list.isError)) {
    body = <p className="page-status">내 북마크를 불러오는 중…</p>;
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
    body = (
      <div className="profile-card empty-state">
        <p>
          {page > 1
            ? '이 페이지에는 북마크한 프로젝트가 없습니다.'
            : '아직 북마크한 프로젝트가 없습니다. 관심 있는 프로젝트를 찾아 저장해 보세요.'}
        </p>
        <Link to={page > 1 ? '/me/bookmarks' : '/projects'} className="button">
          {page > 1 ? '첫 페이지로' : '프로젝트 찾아보기'}
        </Link>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="project-list" aria-label="내 북마크 목록">
          {list.data.data.map((project) => (
            <BookmarkItem
              key={project.id}
              project={project}
              categoryLabel={categoryLabelOf(project.category)}
              userId={user.id}
              onRemoved={setRemovedNotice}
            />
          ))}
        </ul>
        <nav className="pagination" aria-label="페이지">
          <button
            type="button"
            className="button button--small button--ghost"
            disabled={page <= 1}
            onClick={() => setSearchParams({ page: String(page - 1) })}
          >
            이전
          </button>
          <span>
            {page} / {Math.max(pagination.totalPages, 1)} 페이지 (총 {pagination.totalCount}개)
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
      </>
    );
  }

  return (
    <section className="project-page">
      <div className="project-page__heading">
        <h1>내 북마크</h1>
        <Link to="/projects" className="button button--small">
          프로젝트 찾기
        </Link>
      </div>
      {removedNotice && (
        <p className="form-success" role="status">
          {removedNotice}
        </p>
      )}
      {body}
    </section>
  );
}
