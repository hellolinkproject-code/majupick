import { useState } from 'react';
import { FormField, TextAreaField } from '../FormField.jsx';
import { updateMe } from '../../lib/profileApi.js';
import { PROFILE_LIMITS, validateAccountForm } from '../../lib/profileForm.js';
import { SaveFeedback } from './SaveFeedback.jsx';
import { useProfileSave } from './useProfileSave.js';

const toForm = (user) => ({ name: user.name ?? '', bio: user.bio ?? '' });

/** PROF-01 이름·자기소개. 이메일과 역할은 바꿀 수 없다. */
export function AccountForm({ user }) {
  const [form, setForm] = useState(() => toForm(user));
  const { errors, formError, notice, isSaving, submit, touched } = useProfileSave({
    save: updateMe,
    validate: validateAccountForm,
    onSaved: (saved) => setForm(toForm(saved)),
  });

  const update = (field) => (event) => {
    touched();
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    submit(form, () => ({ name: form.name.trim(), bio: form.bio.trim() || null }));
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="기본 정보">
      <FormField
        id="name"
        label="이름"
        required
        autoComplete="name"
        maxLength={PROFILE_LIMITS.name}
        value={form.name}
        onChange={update('name')}
        error={errors.name}
      />
      <TextAreaField
        id="bio"
        label="자기소개"
        required={false}
        rows={4}
        maxLength={PROFILE_LIMITS.bio}
        hint={`${form.bio.length.toLocaleString()} / ${PROFILE_LIMITS.bio.toLocaleString()}자`}
        value={form.bio}
        onChange={update('bio')}
        error={errors.bio}
      />
      <SaveFeedback formError={formError} notice={notice} />
      <button type="submit" className="button" disabled={isSaving}>
        {isSaving ? '저장하는 중…' : '기본 정보 저장'}
      </button>
    </form>
  );
}
