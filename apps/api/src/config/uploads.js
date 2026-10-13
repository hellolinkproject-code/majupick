import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 기본값은 apps/api/uploads(Git 제외 대상). 서버 실행 위치와 관계없이 같은 곳을 쓴다.
const DEFAULT_UPLOAD_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));

/** 로컬 이미지 저장소 위치. `UPLOAD_DIR`이 상대 경로면 apps/api 기준으로 푼다. */
export function loadUploadConfig(env = process.env) {
  const raw = env.UPLOAD_DIR?.trim();
  const directory = raw
    ? path.resolve(fileURLToPath(new URL('../..', import.meta.url)), raw)
    : DEFAULT_UPLOAD_DIR;
  return Object.freeze({ directory: path.join(directory, 'profile-images') });
}
