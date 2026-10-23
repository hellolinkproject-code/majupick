import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { parseApiError, selectRole } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { BRAND_NAME_KO } from '../lib/brand.js';

const ROLE_OPTIONS = [
  { value: 'CLIENT', label: '의뢰인', description: '프로젝트를 등록하고 프리랜서를 찾습니다' },
  { value: 'FREELANCER', label: '프리랜서', description: '프로젝트에 지원하고 일을 수행합니다' },
];

/** 최초 Google 로그인 후 역할을 한 번 고른다. 상세 프로필은 요구하지 않는다. */
export function SelectRolePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [role, setRole] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: selectRole,
    onSuccess: () => {
      navigate(returnTo !== '/' ? returnTo : '/me', { replace: true });
    },
    onError: (requestError) => {
      const apiError = parseApiError(requestError);
      setError(
        apiError.code === 'ROLE_ALREADY_SET' ? '역할은 이미 선택되어 있습니다.' : apiError.message,
      );
    },
  });

  if (status === 'idle' || status === 'restoring') {
    return <p className="page-status">로그인 상태를 확인하는 중…</p>;
  }
  if (status !== 'authenticated' || !user) return <Navigate to="/login" replace />;
  if (user.role) return <Navigate to="/me" replace />;

  function handleSubmit(event) {
    event.preventDefault();
    if (mutation.isPending) return;
    setError('');
    if (!role) {
      setError('의뢰인 또는 프리랜서를 선택해 주세요.');
      return;
    }
    mutation.mutate(role);
  }

  return (
    <section className="auth-card">
      <h1>역할 선택</h1>
      <p className="profile__note">
        {BRAND_NAME_KO}에서 어떻게 사용할지 선택해 주세요. 나중에 바꿀 수 없습니다.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <fieldset className="role-options">
          <legend>사용자 유형</legend>
          {ROLE_OPTIONS.map((option) => (
            <label key={option.value} className="role-option">
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
              />
              <span className="role-option__label">{option.label}</span>
              <span className="role-option__description">{option.description}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button button--block" disabled={mutation.isPending}>
          {mutation.isPending ? '저장하는 중…' : '선택 완료'}
        </button>
      </form>
    </section>
  );
}
