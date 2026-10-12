import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { FormField } from '../components/FormField.jsx';
import { login, parseApiError } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function validate({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = '이메일을 입력해 주세요.';
  if (!password) errors.password = '비밀번호를 입력해 주세요.';
  return errors;
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const status = useSessionStore((state) => state.status);
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const mutation = useMutation({
    mutationFn: login,
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'VALIDATION_ERROR') setErrors(apiError.fields);
      setFormError(
        apiError.code === 'INVALID_CREDENTIALS'
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : apiError.message,
      );
    },
  });

  // 로그인에 성공하거나 이미 로그인된 상태면 원래 가려던 화면으로 보낸다.
  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  const update = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    mutation.mutate({ email: form.email, password: form.password });
  }

  const signupHref =
    returnTo === '/' ? '/signup' : `/signup?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className="auth-card">
      <h1>로그인</h1>
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-alert" role="alert">
            {formError}
          </p>
        )}
        <FormField
          id="email"
          label="이메일"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
        />
        <FormField
          id="password"
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
        />
        <button type="submit" className="button button--block" disabled={mutation.isPending}>
          {mutation.isPending ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <p className="auth-card__footer">
        아직 계정이 없나요? <Link to={signupHref}>회원가입</Link>
      </p>
    </section>
  );
}
