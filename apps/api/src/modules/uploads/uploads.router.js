import multer from 'multer';
import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { createProfileService } from '../profiles/profile.service.js';
import { isStoredFileName } from './imageStorage.js';
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_TYPES,
  processProfileImage,
  unsupportedImage,
} from './profileImage.js';

const fileRequired = () =>
  new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { file: '이미지 파일 하나를 선택해 주세요.' },
  });

/** 파일 하나(`file`)만 메모리로 받는다. 용량을 넘으면 읽기를 멈추고 413으로 끝낸다. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter(_req, file, callback) {
    if (PROFILE_IMAGE_TYPES.includes(file.mimetype)) callback(null, true);
    else callback(unsupportedImage());
  },
}).single('file');

function receiveImage(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      next(req.file ? undefined : fileRequired());
      return;
    }
    if (error instanceof HttpError) next(error);
    else if (error.code === 'LIMIT_FILE_SIZE') {
      next(new HttpError(413, 'FILE_TOO_LARGE', '이미지는 5MB 이하만 올릴 수 있습니다.'));
    } else next(fileRequired());
  });
}

/**
 * PROF-04 프로필 이미지 업로드와 이미지 제공. 업로드는 로그인·역할이 필요하고,
 * 저장된 이미지는 공개 프로필에 쓰이므로 누구나 읽을 수 있다.
 */
export function createUploadsRouter({ prisma, authConfig, imageStorage }) {
  const router = Router();
  const service = createProfileService({ prisma, imageStorage });
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.post('/profile-image', authenticate, requireRole, receiveImage, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const webp = await processProfileImage(req.file.buffer);
    res.status(201).json({ data: await service.replaceProfileImage(req.auth.userId, webp) });
  });

  router.get('/profile-images/:fileName', (req, res, next) => {
    const { fileName } = req.params;
    if (!isStoredFileName(fileName)) {
      next(new HttpError(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.'));
      return;
    }
    res.sendFile(
      fileName,
      {
        root: imageStorage.directory,
        dotfiles: 'deny',
        headers: {
          'Content-Type': 'image/webp',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      },
      (error) => {
        if (error) next(new HttpError(404, 'NOT_FOUND', '이미지를 찾을 수 없습니다.'));
      },
    );
  });

  return router;
}
