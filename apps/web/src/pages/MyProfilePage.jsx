import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AccountForm } from '../components/profile/AccountForm.jsx';
import { ClientProfileForm } from '../components/profile/ClientProfileForm.jsx';
import { FreelancerProfileForm } from '../components/profile/FreelancerProfileForm.jsx';
import { ProfileImageField } from '../components/profile/ProfileImageField.jsx';
import { fetchMe } from '../lib/authApi.js';
import { fetchMetaOptions } from '../lib/profileApi.js';
import { MISSING_FIELD_LABELS } from '../lib/profileForm.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';

const ROLE_LABELS = { CLIENT: '의뢰인', FREELANCER: '프리랜서' };

function loginMethods(user) {
  const methods = [];
  if (user.hasPassword) methods.push('이메일');
  if (user.socialProviders?.includes('GOOGLE')) methods.push('Google');
  return methods.join(' · ') || '-';
}

/**
 * 프로필 완성 상태. 미완성이어도 로그인·조회·편집은 그대로 쓸 수 있고(D-56),
 * 프로젝트 등록·지원처럼 필수 프로필이 필요한 기능에서만 채우도록 안내한다(A-13).
 */
function CompletionStatus({ completion, returnTo }) {
  if (completion.isComplete) {
    return (
      <div className="completion completion--done" role="status">
        <strong>프로필 완성</strong>
        <span>필수 항목을 모두 입력했습니다.</span>
        {returnTo && <Link to={returnTo}>하던 작업으로 돌아가기</Link>}
      </div>
    );
  }
  const missing = completion.missingFields.map((field) => MISSING_FIELD_LABELS[field] ?? field);
  return (
    <div className="completion" role="status">
      <strong>프로필 미완성</strong>
      <span>남은 필수 항목: {missing.join(', ')}</span>
      <span className="completion__note">
        지금 입력하지 않아도 서비스를 이용할 수 있습니다. 프로젝트 등록·지원 전에는 완성해야 합니다.
      </span>
    </div>
  );
}

function RoleProfileSection({ user }) {
  const options = useQuery({
    queryKey: ['meta-options'],
    queryFn: fetchMetaOptions,
    staleTime: Infinity,
  });
  const title = user.role === 'CLIENT' ? '의뢰인 정보' : '프리랜서 정보';

  let body;
  if (options.isPending) {
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
  } else if (user.role === 'CLIENT') {
    body = <ClientProfileForm user={user} businessFields={options.data.businessFields} />;
  } else {
    body = <FreelancerProfileForm user={user} projectCategories={options.data.projectCategories} />;
  }

  return (
    <section className="profile-card" aria-labelledby="role-profile-heading">
      <h2 id="role-profile-heading">{title}</h2>
      {body}
    </section>
  );
}

/** 로그인 사용자 전용. 조회는 AUTH-05, 저장은 PROF-01~04. */
export function MyProfilePage() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'), '');
  const user = useSessionStore((state) => state.user);
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 });

  if (!user) return <p className="page-status">프로필을 불러오는 중…</p>;

  return (
    <section className="profile">
      <h1>내 프로필</h1>
      {me.isError && (
        <p className="form-alert" role="alert">
          최신 정보를 불러오지 못했습니다.
        </p>
      )}
      {user.role && user.profileCompletion && (
        <CompletionStatus completion={user.profileCompletion} returnTo={returnTo} />
      )}

      <section className="profile-card" aria-labelledby="account-heading">
        <h2 id="account-heading">기본 정보</h2>
        <dl className="profile-summary">
          <div>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>사용자 유형</dt>
            <dd>{ROLE_LABELS[user.role] ?? '미선택'}</dd>
          </div>
          <div>
            <dt>로그인 방법</dt>
            <dd>{loginMethods(user)}</dd>
          </div>
        </dl>
        <ProfileImageField user={user} />
        <AccountForm user={user} />
      </section>

      {user.role && <RoleProfileSection user={user} />}
    </section>
  );
}
