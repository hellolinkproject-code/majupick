import { HttpError } from '../../utils/httpError.js';
import { toUserMe, userMeInclude } from '../users/userMe.js';

const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
const forbiddenRole = (label) =>
  new HttpError(403, 'FORBIDDEN', `${label} 계정만 이 프로필을 저장할 수 있습니다.`);
const unknownTechStacks = () =>
  new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { techStackIds: '존재하지 않는 기술 스택이 포함되어 있습니다.' },
  });

/**
 * PROF-01~03 저장과 프로필 이미지 교체. 대상 사용자는 언제나 인증된 사용자 ID이며,
 * 요청 본문의 사용자 ID·역할은 쓰지 않는다. 응답은 UserMe(민감 정보 제외)다.
 */
export function createProfileService({ prisma, imageStorage = null }) {
  async function loadMe(db, userId) {
    const user = await db.user.findUnique({ where: { id: userId }, include: userMeInclude });
    if (!user) throw unauthenticated();
    return user;
  }

  /** 같은 사용자의 프로필 저장이 동시에 와도 순서대로 처리되도록 사용자 행을 잠근다. */
  async function lockUserWithRole(tx, userId, role, label) {
    const [user] =
      await tx.$queryRaw`SELECT role::text AS role FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!user) throw unauthenticated();
    if (user.role !== role) throw forbiddenRole(label);
  }

  /**
   * 사용자의 이미지 URL을 바꾸고 이전 URL을 돌려준다. 동시에 바뀌면 최신 값을 다시 읽어 재시도해
   * 교체된 파일을 정확히 지울 수 있게 한다.
   */
  async function swapProfileImage(userId, nextUrl) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { profileImageUrl: true },
      });
      if (!current) throw unauthenticated();
      const { count } = await prisma.user.updateMany({
        where: { id: userId, profileImageUrl: current.profileImageUrl },
        data: { profileImageUrl: nextUrl },
      });
      if (count === 1) return current.profileImageUrl;
    }
    throw new HttpError(
      409,
      'CONFLICT',
      '프로필 이미지가 동시에 변경되었습니다. 다시 시도해 주세요.',
    );
  }

  return {
    async getMe(userId) {
      return toUserMe(await loadMe(prisma, userId));
    },

    /** PROF-01 공통 프로필(이름·자기소개, 이미지 삭제). */
    async updateMe(userId, { name, bio, removeProfileImage = false }) {
      const data = {};
      if (name !== undefined) data.name = name;
      if (bio !== undefined) data.bio = bio;
      if (Object.keys(data).length > 0) {
        const { count } = await prisma.user.updateMany({ where: { id: userId }, data });
        if (count !== 1) throw unauthenticated();
      }
      if (removeProfileImage) {
        const previous = await swapProfileImage(userId, null);
        await imageStorage?.remove(previous);
      }
      return toUserMe(await loadMe(prisma, userId));
    },

    /** PROF-02 의뢰인 프로필(없으면 생성, 있으면 전체 교체). */
    async saveClientProfile(userId, profile) {
      const user = await prisma.$transaction(async (tx) => {
        await lockUserWithRole(tx, userId, 'CLIENT', '의뢰인');
        await tx.clientProfile.upsert({
          where: { userId },
          create: { userId, ...profile },
          update: profile,
        });
        return loadMe(tx, userId);
      });
      return toUserMe(user);
    },

    /** PROF-03 프리랜서 프로필. 기술 스택 연결은 요청 목록으로 통째로 바꾼다. */
    async saveFreelancerProfile(userId, { techStackIds, ...profile }) {
      const user = await prisma.$transaction(async (tx) => {
        await lockUserWithRole(tx, userId, 'FREELANCER', '프리랜서');
        const found = await tx.techStack.count({ where: { id: { in: techStackIds } } });
        if (found !== techStackIds.length) throw unknownTechStacks();

        await tx.freelancerProfile.upsert({
          where: { userId },
          create: { userId, ...profile },
          update: profile,
        });
        await tx.freelancerTechStack.deleteMany({ where: { freelancerId: userId } });
        await tx.freelancerTechStack.createMany({
          data: techStackIds.map((techStackId) => ({ freelancerId: userId, techStackId })),
        });
        return loadMe(tx, userId);
      });
      return toUserMe(user);
    },

    /** PROF-04 업로드된(검증·재인코딩된) 이미지를 저장하고 사용자 이미지로 바로 설정한다. */
    async replaceProfileImage(userId, webpBuffer) {
      const nextUrl = await imageStorage.save(webpBuffer);
      let previous;
      try {
        previous = await swapProfileImage(userId, nextUrl);
      } catch (error) {
        await imageStorage.remove(nextUrl);
        throw error;
      }
      await imageStorage.remove(previous);
      return toUserMe(await loadMe(prisma, userId));
    },
  };
}
