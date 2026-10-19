import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PublicProfileView } from '../components/profile/PublicProfileView.jsx';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
import { fetchUserReviews } from '../lib/applicationApi.js';
import { parseApiError } from '../lib/authApi.js';
import { fetchMetaOptions, fetchPublicProfile } from '../lib/profileApi.js';
import { useSessionStore } from '../stores/useSessionStore.js';

const USER_ID = /^[1-9]\d{0,9}$/;

function NotFound() {
  return (
    <NoticeCard title="사용자를 찾을 수 없습니다">
      <p>없는 사용자이거나 아직 공개 프로필이 없는 사용자입니다.</p>
      <Link to="/projects">프로젝트 찾기로 가기</Link>
    </NoticeCard>
  );
}

/** PROF-05·B-19 공개 프로필. 로그인 없이 볼 수 있고, 본인이어도 이 화면에서는 수정하지 않는다. */
export function PublicProfilePage() {
  const { userId } = useParams();
  const valid = USER_ID.test(userId ?? '');
  const viewerId = useSessionStore((state) => state.user?.id);
  const [reviewPage, setReviewPage] = useState(1);
  const profile = useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => fetchPublicProfile(userId),
    enabled: valid,
    staleTime: 0,
    retry: (count, error) => error?.response?.status !== 404 && count < 1,
  });
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });
  const reviews = useQuery({
    queryKey: ['public-reviews', userId, reviewPage],
    queryFn: () => fetchUserReviews(userId, { page: reviewPage }),
    enabled: valid && profile.isSuccess,
    staleTime: 0,
    retry: (count, error) => error?.response?.status !== 404 && count < 1,
  });

  if (!valid) return <NotFound />;
  if (profile.isLoading || (!profile.data && !profile.isError)) {
    return <p className="page-status">프로필을 불러오는 중…</p>;
  }
  if (profile.isError) {
    const error = parseApiError(profile.error);
    if (error.code === 'NOT_FOUND') return <NotFound />;
    return (
      <NoticeCard title="프로필을 불러오지 못했습니다">
        <p>{error.message}</p>
        <button type="button" className="button button--small" onClick={() => profile.refetch()}>
          다시 시도
        </button>
      </NoticeCard>
    );
  }

  return (
    <article className="project-page">
      <PublicProfileView
        profile={profile.data}
        options={options.data}
        reviews={{
          summary: reviews.data?.summary ?? profile.data.ratingSummary,
          items: reviews.data?.data ?? [],
          pagination: reviews.data?.pagination,
          loading: reviews.isLoading || reviews.isFetching,
          error: reviews.isError ? parseApiError(reviews.error).message : '',
          onRetry: () => reviews.refetch(),
          onPageChange: (page) => setReviewPage(page),
        }}
      />
      {viewerId === profile.data.id && (
        <p className="form-field__hint">
          다른 사용자에게 보이는 내 공개 프로필입니다. <Link to="/me">내 프로필 수정하기</Link>
        </p>
      )}
    </article>
  );
}
