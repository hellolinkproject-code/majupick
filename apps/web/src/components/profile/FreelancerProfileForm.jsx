import { useState } from 'react';
import { FormField, SelectField } from '../FormField.jsx';
import { saveFreelancerProfile } from '../../lib/profileApi.js';
import { formatWon, PROFILE_LIMITS, validateFreelancerForm } from '../../lib/profileForm.js';
import { TechStackPicker } from './TechStackPicker.jsx';
import { SaveFeedback } from './SaveFeedback.jsx';
import { useProfileSave } from './useProfileSave.js';

const toForm = (profile) => ({
  mainCategory: profile?.mainCategory ?? '',
  techStacks: profile?.techStacks ?? [],
  careerYears:
    profile?.careerYears === null || profile?.careerYears === undefined
      ? ''
      : String(profile.careerYears),
  hourlyRate: profile?.hourlyRate ?? '',
  portfolioUrl: profile?.portfolioUrl ?? '',
});

/** PROF-03 프리랜서 프로필. 필수: 주요 카테고리, 기술 스택 1개 이상, 경력, 시간당 단가. */
export function FreelancerProfileForm({ user, projectCategories }) {
  const [form, setForm] = useState(() => toForm(user.freelancerProfile));
  const { errors, formError, notice, isSaving, submit, touched } = useProfileSave({
    save: saveFreelancerProfile,
    validate: validateFreelancerForm,
    onSaved: (saved) => setForm(toForm(saved.freelancerProfile)),
  });

  const set = (field, value) => {
    touched();
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const update = (field) => (event) => set(field, event.target.value);

  function handleSubmit(event) {
    event.preventDefault();
    // 금액은 Number로 바꾸지 않고 숫자 문자열 그대로 보낸다(D-51, bigint 정밀도).
    submit(form, () => ({
      mainCategory: form.mainCategory,
      techStackIds: form.techStacks.map((stack) => stack.id),
      careerYears: Number(form.careerYears.trim()),
      hourlyRate: form.hourlyRate.trim(),
      portfolioUrl: form.portfolioUrl.trim() || null,
    }));
  }

  const rateText = formatWon(form.hourlyRate.trim());

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="프리랜서 정보">
      <SelectField
        id="mainCategory"
        label="주요 활동 카테고리"
        required
        placeholder="카테고리 선택"
        options={projectCategories}
        value={form.mainCategory}
        onChange={update('mainCategory')}
        error={errors.mainCategory}
      />
      <TechStackPicker
        value={form.techStacks}
        onChange={(stacks) => set('techStacks', stacks)}
        error={errors.techStackIds}
      />
      <div className="form-row">
        <FormField
          id="careerYears"
          label="경력(년)"
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={PROFILE_LIMITS.careerYears}
          step={1}
          hint="1년 미만이면 0을 입력해 주세요."
          value={form.careerYears}
          onChange={update('careerYears')}
          error={errors.careerYears}
        />
        <FormField
          id="hourlyRate"
          label="시간당 희망 단가(원)"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="예: 50000"
          hint={rateText ? `= ${rateText}` : '숫자만 입력해 주세요.'}
          value={form.hourlyRate}
          onChange={(event) => set('hourlyRate', event.target.value.replace(/[^\d]/g, ''))}
          error={errors.hourlyRate}
        />
      </div>
      <FormField
        id="portfolioUrl"
        label="포트폴리오 주소"
        required={false}
        type="url"
        inputMode="url"
        placeholder="https://"
        maxLength={PROFILE_LIMITS.url}
        value={form.portfolioUrl}
        onChange={update('portfolioUrl')}
        error={errors.portfolioUrl}
      />
      <SaveFeedback formError={formError} notice={notice} />
      <button type="submit" className="button" disabled={isSaving}>
        {isSaving ? '저장하는 중…' : '프리랜서 정보 저장'}
      </button>
    </form>
  );
}
