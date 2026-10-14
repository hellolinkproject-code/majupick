// API_SPEC_v1 §1.5 PublicUser(PROF-05). 공개해도 되는 컬럼만 읽고, 응답은 아래 DTO로만 만든다.
import { fileNameFromUrl } from '../uploads/imageStorage.js';
import { getMissingProfileFields } from './userMe.js';

/**
 * 이메일·비밀번호 해시·소셜 계정·토큰·생성/수정 시각은 읽지 않는다.
 * `hourlyRate`는 완성 여부 계산에만 쓰고 응답에는 넣지 않는다(D-87).
 */
export const publicUserSelect = Object.freeze({
  id: true,
  name: true,
  role: true,
  profileImageUrl: true,
  bio: true,
  clientProfile: {
    select: { companyName: true, businessField: true, businessFieldEtc: true, websiteUrl: true },
  },
  freelancerProfile: {
    select: {
      mainCategory: true,
      careerYears: true,
      hourlyRate: true,
      portfolioUrl: true,
      techStacks: { select: { techStack: { select: { id: true, name: true } } } },
    },
  },
});

function toPublicClient(profile) {
  if (!profile) return null;
  return {
    companyName: profile.companyName,
    businessField: profile.businessField,
    businessFieldEtc: profile.businessFieldEtc,
    websiteUrl: profile.websiteUrl,
  };
}

function toPublicFreelancer(profile) {
  if (!profile) return null;
  return {
    mainCategory: profile.mainCategory,
    techStacks: profile.techStacks
      .map(({ techStack }) => ({ id: techStack.id, name: techStack.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    careerYears: profile.careerYears,
    portfolioUrl: profile.portfolioUrl,
  };
}

/**
 * 역할에 맞는 프로필만 싣는다. 이미지 경로는 이 저장소가 만든 형식일 때만 내보낸다.
 * `profileComplete`는 D-05 필수 항목이 다 찼는지만 알리고 어떤 항목이 비었는지는 알리지 않는다.
 */
export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    profileImageUrl: fileNameFromUrl(user.profileImageUrl) ? user.profileImageUrl : null,
    bio: user.bio,
    profileComplete: getMissingProfileFields(user).length === 0,
    clientProfile: user.role === 'CLIENT' ? toPublicClient(user.clientProfile) : null,
    freelancerProfile:
      user.role === 'FREELANCER' ? toPublicFreelancer(user.freelancerProfile) : null,
  };
}
