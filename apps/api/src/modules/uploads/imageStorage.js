import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROFILE_IMAGE_URL_PREFIX = '/api/uploads/profile-images/';
const FILE_NAME_PATTERN = /^[a-f0-9]{32}\.webp$/;

/** 저장소가 만든 파일 이름만 통과시킨다. 경로 구분자·`..`이 들어올 수 없다. */
export function isStoredFileName(fileName) {
  return typeof fileName === 'string' && FILE_NAME_PATTERN.test(fileName);
}

/** DB에 저장된 URL이 이 저장소의 파일이면 파일 이름을, 아니면 null을 돌려준다. */
export function fileNameFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(PROFILE_IMAGE_URL_PREFIX)) return null;
  const fileName = url.slice(PROFILE_IMAGE_URL_PREFIX.length);
  return isStoredFileName(fileName) ? fileName : null;
}

/**
 * 로컬 디스크 이미지 저장소(개발·임시 운영). 파일 이름은 무작위 16바이트로 만들고 원래 파일 이름은 쓰지 않는다.
 * 응답에는 공개 URL(`/api/uploads/profile-images/<이름>.webp`)만 주고 서버 디렉터리 경로는 노출하지 않는다.
 * 운영 영구 저장소(D-29·D-76)는 같은 `kind`·`save`·`remove` 형태로 교체한다.
 * @param {{ directory: string }} options
 */
export function createLocalImageStorage({ directory }) {
  const root = path.resolve(directory);

  return {
    kind: 'local',
    directory: root,

    /** @returns {Promise<string>} 공개 URL */
    async save(webpBuffer) {
      await mkdir(root, { recursive: true });
      const fileName = `${randomBytes(16).toString('hex')}.webp`;
      await writeFile(path.join(root, fileName), webpBuffer, { flag: 'wx' });
      return `${PROFILE_IMAGE_URL_PREFIX}${fileName}`;
    },

    /** 이 저장소가 만든 URL만 지운다. 다른 URL이나 이미 없는 파일은 무시한다. */
    async remove(url) {
      const fileName = fileNameFromUrl(url);
      if (!fileName) return;
      await rm(path.join(root, fileName), { force: true });
    },
  };
}

/**
 * `loadUploadConfig()` 결과에 맞는 저장소 어댑터를 만든다.
 * @param {{ driver: string, directory: string }} uploadConfig
 */
export function createImageStorage(uploadConfig) {
  if (uploadConfig.driver === 'local') {
    return createLocalImageStorage({ directory: uploadConfig.directory });
  }
  throw new Error(`Unsupported STORAGE_DRIVER "${uploadConfig.driver}"`);
}
