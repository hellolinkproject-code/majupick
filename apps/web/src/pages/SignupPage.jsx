import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { FormField } from '../components/FormField.jsx';
import { GoogleAuthSection } from '../components/GoogleAuthSection.jsx';
import { parseApiError, signup } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';

// 서버 규칙(apps/api/src/modules/auth/validation.js)과 같은 기준. 비밀번호는 8자 이상만 요구한다(D-60).
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_OPTIONS = [
  { value: 'CLIENT', label: '의뢰인', description: '프로젝트를 등록하고 프리랜서를 찾습니다' },
  { value: 'FREELANCER', label: '프리랜서', description: '프로젝트에 지원하고 일을 수행합니다' },
];

function validate(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = '이름을 입력해 주세요.';
  else if (name.length > 50) errors.name = '이름은 50자 이하로 입력해 주세요.';

  const email = form.email.trim();
  if (!email) errors.email = '이메일을 입력해 주세요.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = '올바른 이메일 형식이 아닙니다.';

  if (!form.password) errors.password = '비밀번호를 입력해 주세요.';
  else if (form.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  } else if (new TextEncoder().encode(form.password).length > PASSWORD_MAX_BYTES) {
    errors.password = `비밀번호가 너무 깁니다(최대 ${PASSWORD_MAX_BYTES}바이트).`;
  }

  if (form.passwordConfirm !== form.password) {
    errors.passwordConfirm = '비밀번호가 일치하지 않습니다.';
  }
  if (!form.role) errors.role = '의뢰인 또는 프리랜서를 선택해 주세요.';
  return errors;
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const status = useSessionStore((state) => state.status);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    passwordConfirm: '',
    role: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const mutation = useMutation({
    mutationFn: signup,
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'EMAIL_ALREADY_EXISTS') {
        setErrors({ email: '이미 가입된 이메일입니다.' });
      } else if (apiError.code === 'VALIDATION_ERROR') {
        setErrors(apiError.fields);
      } else {
        setFormError(apiError.message);
      }
    },
  });

  // 가입하면 바로 로그인된다. 상세 프로필 입력은 강제하지 않는다(D-56).
  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  const update = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    mutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    });
  }

  const loginHref = returnTo === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className="auth-card">
      <h1>회원가입</h1>
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-alert" role="alert">
            {formError}
          </p>
        )}
        <FormField
          id="name"
          label="이름"
          autoComplete="name"
          value={form.name}
          onChange={update('name')}
          error={errors.name}
        />
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
          autoComplete="new-password"
          placeholder="8자 이상"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
        />
        <FormField
          id="passwordConfirm"
          label="비밀번호 확인"
          type="password"
          autoComplete="new-password"
          value={form.passwordConfirm}
          onChange={update('passwordConfirm')}
          error={errors.passwordConfirm}
        />

        <fieldset
          className="role-options"
          aria-invalid={errors.role ? 'true' : undefined}
          aria-describedby={errors.role ? 'role-error' : undefined}
        >
          <legend>사용자 유형</legend>
          {ROLE_OPTIONS.map((option) => (
            <label key={option.value} className="role-option">
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={form.role === option.value}
                onChange={update('role')}
              />
              <span className="role-option__label">{option.label}</span>
              <span className="role-option__description">{option.description}</span>
            </label>
          ))}
          {errors.role && (
            <p id="role-error" className="form-field__error">
              {errors.role}
            </p>
          )}
        </fieldset>

        <button type="submit" className="button button--block" disabled={mutation.isPending}>
          {mutation.isPending ? '가입하는 중…' : '회원가입'}
        </button>
      </form>
      <GoogleAuthSection returnTo={returnTo} />
      <p className="auth-card__footer">
        이미 계정이 있나요? <Link to={loginHref}>로그인</Link>
      </p>
    </section>
  );
}
