import { FormField, SelectField, TextAreaField } from '../FormField.jsx';
import { TechStackPicker } from '../profile/TechStackPicker.jsx';
import { formatWon } from '../../lib/profileForm.js';
import { PROJECT_LIMITS } from '../../lib/projectForm.js';

const LOCKED_HINT = '모집이 마감되어 바꿀 수 없습니다.';

/** 1단계: 제목·카테고리·설명. */
export function BasicsFields({ form, setField, errors, categories }) {
  const update = (field) => (event) => setField(field, event.target.value);
  return (
    <>
      <FormField
        id="title"
        label="프로젝트 제목"
        required
        maxLength={PROJECT_LIMITS.title}
        placeholder="예: 반응형 쇼핑몰 리뉴얼"
        value={form.title}
        onChange={update('title')}
        error={errors.title}
      />
      <SelectField
        id="category"
        label="카테고리"
        required
        placeholder="카테고리 선택"
        options={categories}
        value={form.category}
        onChange={update('category')}
        error={errors.category}
      />
      <TextAreaField
        id="description"
        label="프로젝트 설명"
        required
        rows={8}
        maxLength={PROJECT_LIMITS.description}
        placeholder="작업 범위, 결과물, 참고 사항 등을 적어 주세요."
        hint={`${form.description.length.toLocaleString('ko-KR')} / ${PROJECT_LIMITS.description.toLocaleString('ko-KR')}자`}
        value={form.description}
        onChange={update('description')}
        error={errors.description}
      />
    </>
  );
}

/**
 * 2단계: 모집 시작일·마감일·예산. 날짜는 KST 날짜이며, 오늘 이전 시작일은 고를 수 없다(D-47).
 * lockedFields에 든 항목은 바꿀 수 없다(모집 마감 후 모집 기간).
 */
export function ScheduleFields({ form, setField, errors, today, lockedFields = [] }) {
  const locked = new Set(lockedFields);
  const budgetText = formatWon(form.budget.trim());
  return (
    <>
      <div className="form-row">
        <FormField
          id="recruitStartDate"
          label="모집 시작일"
          required={false}
          type="date"
          min={locked.has('recruitStartDate') ? undefined : today}
          disabled={locked.has('recruitStartDate')}
          hint={
            locked.has('recruitStartDate') ? LOCKED_HINT : '비워 두면 등록 즉시 모집을 시작합니다.'
          }
          value={form.recruitStartDate}
          onChange={(event) => setField('recruitStartDate', event.target.value)}
          error={errors.recruitStartDate}
        />
        <FormField
          id="recruitEndDate"
          label="모집 마감일"
          required
          type="date"
          min={locked.has('recruitEndDate') ? undefined : form.recruitStartDate || today}
          disabled={locked.has('recruitEndDate')}
          hint={
            locked.has('recruitEndDate') ? LOCKED_HINT : '마감일 23:59(한국 시간)까지 모집합니다.'
          }
          value={form.recruitEndDate}
          onChange={(event) => setField('recruitEndDate', event.target.value)}
          error={errors.recruitEndDate}
        />
      </div>
      <FormField
        id="budget"
        label="예산(원)"
        required
        inputMode="numeric"
        autoComplete="off"
        placeholder="예: 3000000"
        hint={budgetText ? `= ${budgetText}` : '숫자만 입력해 주세요.'}
        value={form.budget}
        onChange={(event) => setField('budget', event.target.value.replace(/[^\d]/g, ''))}
        error={errors.budget}
      />
    </>
  );
}

/** 3단계: 필요 기술 스택(프로필과 같은 선택기, 직접 추가 가능). */
export function TechStackField({ form, setField, errors }) {
  return (
    <TechStackPicker
      value={form.techStacks}
      onChange={(stacks) => setField('techStacks', stacks)}
      error={errors.techStackIds}
    />
  );
}
