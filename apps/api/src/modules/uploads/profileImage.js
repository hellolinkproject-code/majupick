import sharp from 'sharp';
import { HttpError } from '../../utils/httpError.js';

// D-29(제안): jpg·png·webp, 5MB 이하.
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const PROFILE_IMAGE_SIZE = 512;
// 작은 파일이 거대한 해상도로 풀리는 압축 폭탄을 막는다(약 6000×4000).
const MAX_INPUT_PIXELS = 24_000_000;

export const unsupportedImage = () =>
  new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'JPG, PNG, WebP 이미지만 올릴 수 있습니다.');

/** 파일 앞부분 바이트로 실제 형식을 판별한다. 확장자·선언된 MIME 유형은 믿지 않는다. */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const SHARP_FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * 업로드된 이미지를 검증하고 WebP로 다시 인코딩한다.
 * 실제로 디코딩되는 JPG·PNG·WebP만 통과하므로 SVG·실행 파일·위장 파일은 여기서 거부된다.
 * 다시 인코딩하면서 EXIF(촬영 위치 등) 메타데이터를 지우고, 긴 변을 512px 이하로 줄인다.
 * @returns {Promise<Buffer>} WebP 이미지
 */
export async function processProfileImage(buffer) {
  const type = detectImageType(buffer);
  if (!type) throw unsupportedImage();

  try {
    const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await image.metadata();
    if (format !== SHARP_FORMATS[type]) throw unsupportedImage();
    return await image
      .rotate()
      .resize(PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      'INVALID_IMAGE',
      '이미지 파일을 읽을 수 없습니다. 다른 이미지를 선택해 주세요.',
    );
  }
}
