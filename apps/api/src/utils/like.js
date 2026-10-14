/**
 * LIKE 와일드카드(%, _)와 이스케이프 문자(\)를 글자 그대로 찾게 한다.
 * Prisma의 contains·startsWith는 값을 바인딩하지만 와일드카드는 이스케이프하지 않는다.
 */
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
