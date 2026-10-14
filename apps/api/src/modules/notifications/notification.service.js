import { HttpError } from '../../utils/httpError.js';
import { isSafeNotificationLink } from './notificationEvents.js';

export const NOTIFICATIONS_PAGE_SIZE = 20;

const notificationNotFound = () => new HttpError(404, 'NOT_FOUND', '알림을 찾을 수 없습니다.');

/**
 * API_SPEC_v1 §1.5 Notification. 이동 경로는 허용 목록을 다시 확인해 통과한 값만 내려보낸다.
 * 지원 내용·연락처는 애초에 저장하지 않는다.
 */
export function toNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    linkUrl: isSafeNotificationLink(row.linkUrl) ? row.linkUrl : null,
    projectId: row.projectId,
    applicationId: row.applicationId,
    isRead: row.readAt !== null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * NOTI-01~04. 모든 쿼리는 로그인한 사용자(user_id)로 범위를 제한한다.
 * 조회(GET)는 읽음 상태를 바꾸지 않는다. 읽음 처리는 PATCH로만 한다.
 */
export function createNotificationService({ prisma, clock = () => new Date() }) {
  return {
    /** NOTI-01 최신순(created_at DESC, id DESC) 20개씩. 개수와 목록은 같은 스냅샷에서 읽는다. */
    async list(userId, { page, unreadOnly }) {
      const where = { userId, ...(unreadOnly && { readAt: null }) };
      const [totalCount, unreadCount, rows] = await prisma.$transaction(
        [
          prisma.notification.count({ where }),
          prisma.notification.count({ where: { userId, readAt: null } }),
          prisma.notification.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
            take: NOTIFICATIONS_PAGE_SIZE,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        data: rows.map(toNotification),
        pagination: {
          page,
          pageSize: NOTIFICATIONS_PAGE_SIZE,
          totalCount,
          totalPages: Math.ceil(totalCount / NOTIFICATIONS_PAGE_SIZE),
        },
        unreadCount,
      };
    },

    /** NOTI-02 읽지 않은 알림 수(헤더 배지). */
    async unreadCount(userId) {
      return { count: await prisma.notification.count({ where: { userId, readAt: null } }) };
    },

    /**
     * NOTI-03 한 건 읽음. 이미 읽은 알림은 처음 읽은 시각을 그대로 두고 200(멱등).
     * 남의 알림·없는 알림은 구분 없이 404.
     */
    async markRead(userId, notificationId) {
      await prisma.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: clock() },
      });
      const row = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
      if (!row) throw notificationNotFound();
      return toNotification(row);
    },

    /** NOTI-04 모두 읽음. 이번에 읽음으로 바뀐 개수를 돌려준다(다시 보내면 0). */
    async markAllRead(userId) {
      const { count } = await prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: clock() },
      });
      return { updatedCount: count };
    },
  };
}
