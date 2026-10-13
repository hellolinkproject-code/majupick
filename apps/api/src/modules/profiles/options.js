// D-59(제안) 값 목록. Prisma enum과 같은 값이며, 화면 라벨은 SRCH-03으로 내려준다.

export const PROJECT_CATEGORIES = Object.freeze([
  { value: 'WEB', label: '웹' },
  { value: 'MOBILE', label: '모바일' },
  { value: 'DESIGN', label: '디자인' },
  { value: 'MARKETING', label: '마케팅' },
  { value: 'DATA_AI', label: '데이터·AI' },
  { value: 'PLANNING', label: '기획' },
  { value: 'ETC', label: '기타' },
]);

export const BUSINESS_FIELDS = Object.freeze([
  { value: 'IT', label: 'IT' },
  { value: 'COMMERCE', label: '커머스' },
  { value: 'EDUCATION', label: '교육' },
  { value: 'FINANCE', label: '금융' },
  { value: 'HEALTHCARE', label: '헬스케어' },
  { value: 'MEDIA', label: '미디어' },
  { value: 'MANUFACTURING', label: '제조' },
  { value: 'ETC', label: '기타' },
]);

export const PROJECT_CATEGORY_VALUES = new Set(PROJECT_CATEGORIES.map((item) => item.value));
export const BUSINESS_FIELD_VALUES = new Set(BUSINESS_FIELDS.map((item) => item.value));
