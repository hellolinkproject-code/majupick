// SRCH-02 추천 프로젝트(RFP 3.4.2). AI·외부 서비스 없이 카테고리·기술 스택 겹침으로만 순위를 매긴다.
// 순위: 같은 카테고리 → 겹치는 기술 스택 수 → 최근 등록 → id. 후보는 실제(KST) 모집 중인 공개 프로젝트이고,
// 같은 카테고리이거나 기술 스택이 하나 이상 겹쳐야 한다(D-30 제안 + D-105 제안).

export const RECOMMENDATION_LIMIT = 4;

/**
 * 추천 후보의 id와 일치 정보만 순위대로 고른다. 화면에 줄 필드는 호출한 쪽이 공개 조건으로 다시 읽는다.
 * 모집 중 조건은 projectStatus.js publicStatusWhere('RECRUITING')와 같다.
 * @param {object} db Prisma client 또는 트랜잭션
 * @param {{ projectId: number, category: string, techStackIds: number[], today: Date, limit?: number }} input
 * @returns {Promise<Array<{ id: number, sameCategory: boolean, sharedTechStackCount: number }>>}
 */
export function rankRecommendations(db, { projectId, category, techStackIds, today, limit }) {
  return db.$queryRaw`
    SELECT p.id,
      (p.category::text = ${category}) AS "sameCategory",
      COUNT(pts.tech_stack_id)::int AS "sharedTechStackCount"
    FROM projects p
    LEFT JOIN project_tech_stacks pts
      ON pts.project_id = p.id AND pts.tech_stack_id = ANY(${techStackIds}::int[])
    WHERE p.deleted_at IS NULL
      AND p.id <> ${projectId}
      AND p.status IN ('SCHEDULED', 'RECRUITING')
      AND p.recruit_end_date >= ${today}::date
      AND (p.status = 'RECRUITING' OR p.recruit_start_date <= ${today}::date)
    GROUP BY p.id
    HAVING p.category::text = ${category} OR COUNT(pts.tech_stack_id) > 0
    ORDER BY "sameCategory" DESC, "sharedTechStackCount" DESC, p.created_at DESC, p.id DESC
    LIMIT ${limit ?? RECOMMENDATION_LIMIT}`;
}
