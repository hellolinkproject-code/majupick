import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PublicProfileView } from '../components/profile/PublicProfileView.jsx';
import { NoticeCard } from '../components/project/ProjectBits.jsx';
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

/** PROF-05 공개 프로필(A-14). 로그인 없이 볼 수 있고, 본인이어도 이 화면에서는 수정하지 않는다. */
export function PublicProfilePage() {
  const { userId } = useParams();
  const valid = USER_ID.test(userId ?? '');
  const viewerId = useSessionStore((state) => state.user?.id);
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
      <PublicProfileView profile={profile.data} options={options.data} />
      {viewerId === profile.data.id && (
        <p className="form-field__hint">
          다른 사용자에게 보이는 내 공개 프로필입니다. <Link to="/me">내 프로필 수정하기</Link>
        </p>
      )}
    </article>
  );
}
