// 서버 규칙(apps/api/src/modules/profiles/profile.validation.js)과 같은 기준. 최종 판단은 서버가 한다.
export const PROFILE_LIMITS = Object.freeze({
  name: 50,
  bio: 2000,
  companyName: 100,
  businessFieldEtc: 100,
  url: 500,
  careerYears: 80,
  techStacks: 20,
});
export const PROFILE_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BIGINT_MAX = 9223372036854775807n;

/** 프로필 완성 판정(`profileCompletion.missingFields`) 항목의 화면 이름. */
export const MISSING_FIELD_LABELS = Object.freeze({
  role: '사용자 유형',
  companyName: '회사명',
  businessField: '사업 분야',
  businessFieldEtc: '기타 사업 분야',
  mainCategory: '주요 활동 카테고리',
  techStacks: '기술 스택',
  careerYears: '경력',
  hourlyRate: '시간당 희망 단가',
});

/** 기술 스택 이름 비교 기준(서버 normalized_name과 같음). */
export const normalizeTechStackName = (name) => name.toLowerCase().replace(/[\s.-]+/g, '');

function urlError(value) {
  const text = value.trim();
  if (!text) return '';
  if (text.length > PROFILE_LIMITS.url)
    return `주소는 ${PROFILE_LIMITS.url}자 이하로 입력해 주세요.`;
  try {
    const url = new URL(text);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
      return '';
    }
  } catch {
    // 아래 공통 메시지
  }
  return '올바른 주소(http:// 또는 https://)를 입력해 주세요.';
}

export function validateAccountForm(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = '이름을 입력해 주세요.';
  else if (name.length > PROFILE_LIMITS.name) {
    errors.name = `이름은 ${PROFILE_LIMITS.name}자 이하로 입력해 주세요.`;
  }
  if (form.bio.trim().length > PROFILE_LIMITS.bio) {
    errors.bio = `자기소개는 ${PROFILE_LIMITS.bio}자 이하로 입력해 주세요.`;
  }
  return errors;
}

export function validateClientForm(form) {
  const errors = {};
  const companyName = form.companyName.trim();
  if (!companyName) errors.companyName = '회사명을 입력해 주세요.';
  else if (companyName.length > PROFILE_LIMITS.companyName) {
    errors.companyName = `회사명은 ${PROFILE_LIMITS.companyName}자 이하로 입력해 주세요.`;
  }
  if (!form.businessField) errors.businessField = '사업 분야를 선택해 주세요.';
  if (form.businessField === 'ETC') {
    const etc = form.businessFieldEtc.trim();
    if (!etc) errors.businessFieldEtc = '기타 사업 분야를 입력해 주세요.';
    else if (etc.length > PROFILE_LIMITS.businessFieldEtc) {
      errors.businessFieldEtc = `기타 사업 분야는 ${PROFILE_LIMITS.businessFieldEtc}자 이하로 입력해 주세요.`;
    }
  }
  const websiteUrl = urlError(form.websiteUrl);
  if (websiteUrl) errors.websiteUrl = websiteUrl;
  return errors;
}

export function validateFreelancerForm(form) {
  const errors = {};
  if (!form.mainCategory) errors.mainCategory = '주요 활동 카테고리를 선택해 주세요.';

  if (form.techStacks.length === 0) errors.techStackIds = '기술 스택을 1개 이상 선택해 주세요.';
  else if (form.techStacks.length > PROFILE_LIMITS.techStacks) {
    errors.techStackIds = `기술 스택은 ${PROFILE_LIMITS.techStacks}개까지 선택할 수 있습니다.`;
  }

  const career = form.careerYears.trim();
  if (!/^\d{1,2}$/.test(career) || Number(career) > PROFILE_LIMITS.careerYears) {
    errors.careerYears = `경력은 0~${PROFILE_LIMITS.careerYears} 사이의 정수(년)로 입력해 주세요.`;
  }

  const rate = form.hourlyRate.trim();
  if (!/^\d{1,30}$/.test(rate) || BigInt(rate) <= 0n) {
    errors.hourlyRate = '시간당 단가는 1원 이상의 정수로 입력해 주세요.';
  } else if (BigInt(rate) > BIGINT_MAX) {
    errors.hourlyRate = '저장할 수 있는 최대 금액을 넘었습니다.';
  }

  const portfolioUrl = urlError(form.portfolioUrl);
  if (portfolioUrl) errors.portfolioUrl = portfolioUrl;
  return errors;
}

/** 이미지 파일을 올리기 전 화면에서 먼저 확인한다(실제 내용 검사는 서버가 한다). */
export function validateImageFile(file) {
  if (!PROFILE_IMAGE_TYPES.includes(file.type)) return 'JPG, PNG, WebP 이미지만 올릴 수 있습니다.';
  if (file.size > PROFILE_IMAGE_MAX_BYTES) return '이미지는 5MB 이하만 올릴 수 있습니다.';
  return '';
}

/** 숫자 문자열 금액을 정밀도 손실 없이 `1,234원`으로 표시한다. */
export function formatWon(digits) {
  if (!/^\d+$/.test(digits)) return '';
  return `${BigInt(digits).toLocaleString('ko-KR')}원`;
}
