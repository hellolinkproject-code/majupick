import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { parsePage } from '../projects/project.validation.js';
import { createNotificationService } from './notification.service.js';

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

export function parseNotificationId(value) {
  const id = /^\d{1,9}$/.test(value) ? Number(value) : 0;
  if (id > 0) return id;
  throw new HttpError(404, 'NOT_FOUND', '알림을 찾을 수 없습니다.');
}

/** NOTI-01 쿼리. unreadOnly는 'true'/'false'만 받는다. */
export function parseNotificationListQuery(query) {
  const page = parsePage(query.page);
  if (query.unreadOnly === undefined || query.unreadOnly === 'false') {
    return { page, unreadOnly: false };
  }
  if (query.unreadOnly === 'true') return { page, unreadOnly: true };
  throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {
    fields: { unreadOnly: 'true 또는 false로 입력해 주세요.' },
  });
}

/**
 * NOTI-01 `GET /notifications`, NOTI-02 `GET /notifications/unread-count`,
 * NOTI-03 `PATCH /notifications/:notificationId/read`, NOTI-04 `PATCH /notifications/read-all`.
 * 로그인(401) → 역할 선택(ROLE_REQUIRED) 후 본인 알림만 다룬다.
 */
export function createNotificationsRouter({ prisma, authConfig, notificationService }) {
  const router = Router();
  const service = notificationService ?? createNotificationService({ prisma });

  router.use(noStore, createAuthenticate(authConfig), createRequireRole(prisma));

  router.get('/', async (req, res) => {
    res.json(await service.list(req.auth.userId, parseNotificationListQuery(req.query)));
  });

  router.get('/unread-count', async (req, res) => {
    res.json({ data: await service.unreadCount(req.auth.userId) });
  });

  router.patch('/read-all', async (req, res) => {
    res.json({ data: await service.markAllRead(req.auth.userId) });
  });

  router.patch('/:notificationId/read', async (req, res) => {
    const notificationId = parseNotificationId(req.params.notificationId);
    res.json({ data: await service.markRead(req.auth.userId, notificationId) });
  });

  return router;
}
