import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  fetchUnreadCount,
  NOTIFICATION_POLL_MS,
  notificationKeys,
} from '../lib/notificationApi.js';
import { badgeText } from '../lib/notificationLinks.js';

/**
 * 헤더 알림 아이콘. 읽지 않은 개수를 30초마다, 그리고 창으로 돌아올 때 다시 묻는다(D-37).
 * 개수를 못 받아도 알림 화면으로는 갈 수 있게 링크는 항상 보인다.
 */
export function NotificationBell({ userId }) {
  const unread = useQuery({
    queryKey: notificationKeys.unreadCount(userId),
    queryFn: fetchUnreadCount,
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const count = unread.data ?? 0;

  return (
    <NavLink
      to="/notifications"
      className="notification-bell"
      aria-label={count > 0 ? `알림, 읽지 않은 알림 ${count}개` : '알림'}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {count > 0 && (
        <span className="notification-bell__badge" aria-hidden="true">
          {badgeText(count)}
        </span>
      )}
    </NavLink>
  );
}
