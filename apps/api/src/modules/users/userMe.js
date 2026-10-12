// API_SPEC_v1 §1.5 UserMe. 비밀번호 해시는 응답에 넣지 않고 hasPassword로만 알린다.

export const userMeInclude = Object.freeze({
  clientProfile: true,
  freelancerProfile: { include: { techStacks: { include: { techStack: true } } } },
  socialAccounts: { select: { provider: true } },
});

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

/**
 * 역할별 필수 프로필 중 비어 있는 항목(D-05 추천안). D-05가 확정되면 이 함수만 바꾼다.
 * 가입 직후에는 검사하지 않고(D-56), 프로젝트 등록·지원 시점에 사용한다.
 */
export function getMissingProfileFields(user) {
  if (!user.role) return ['role'];

  if (user.role === 'CLIENT') {
    const profile = user.clientProfile;
    const missing = [];
    if (isBlank(profile?.companyName)) missing.push('companyName');
    if (isBlank(profile?.businessField)) missing.push('businessField');
    else if (profile.businessField === 'ETC' && isBlank(profile.businessFieldEtc)) {
      missing.push('businessFieldEtc');
    }
    return missing;
  }

  const profile = user.freelancerProfile;
  const missing = [];
  if (isBlank(profile?.mainCategory)) missing.push('mainCategory');
  if (!profile?.techStacks?.length) missing.push('techStacks');
  if (isBlank(profile?.careerYears)) missing.push('careerYears');
  if (isBlank(profile?.hourlyRate)) missing.push('hourlyRate');
  return missing;
}

export function toUserMe(user) {
  const missingFields = getMissingProfileFields(user);
  const client = user.clientProfile;
  const freelancer = user.freelancerProfile;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    profileImageUrl: user.profileImageUrl,
    bio: user.bio,
    hasPassword: Boolean(user.passwordHash),
    socialProviders: (user.socialAccounts ?? []).map((account) => account.provider),
    clientProfile: client
      ? {
          companyName: client.companyName,
          businessField: client.businessField,
          businessFieldEtc: client.businessFieldEtc,
          websiteUrl: client.websiteUrl,
        }
      : null,
    freelancerProfile: freelancer
      ? {
          mainCategory: freelancer.mainCategory,
          techStacks: (freelancer.techStacks ?? []).map(({ techStack }) => ({
            id: techStack.id,
            name: techStack.name,
          })),
          careerYears: freelancer.careerYears,
          hourlyRate: freelancer.hourlyRate === null ? null : freelancer.hourlyRate.toString(),
          portfolioUrl: freelancer.portfolioUrl,
        }
      : null,
    profileCompletion: { isComplete: missingFields.length === 0, missingFields },
  };
}
