import { Link } from 'react-router';
import { StatusBadge } from './ProjectBits.jsx';
import { formatWon } from '../../lib/profileForm.js';
import { formatDay } from '../../lib/projectForm.js';

/**
 * 검색 결과 카드. 카드 전체가 상세로 가는 링크처럼 눌리지만 링크는 제목 하나다(스크린 리더 중복 방지).
 * from: 상세에서 같은 검색 결과로 돌아올 주소. note: 추천 이유처럼 카드 아래에 덧붙일 한 줄.
 */
export function ProjectCard({ project, categoryLabel, from, note }) {
  return (
    <li className="project-list__item project-card">
      <div className="project-detail__badges">
        <StatusBadge status={project.publicStatus} />
        <span className="chip">{categoryLabel}</span>
      </div>
      <h3 className="project-card__title">
        <Link
          to={`/projects/${project.id}`}
          state={{ from }}
          className="project-list__title project-card__link"
        >
          {project.title}
        </Link>
      </h3>
      {project.descriptionPreview && (
        <p className="project-card__description">{project.descriptionPreview}</p>
      )}
      <p className="project-list__meta">
        예산 {formatWon(project.budget)} · 마감 {formatDay(project.recruitEndDate)}
      </p>
      {project.techStacks.length > 0 && (
        <ul className="project-card__stacks" aria-label="필요 기술 스택">
          {project.techStacks.map((stack) => (
            <li key={stack.id} className="chip">
              {stack.name}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="project-card__note">{note}</p>}
    </li>
  );
}
