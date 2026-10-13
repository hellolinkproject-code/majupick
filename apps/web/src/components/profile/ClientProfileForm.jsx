import { useState } from 'react';
import { FormField, SelectField } from '../FormField.jsx';
import { saveClientProfile } from '../../lib/profileApi.js';
import { PROFILE_LIMITS, validateClientForm } from '../../lib/profileForm.js';
import { SaveFeedback } from './SaveFeedback.jsx';
import { useProfileSave } from './useProfileSave.js';

const toForm = (profile) => ({
  companyName: profile?.companyName ?? '',
  businessField: profile?.businessField ?? '',
  businessFieldEtc: profile?.businessFieldEtc ?? '',
  websiteUrl: profile?.websiteUrl ?? '',
});

/** PROF-02 의뢰인 프로필. 필수: 회사명, 사업 분야('기타'면 직접 입력). */
export function ClientProfileForm({ user, businessFields }) {
  const [form, setForm] = useState(() => toForm(user.clientProfile));
  const { errors, formError, notice, isSaving, submit, touched } = useProfileSave({
    save: saveClientProfile,
    validate: validateClientForm,
    onSaved: (saved) => setForm(toForm(saved.clientProfile)),
  });

  const update = (field) => (event) => {
    touched();
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    submit(form, () => ({
      companyName: form.companyName.trim(),
      businessField: form.businessField,
      businessFieldEtc: form.businessField === 'ETC' ? form.businessFieldEtc.trim() : null,
      websiteUrl: form.websiteUrl.trim() || null,
    }));
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="의뢰인 정보">
      <FormField
        id="companyName"
        label="회사명"
        required
        autoComplete="organization"
        maxLength={PROFILE_LIMITS.companyName}
        value={form.companyName}
        onChange={update('companyName')}
        error={errors.companyName}
      />
      <SelectField
        id="businessField"
        label="사업 분야"
        required
        placeholder="사업 분야 선택"
        options={businessFields}
        value={form.businessField}
        onChange={update('businessField')}
        error={errors.businessField}
      />
      {form.businessField === 'ETC' && (
        <FormField
          id="businessFieldEtc"
          label="기타 사업 분야"
          required
          maxLength={PROFILE_LIMITS.businessFieldEtc}
          value={form.businessFieldEtc}
          onChange={update('businessFieldEtc')}
          error={errors.businessFieldEtc}
        />
      )}
      <FormField
        id="websiteUrl"
        label="웹사이트"
        required={false}
        type="url"
        inputMode="url"
        placeholder="https://"
        maxLength={PROFILE_LIMITS.url}
        value={form.websiteUrl}
        onChange={update('websiteUrl')}
        error={errors.websiteUrl}
      />
      <SaveFeedback formError={formError} notice={notice} />
      <button type="submit" className="button" disabled={isSaving}>
        {isSaving ? '저장하는 중…' : '의뢰인 정보 저장'}
      </button>
    </form>
  );
}
