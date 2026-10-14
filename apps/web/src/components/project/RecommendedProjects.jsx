import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';
import { fetchRecommendations, recommendationsQueryKey } from '../../lib/bookmarkApi.js';
import { ProjectCard } from './ProjectCard.jsx';

function matchNote({ sameCategory, sharedTechStackCount }) {
  const reasons = [];
  if (sameCategory) reasons.push('같은 카테고리');
  if (sharedTechStackCount > 0) reasons.push(`기술 스택 ${sharedTechStackCount}개 일치`);
  return reasons.join(' · ');
}

/**
 * 상세 하단 추천 프로젝트(SRCH-02, RFP 3.4.2). 공개 응답이라 로그인과 관계없이 같은 결과다.
 * 기준 프로젝트를 볼 수 없게 되면(404) 영역을 숨긴다.
 */
export function RecommendedProjects({ projectId, categoryLabelOf }) {
  const query = useQuery({
    queryKey: recommendationsQueryKey(projectId),
    queryFn: () => fetchRecommendations(projectId),
    staleTime: 30_000,
  });

  if (query.isError && parseApiError(query.error).code === 'NOT_FOUND') return null;

  let body;
  if (query.isPending) {
    body = <p className="page-status">추천 프로젝트를 불러오는 중…</p>;
  } else if (query.isError) {
    body = (
      <div className="form-alert" role="alert">
        추천 프로젝트를 불러오지 못했습니다.{' '}
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => query.refetch()}
        >
          다시 시도
        </button>
      </div>
    );
  } else if (query.data.length === 0) {
    body = (
      <div className="empty-state">
        <p>지금은 비슷한 조건으로 모집 중인 프로젝트가 없습니다.</p>
        <Link to="/projects" className="button button--small">
          프로젝트 찾아보기
        </Link>
      </div>
    );
  } else {
    body = (
      <ul className="project-list recommendation-list" aria-label="추천 프로젝트 목록">
        {query.data.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            categoryLabel={categoryLabelOf(project.category)}
            note={matchNote(project.match)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="profile-card recommendations" aria-labelledby="recommendations-heading">
      <h2 id="recommendations-heading">이 프로젝트와 비슷한 모집 중 프로젝트</h2>
      <p className="form-field__hint">
        같은 카테고리이거나 필요 기술 스택이 겹치는 프로젝트를 최대 4개까지 보여 줍니다.
      </p>
      {body}
    </section>
  );
}
