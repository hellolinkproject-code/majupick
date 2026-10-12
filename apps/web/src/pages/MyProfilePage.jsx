import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '../lib/authApi.js';
import { useSessionStore } from '../stores/useSessionStore.js';

const ROLE_LABELS = { CLIENT: '의뢰인', FREELANCER: '프리랜서' };

/** 로그인 사용자 전용(AUTH-05). 역할별 상세 프로필 입력은 다음 단계에서 이 화면에 추가한다. */
export function MyProfilePage() {
  const sessionUser = useSessionStore((state) => state.user);
  const { data, isError } = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 });
  const user = data ?? sessionUser;
  if (!user) return null;

  return (
    <section className="profile">
      <h1>내 프로필</h1>
      {isError && (
        <p className="form-alert" role="alert">
          최신 정보를 불러오지 못했습니다.
        </p>
      )}
      <dl className="checklist">
        <div>
          <dt>이름</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>이메일</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>사용자 유형</dt>
          <dd>{ROLE_LABELS[user.role] ?? '미선택'}</dd>
        </div>
      </dl>
      <p className="profile__note">
        역할별 상세 프로필(회사 정보, 기술 스택 등)은 프로젝트 등록·지원 기능과 함께 제공될
        예정입니다.
      </p>
    </section>
  );
}
