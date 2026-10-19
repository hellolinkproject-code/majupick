import { PublicReviewSection } from '../review/ReviewList.jsx';
import { externalUrl } from '../../lib/profileApi.js';
import { ProfileAvatar } from './ProfileAvatar.jsx';

const ROLE_LABELS = { CLIENT: '의뢰인', FREELANCER: '프리랜서' };
const EMPTY = '등록되지 않음';

const labelOf = (options, value) =>
  options?.find((option) => option.value === value)?.label ?? value;

function ExternalLink({ url, label }) {
  const href = externalUrl(url);
  if (!href) return EMPTY;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={`${label}(새 창)`}
    >
      {url}
    </a>
  );
}

function Details({ items }) {
  return (
    <dl className="profile-summary public-profile__details">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value ?? EMPTY}</dd>
        </div>
      ))}
    </dl>
  );
}

function businessFieldText(profile, options) {
  if (!profile?.businessField) return null;
  const label = labelOf(options?.businessFields, profile.businessField);
  return profile.businessField === 'ETC' && profile.businessFieldEtc
    ? `${label} (${profile.businessFieldEtc})`
    : label;
}

function careerText(years) {
  if (years === null || years === undefined) return null;
  return years === 0 ? '1년 미만' : `${years}년`;
}

/**
 * PROF-05·B-19 공개 프로필 본문. 읽기 전용이며 수정 API를 부르지 않는다.
 * 지원자 목록(STEP 06)에서도 같은 공개 응답으로 쓸 수 있게 페이지와 분리했다.
 * @param {{
 *   profile: object,
 *   options?: { projectCategories: object[], businessFields: object[] },
 *   headingLevel?: 'h1' | 'h2' | 'h3',
 *   reviews?: {
 *     summary?: { average: number | null, count: number },
 *     items?: object[],
 *     pagination?: object,
 *     loading?: boolean,
 *     error?: string,
 *     onRetry?: () => void,
 *     onPageChange?: (page: number) => void,
 *   },
 * }} props
 */
export function PublicProfileView({ profile, options, headingLevel = 'h1', reviews }) {
  const level = Number(headingLevel.slice(1));
  const Heading = headingLevel;
  const Section = `h${level + 1}`;
  const Sub = `h${level + 2}`;
  const client = profile.role === 'CLIENT' ? profile.clientProfile : null;
  const freelancer = profile.role === 'FREELANCER' ? profile.freelancerProfile : null;
  const title = client?.companyName || profile.name;
  const subtitle =
    profile.role === 'CLIENT'
      ? [ROLE_LABELS.CLIENT, client?.companyName ? `담당자 ${profile.name}` : null]
      : [
          ROLE_LABELS.FREELANCER,
          freelancer?.mainCategory
            ? labelOf(options?.projectCategories, freelancer.mainCategory)
            : null,
        ];

  return (
    <div className="public-profile">
      <section className="profile-card public-profile__header">
        <ProfileAvatar name={profile.name} imageUrl={profile.profileImageUrl} />
        <div className="public-profile__identity">
          <span
            className={`chip public-profile__role public-profile__role--${profile.role.toLowerCase()}`}
          >
            {ROLE_LABELS[profile.role]}
          </span>
          <Heading className="public-profile__name">{title}</Heading>
          <p className="public-profile__subtitle">{subtitle.filter(Boolean).join(' · ')}</p>
        </div>
      </section>

      {!profile.profileComplete && (
        <p className="completion public-profile__incomplete" role="status">
          아직 프로필을 작성 중인 사용자입니다. 일부 정보가 표시되지 않을 수 있습니다.
        </p>
      )}

      <section className="profile-card">
        <Section>{ROLE_LABELS[profile.role]} 정보</Section>
        {profile.role === 'CLIENT' ? (
          <Details
            items={[
              ['회사명', client?.companyName],
              ['사업 분야', businessFieldText(client, options)],
              [
                '회사 웹사이트',
                <ExternalLink key="web" url={client?.websiteUrl} label="회사 웹사이트" />,
              ],
            ]}
          />
        ) : (
          <>
            <Details
              items={[
                [
                  '주요 분야',
                  freelancer?.mainCategory
                    ? labelOf(options?.projectCategories, freelancer.mainCategory)
                    : null,
                ],
                ['경력', careerText(freelancer?.careerYears)],
                [
                  '포트폴리오',
                  <ExternalLink
                    key="portfolio"
                    url={freelancer?.portfolioUrl}
                    label="포트폴리오"
                  />,
                ],
              ]}
            />
            <Sub className="project-detail__subheading">기술 스택</Sub>
            {freelancer?.techStacks.length ? (
              <ul className="tech-picker__chips" aria-label="기술 스택">
                {freelancer.techStacks.map((stack) => (
                  <li key={stack.id} className="chip">
                    {stack.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="page-status">등록된 기술 스택이 없습니다.</p>
            )}
          </>
        )}
      </section>

      <section className="profile-card">
        <Section>{profile.role === 'CLIENT' ? '소개' : '자기소개'}</Section>
        {profile.bio ? (
          <p className="project-detail__description">{profile.bio}</p>
        ) : (
          <p className="page-status">등록된 소개가 없습니다.</p>
        )}
      </section>

      {reviews && (
        <PublicReviewSection
          summary={reviews.summary ?? profile.ratingSummary}
          reviews={reviews.items}
          pagination={reviews.pagination}
          loading={reviews.loading}
          error={reviews.error}
          onRetry={reviews.onRetry}
          onPageChange={reviews.onPageChange}
        />
      )}
    </div>
  );
}
