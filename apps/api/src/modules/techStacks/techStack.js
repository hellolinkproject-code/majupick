export const TECH_STACK_NAME_MAX_LENGTH = 50;

/** ERD §3.6: 소문자 + 공백·점·하이픈 제거(예: `Node.js` → `nodejs`). `C++`·`C#`의 기호는 남긴다. */
export function normalizeTechStackName(name) {
  return name.toLowerCase().replace(/[\s.-]+/g, '');
}

/**
 * 기본 기술 스택 옵션(A-12, D-75 제안). D-59 카테고리마다 대표 기술만 두고 유사 기술은 하나로 묶는다
 * (예: MySQL·PostgreSQL·Oracle → SQL). 목록에 없는 기술은 사용자가 커스텀으로 추가한다(PROF-07).
 */
export const DEFAULT_TECH_STACKS = Object.freeze([
  'JavaScript',
  'TypeScript',
  'HTML/CSS',
  'React',
  'Vue',
  'Next.js',
  'Node.js',
  'Java',
  'Spring',
  'Python',
  'PHP',
  'SQL',
  'NoSQL',
  'AWS',
  'Docker',
  'Android',
  'iOS',
  'Flutter',
  'React Native',
  'Figma',
  'Photoshop',
  'Illustrator',
  'Google Analytics',
  'SEO',
  'Data Analysis',
  'Machine Learning',
  'Git',
]);

/**
 * 기본 옵션을 넣는다. `normalized_name` UNIQUE와 `skipDuplicates`로 여러 번 실행해도 결과가 같다(멱등).
 * 이미 있는 행(사용자가 먼저 추가한 커스텀 항목 포함)은 바꾸지 않는다.
 * @returns {Promise<number>} 새로 추가한 행 수
 */
export async function seedTechStacks(prisma) {
  const { count } = await prisma.techStack.createMany({
    data: DEFAULT_TECH_STACKS.map((name) => ({
      name,
      normalizedName: normalizeTechStackName(name),
      isCustom: false,
    })),
    skipDuplicates: true,
  });
  return count;
}
