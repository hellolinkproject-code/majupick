/**
 * 계약서 본문·당사자 스냅샷(B-06, D-15). 생성 시점 값만 담아 이후 프로필·프로젝트 변경과 분리한다.
 */

function formatWon(amount) {
  return `${BigInt(amount).toLocaleString('ko-KR')}원`;
}

/**
 * @param {{
 *   projectTitle: string,
 *   agreedAmount: bigint,
 *   durationDays: number,
 *   client: { name: string, email: string, companyName: string | null },
 *   freelancer: { name: string, email: string },
 * }} input
 */
export function buildContractTerms(input) {
  const company = input.client.companyName?.trim() ? ` (${input.client.companyName.trim()})` : '';
  return [
    'WorkBridge 용역 계약서(자동 생성)',
    '',
    `1. 프로젝트명: ${input.projectTitle}`,
    `2. 의뢰인: ${input.client.name}${company}`,
    `3. 프리랜서: ${input.freelancer.name}`,
    `4. 합의 금액: ${formatWon(input.agreedAmount)}`,
    `5. 계약 기간: ${input.durationDays.toLocaleString('ko-KR')}일(지원서 예상 기간 기준)`,
    '',
    '6. 본 계약서는 금액 합의 시점에 자동 생성되었습니다.',
    '7. 양측 전자서명이 모두 완료되기 전에는 계약이 체결된 것으로 보지 않습니다.',
    '8. 결제·에스크로·납품·완료 승인은 서명 이후 단계에서 진행합니다.',
    '',
    '본 문서는 참고용 자동 생성본이며, 법적 효력은 전자서명 완료 후에 발생합니다.',
  ].join('\n');
}

/**
 * @param {{
 *   projectTitle: string,
 *   agreedAmount: bigint,
 *   durationDays: number,
 *   recruitStartDate: string | null,
 *   recruitEndDate: string,
 *   client: { id: number, name: string, email: string, companyName: string | null },
 *   freelancer: { id: number, name: string, email: string },
 * }} input
 */
export function buildPartiesSnapshot(input) {
  return {
    projectTitle: input.projectTitle,
    agreedAmount: input.agreedAmount.toString(),
    durationDays: input.durationDays,
    recruitStartDate: input.recruitStartDate,
    recruitEndDate: input.recruitEndDate,
    client: {
      userId: input.client.id,
      name: input.client.name,
      email: input.client.email,
      companyName: input.client.companyName,
    },
    freelancer: {
      userId: input.freelancer.id,
      name: input.freelancer.name,
      email: input.freelancer.email,
    },
  };
}
