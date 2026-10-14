import { HttpError } from '../../utils/httpError.js';
import { publicUserSelect, toPublicUser } from '../users/publicUser.js';

const notFound = () => new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');

/** 정수 범위(1~2147483647)를 벗어나거나 숫자가 아니면 없는 사용자와 같게 404로 답한다. */
export function parseUserId(value) {
  const id = /^\d{1,10}$/.test(value) ? Number(value) : 0;
  if (id > 0 && id <= 2147483647) return id;
  throw notFound();
}

/**
 * PROF-05. 역할을 고르지 않은 계정은 공개할 프로필이 없으므로 없는 사용자와 구분하지 않는다(D-88).
 * 관계는 Prisma 중첩 select 한 번으로 읽는다.
 */
export async function findPublicUser(prisma, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user?.role) throw notFound();
  return toPublicUser(user);
}
