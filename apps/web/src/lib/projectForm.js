// 서버 규칙(apps/api/src/modules/projects/project.validation.js)과 같은 기준. 최종 판단은 서버가 한다.
import { PROFILE_LIMITS } from './profileForm.js';

export const PROJECT_LIMITS = Object.freeze({
  title: 100,
  description: 5000,
  techStacks: PROFILE_LIMITS.techStacks,
});
const BIGINT_MAX = 9223372036854775807n;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 7개 상태(D-03)의 화면 이름. 비소유자에게는 publicStatus(앞의 3개)만 온다. */
export const PROJECT_STATUS_LABELS = Object.freeze({
  SCHEDULED: '모집 예정',
  RECRUITING: '모집 중',
  CLOSED: '모집 마감',
  CONTRACTING: '계약 대기',
  IN_PROGRESS: '작업 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
});

/** 등록 퍼널 3단계(A-15)와 각 단계의 입력 항목. 서버 오류가 난 항목의 단계로 돌아갈 때 쓴다. */
export const PROJECT_STEPS = Object.freeze([
  { title: '기본 정보', fields: ['title', 'category', 'description'] },
  { title: '일정·예산', fields: ['recruitStartDate', 'recruitEndDate', 'budget'] },
  { title: '기술 스택', fields: ['techStackIds'] },
]);

export const DATE_MESSAGES = Object.freeze({
  startPast: '모집 시작일은 오늘 이후 날짜로 입력해 주세요.',
  endPast: '모집 마감일은 오늘 이후 날짜로 입력해 주세요.',
  endBeforeStart: '모집 마감일은 시작일과 같거나 이후여야 합니다.',
});

/** 시각(Date 또는 ISO 문자열)의 한국 날짜('YYYY-MM-DD'). 모집 날짜는 KST 날짜다(D-41). */
export function toKstDay(time) {
  return new Date(new Date(time).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export const todayKst = (now = new Date()) => toKstDay(now);

export const emptyProjectForm = () => ({
  title: '',
  category: '',
  description: '',
  recruitStartDate: '',
  recruitEndDate: '',
  budget: '',
  techStacks: [],
});

export function projectToForm(project) {
  return {
    title: project.title,
    category: project.category,
    description: project.description,
    recruitStartDate: project.recruitStartDate ?? '',
    recruitEndDate: project.recruitEndDate,
    budget: project.budget,
    techStacks: project.techStacks,
  };
}

export function validateBasics(form) {
  const errors = {};
  const title = form.title.trim();
  if (!title) errors.title = '제목을 입력해 주세요.';
  else if (title.length > PROJECT_LIMITS.title) {
    errors.title = `제목은 ${PROJECT_LIMITS.title}자 이하로 입력해 주세요.`;
  }
  if (!form.category) errors.category = '카테고리를 선택해 주세요.';
  const description = form.description.trim();
  if (!description) errors.description = '프로젝트 설명을 입력해 주세요.';
  else if (description.length > PROJECT_LIMITS.description) {
    errors.description = `설명은 ${PROJECT_LIMITS.description.toLocaleString('ko-KR')}자 이하로 입력해 주세요.`;
  }
  return errors;
}

/**
 * 모집 기간·예산. 수정 화면에서는 저장된 값(original)과 같은 날짜는 이미 지났어도 그대로 둘 수 있다.
 */
export function validateSchedule(form, today, original = null) {
  const errors = {};
  const start = form.recruitStartDate;
  const end = form.recruitEndDate;
  const startChanged = !original || start !== (original.recruitStartDate ?? '');
  const endChanged = !original || end !== original.recruitEndDate;

  if (start && startChanged && start < today) errors.recruitStartDate = DATE_MESSAGES.startPast;
  if (!end) errors.recruitEndDate = '모집 마감일을 입력해 주세요.';
  else if (endChanged && end < today) errors.recruitEndDate = DATE_MESSAGES.endPast;
  else if (start && end < start) errors.recruitEndDate = DATE_MESSAGES.endBeforeStart;

  const budget = form.budget.trim();
  if (!/^\d{1,30}$/.test(budget) || BigInt(budget) <= 0n) {
    errors.budget = '예산은 1원 이상의 정수로 입력해 주세요.';
  } else if (BigInt(budget) > BIGINT_MAX) {
    errors.budget = '저장할 수 있는 최대 금액을 넘었습니다.';
  }
  return errors;
}

export function validateTechStacks(form) {
  if (form.techStacks.length === 0) {
    return { techStackIds: '필요한 기술 스택을 1개 이상 선택해 주세요.' };
  }
  if (form.techStacks.length > PROJECT_LIMITS.techStacks) {
    return { techStackIds: `기술 스택은 ${PROJECT_LIMITS.techStacks}개까지 선택할 수 있습니다.` };
  }
  return {};
}

export function validateProjectForm(form, today, original = null) {
  return {
    ...validateBasics(form),
    ...validateSchedule(form, today, original),
    ...validateTechStacks(form),
  };
}

/** 서버로 보낼 값. 금액은 Number로 바꾸지 않는다(D-51). */
export function toProjectPayload(form) {
  return {
    title: form.title.trim(),
    category: form.category,
    description: form.description.trim(),
    recruitStartDate: form.recruitStartDate || null,
    recruitEndDate: form.recruitEndDate,
    budget: form.budget.trim(),
    techStackIds: form.techStacks.map((stack) => stack.id),
  };
}

/** PRJ-03에 보낼 바뀐 항목만 고른다. */
export function diffProject(form, project) {
  const next = toProjectPayload(form);
  const before = toProjectPayload(projectToForm(project));
  const changes = {};
  for (const key of Object.keys(next)) {
    const changed =
      key === 'techStackIds'
        ? [...next[key]].sort().join(',') !== [...before[key]].sort().join(',')
        : next[key] !== before[key];
    if (changed) changes[key] = next[key];
  }
  return changes;
}

/** 오류 항목이 처음 나오는 퍼널 단계(0부터). */
export function firstStepWithError(errors) {
  const index = PROJECT_STEPS.findIndex((step) => step.fields.some((field) => errors[field]));
  return index === -1 ? null : index;
}

// 등록 중 입력값은 탭 안에서만(sessionStorage) 사용자별로 보관한다. 새로고침·프로필 보완 후에도 이어 쓴다.
const draftKey = (userId) => `workbridge:project-draft:${userId}`;

export function loadProjectDraft(userId) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? 'null');
    if (draft && typeof draft.idempotencyKey === 'string' && draft.form) {
      return {
        step: Number.isInteger(draft.step) ? Math.min(Math.max(draft.step, 0), 2) : 0,
        form: { ...emptyProjectForm(), ...draft.form },
        idempotencyKey: draft.idempotencyKey,
      };
    }
  } catch {
    // 손상된 값은 버리고 새로 시작한다.
  }
  return { step: 0, form: emptyProjectForm(), idempotencyKey: crypto.randomUUID() };
}

export function saveProjectDraft(userId, draft) {
  try {
    sessionStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // 저장소를 쓸 수 없어도 화면 안의 입력값은 유지된다.
  }
}

export function clearProjectDraft(userId) {
  try {
    sessionStorage.removeItem(draftKey(userId));
  } catch {
    // 위와 같음
  }
}

/** 'YYYY-MM-DD' → '2026. 10. 20.' */
export function formatDay(day) {
  if (!day) return '';
  const [year, month, date] = day.split('-');
  return `${year}. ${Number(month)}. ${Number(date)}.`;
}

export function formatPeriod(start, end) {
  return `${start ? formatDay(start) : '등록 즉시'} ~ ${formatDay(end)}`;
}
