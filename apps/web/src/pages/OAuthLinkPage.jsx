import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { FormField } from '../components/FormField.jsx';
import { linkGoogleAccount, parseApiError } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { BRAND_NAME_KO } from '../lib/brand.js';

const MASKED_EMAIL = /^[^\s@*][*]{3}@[^\s@]+$/;

/** 같은 이메일의 기존 계정에 Google을 연결하기 전, 비밀번호로 소유를 확인한다. */
export function OAuthLinkPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const emailParam = searchParams.get('email') ?? '';
  const maskedEmail = MASKED_EMAIL.test(emailParam) ? emailParam : '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: linkGoogleAccount,
    onSuccess: (user) => {
      if (!user.role) {
        navigate(
          returnTo !== '/'
            ? `/select-role?returnTo=${encodeURIComponent(returnTo)}`
            : '/select-role',
          {
            replace: true,
          },
        );
        return;
      }
      navigate(returnTo !== '/' ? returnTo : '/me', { replace: true });
    },
    onError: (requestError) => {
      const apiError = parseApiError(requestError);
      if (apiError.code === 'INVALID_CREDENTIALS') {
        setError('비밀번호가 올바르지 않습니다.');
        return;
      }
      if (apiError.code === 'OAUTH_LINK_EXPIRED') {
        setError('계정 연결 확인 시간이 지났습니다. Google 로그인을 다시 시작해 주세요.');
        return;
      }
      if (apiError.code === 'OAUTH_LINK_UNAVAILABLE') {
        setError(
          '이 계정은 비밀번호로 소유를 확인할 수 없어 Google 계정을 연결할 수 없습니다. 기존 로그인 방법을 이용해 주세요.',
        );
        return;
      }
      setError(apiError.message);
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    if (mutation.isPending) return;
    setError('');
    if (!password) {
      setError('비밀번호를 입력해 주세요.');
      return;
    }
    mutation.mutate(password);
  }

  return (
    <section className="auth-card">
      <h1>계정 연결 확인</h1>
      <p className="profile__note">
        {maskedEmail
          ? `${maskedEmail} 로 가입된 ${BRAND_NAME_KO} 계정이 있습니다.`
          : `같은 이메일로 가입된 ${BRAND_NAME_KO} 계정이 있습니다.`}{' '}
        본인 확인을 위해 기존 비밀번호를 입력하면 Google 계정을 연결합니다. 이메일 주소만으로 자동
        연결하지 않습니다.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <FormField
          id="password"
          label="기존 비밀번호"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="button button--block" disabled={mutation.isPending}>
          {mutation.isPending ? '확인하는 중…' : 'Google 계정 연결'}
        </button>
      </form>
      <p className="auth-card__footer">
        <Link to="/login">로그인으로 돌아가기</Link>
      </p>
    </section>
  );
}
