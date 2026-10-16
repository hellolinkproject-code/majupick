/**
 * 결정적 mock 단가 분석(D-27). 같은 입력 → 같은 결과. 외부 네트워크를 쓰지 않는다.
 */

const CATEGORY_BASE = Object.freeze({
  WEB: [
    {
      name: '화면·반응형 UI',
      description: '주요 페이지 레이아웃과 모바일 대응',
      days: 5,
      unit: 200_000n,
    },
    {
      name: '회원·인증',
      description: '가입·로그인·세션 관리',
      days: 4,
      unit: 220_000n,
    },
    {
      name: '핵심 업무 API',
      description: '도메인 CRUD와 권한 검사',
      days: 6,
      unit: 230_000n,
    },
  ],
  MOBILE: [
    {
      name: '앱 화면 구성',
      description: '주요 화면 네비게이션과 UI',
      days: 6,
      unit: 210_000n,
    },
    {
      name: '기기·푸시 연동',
      description: '기본 알림·권한 처리',
      days: 3,
      unit: 240_000n,
    },
    {
      name: '백엔드 연동',
      description: 'REST 연동과 오류 처리',
      days: 4,
      unit: 220_000n,
    },
  ],
  DESIGN: [
    {
      name: '정보 구조·와이어프레임',
      description: '화면 흐름과 주요 컴포넌트 정의',
      days: 3,
      unit: 180_000n,
    },
    {
      name: '비주얼 디자인',
      description: '톤앤매너·컴포넌트 시안',
      days: 5,
      unit: 200_000n,
    },
    {
      name: '산출물·가이드',
      description: '에셋 정리와 전달용 가이드',
      days: 2,
      unit: 160_000n,
    },
  ],
  MARKETING: [
    {
      name: '캠페인 기획',
      description: '목표·채널·일정 정리',
      days: 3,
      unit: 170_000n,
    },
    {
      name: '콘텐츠·소재 제작',
      description: '채널별 소재 초안',
      days: 4,
      unit: 160_000n,
    },
    {
      name: '성과 측정 설정',
      description: '지표·추적 태그 기본 구성',
      days: 2,
      unit: 150_000n,
    },
  ],
  DATA_AI: [
    {
      name: '데이터 수집·정제',
      description: '원천 데이터 정리와 품질 점검',
      days: 4,
      unit: 240_000n,
    },
    {
      name: '분석·모델 파이프라인',
      description: '핵심 지표·간단 모델 구성',
      days: 5,
      unit: 260_000n,
    },
    {
      name: '결과 리포트·대시보드',
      description: '요약 지표 시각화',
      days: 3,
      unit: 220_000n,
    },
  ],
  PLANNING: [
    {
      name: '요구사항 정리',
      description: '범위·우선순위·제약 정리',
      days: 3,
      unit: 180_000n,
    },
    {
      name: '기능 명세·플로우',
      description: '화면·API 흐름 초안',
      days: 4,
      unit: 190_000n,
    },
    {
      name: '일정·리스크 계획',
      description: '마일스톤과 위험 요소',
      days: 2,
      unit: 160_000n,
    },
  ],
  ETC: [
    {
      name: '범위 정의',
      description: '목표와 산출물 합의',
      days: 2,
      unit: 170_000n,
    },
    {
      name: '핵심 기능 구현',
      description: '우선순위 높은 기능 개발',
      days: 5,
      unit: 200_000n,
    },
    {
      name: '점검·인수 지원',
      description: '테스트·인수 체크리스트',
      days: 2,
      unit: 150_000n,
    },
  ],
});

function complexityFactor(title, description) {
  const length = title.length + description.length;
  if (length > 1200) return 130n;
  if (length > 600) return 115n;
  if (length > 200) return 105n;
  return 100n;
}

function techStackItems(techStackNames) {
  if (!techStackNames.length) return [];
  const listed = techStackNames.slice(0, 5).join(', ');
  const days = Math.min(2 + techStackNames.length, 6);
  return [
    {
      name: '기술 스택 환경 구성',
      description: `${listed} 기준 개발·빌드 환경 준비`,
      estimatedAmount: BigInt(days) * 180_000n,
      rationale: `선택 기술 ${techStackNames.length}개 기준으로 약 ${days}일 산정`,
    },
  ];
}

/**
 * @param {{ title: string, description: string, category: string | null, techStackNames: string[] }} input
 * @returns {Promise<{ items: object[], assumptions: string[], provider: 'mock' }>}
 */
export async function analyzeWithMock(input) {
  const category = input.category && CATEGORY_BASE[input.category] ? input.category : 'ETC';
  const factor = complexityFactor(input.title, input.description);
  const baseItems = CATEGORY_BASE[category].map((item) => {
    const estimatedAmount = (BigInt(item.days) * item.unit * factor) / 100n;
    return {
      name: item.name,
      description: item.description,
      estimatedAmount,
      rationale: `${category} 카테고리 기준 약 ${item.days}일 × 일 단가(복잡도 보정 ${factor}%)`,
    };
  });

  const items = [...baseItems, ...techStackItems(input.techStackNames)];
  const assumptions = [
    '모의(mock) 산정이며 실제 견적이 아닙니다.',
    `입력 제목·설명 길이와 카테고리(${category})를 반영했습니다.`,
    input.techStackNames.length > 0
      ? `기술 스택 ${input.techStackNames.length}개를 환경 구성 항목에 반영했습니다.`
      : '기술 스택이 없어 카테고리 기본 항목만 산정했습니다.',
  ];

  return { items, assumptions, provider: 'mock' };
}

export function createMockEstimateProvider() {
  return {
    name: 'mock',
    isMock: true,
    analyze: analyzeWithMock,
  };
}
