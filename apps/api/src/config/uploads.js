import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 기본값은 apps/api/uploads(Git 제외 대상). 서버 실행 위치와 관계없이 같은 곳을 쓴다.
const DEFAULT_UPLOAD_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));

export class UploadConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadConfigError';
  }
}

/**
 * 이미지 저장소 설정.
 * `STORAGE_DRIVER=local`(기본)만 구현됨. 운영 영구 저장소(supabase 등)는 STEP 12-B에서 연결한다.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadUploadConfig(env = process.env) {
  const driver = (env.STORAGE_DRIVER ?? 'local').trim().toLowerCase() || 'local';
  if (driver !== 'local') {
    throw new UploadConfigError(
      `STORAGE_DRIVER="${driver}" is not implemented yet. Use "local" until cloud storage is connected (see docs/DEPLOYMENT_PLAN.md).`,
    );
  }

  const raw = env.UPLOAD_DIR?.trim();
  const directory = raw
    ? path.resolve(fileURLToPath(new URL('../..', import.meta.url)), raw)
    : DEFAULT_UPLOAD_DIR;
  return Object.freeze({
    driver: 'local',
    directory: path.join(directory, 'profile-images'),
  });
}
