import { Link } from 'react-router';
import { MISSING_FIELD_LABELS } from '../../lib/profileForm.js';
import { PROJECT_STATUS_LABELS } from '../../lib/projectForm.js';

/** 상태는 글자 + 색 배지로 보여 준다(D-50). */
export function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      {PROJECT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * 필수 프로필 미완성 안내(A-13). 프로필 화면에서 저장하면 returnTo로 이 화면에 돌아온다.
 * 입력 중이던 등록 내용은 보관되어 있어 돌아와서 이어 쓸 수 있다.
 */
export function ProfileRequiredNotice({ missingFields, returnTo }) {
  const missing = missingFields.map((field) => MISSING_FIELD_LABELS[field] ?? field);
  return (
    <div className="completion" role="alert">
      <strong>프로젝트를 등록하려면 프로필을 먼저 완성해 주세요.</strong>
      <span>남은 필수 항목: {missing.join(', ')}</span>
      <span>
        <Link to={`/me?returnTo=${encodeURIComponent(returnTo)}`} className="button button--small">
          프로필 완성하러 가기
        </Link>
      </span>
    </div>
  );
}

export function NoticeCard({ title, children }) {
  return (
    <section className="project-page">
      <div className="profile-card" role="alert">
        <h1 className="notice-title">{title}</h1>
        {children}
      </div>
    </section>
  );
}
