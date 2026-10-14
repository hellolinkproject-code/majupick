import { apiClient } from './apiClient.js';

/**
 * 읽지 않은 알림 수를 다시 묻는 간격(D-37 제안: 30초 폴링, 창으로 돌아올 때도 다시 확인).
 * 실시간 서버(WebSocket) 없이 쓰므로 새 알림은 최대 이 시간만큼 늦게 보일 수 있다.
 */
export const NOTIFICATION_POLL_MS = 30_000;

/**
 * 캐시 키에 사용자 ID를 넣어 같은 브라우저에서 다른 계정으로 로그인해도 이전 사용자의 알림이 보이지 않게 한다.
 * 무효화는 `notificationKeys.all(userId)`로 하면 목록·개수가 함께 갱신된다.
 */
export const notificationKeys = Object.freeze({
  all: (userId) => ['notifications', userId ?? 'guest'],
  unreadCount: (userId) => ['notifications', userId ?? 'guest', 'unread-count'],
  list: (userId, page) => ['notifications', userId ?? 'guest', 'list', page],
});

/** NOTI-01. 응답: { data, pagination, unreadCount }. 조회만으로는 읽음 처리되지 않는다. */
export async function fetchNotifications(page = 1) {
  const res = await apiClient.get('/notifications', { params: { page } });
  return res.data;
}

/** NOTI-02 */
export async function fetchUnreadCount() {
  const res = await apiClient.get('/notifications/unread-count');
  return res.data.data.count;
}

/** NOTI-03. 이미 읽은 알림도 200(멱등). */
export async function markNotificationRead(notificationId) {
  const res = await apiClient.patch(`/notifications/${notificationId}/read`);
  return res.data.data;
}

/** NOTI-04. 응답: { updatedCount } */
export async function markAllNotificationsRead() {
  const res = await apiClient.patch('/notifications/read-all');
  return res.data.data;
}
