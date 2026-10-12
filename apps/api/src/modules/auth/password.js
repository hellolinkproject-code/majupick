import bcrypt from 'bcryptjs';

const dummyHashes = new Map();

export function hashPassword(password, rounds) {
  return bcrypt.hash(password, rounds);
}

/**
 * 비밀번호를 확인한다. 계정이 없거나 비밀번호가 없는 계정(소셜 전용)이어도 같은 비용의 비교를 실행해
 * 응답 시간으로 계정 존재 여부를 추측하지 못하게 한다.
 */
export async function verifyPassword(password, passwordHash, rounds) {
  if (passwordHash) return bcrypt.compare(password, passwordHash);

  if (!dummyHashes.has(rounds)) {
    dummyHashes.set(rounds, bcrypt.hash('workbridge-timing-equalizer', rounds));
  }
  await bcrypt.compare(password, await dummyHashes.get(rounds));
  return false;
}
