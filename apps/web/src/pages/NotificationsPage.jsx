import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '../lib/authApi.js';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_POLL_MS,
  notificationKeys,
} from '../lib/notificationApi.js';
import {
  formatNotificationTime,
  NOTIFICATION_TYPE_LABELS,
  safeNotificationPath,
} from '../lib/notificationLinks.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function pageFrom(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/**
 * NOTI-01~04 알림 목록. 최신순 20개씩. 화면을 여는 것만으로는 읽음 처리하지 않는다.
 * 알림을 누르면 서버에서 읽음 처리가 끝난 뒤 관련 화면으로 이동한다(허용된 내부 경로만).
 */
export function NotificationsPage() {
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const [feedback, setFeedback] = useState(null);

  const list = useQuery({
    queryKey: notificationKeys.list(userId, page),
    queryFn: () => fetchNotifications(page),
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
    enabled: userId !== null,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: ({ updatedCount }) => {
      setFeedback({ kind: 'success', text: `알림 ${updatedCount}개를 읽음으로 표시했습니다.` });
      return refresh();
    },
    onError: (error) => setFeedback({ kind: 'error', text: parseApiError(error).message }),
  });

  async function open(notification) {
    setFeedback(null);
    if (!notification.isRead) {
      try {
        await readOne.mutateAsync(notification.id);
      } catch (error) {
        setFeedback({ kind: 'error', text: parseApiError(error).message });
        return;
      }
    }
    const path = safeNotificationPath(notification.linkUrl);
    if (path) navigate(path);
    else setFeedback({ kind: 'error', text: '이 알림은 이동할 화면이 없습니다.' });
  }

  let body;
  if (list.isPending) {
    body = <p className="page-status">알림을 불러오는 중…</p>;
  } else if (list.isError) {
    body = (
      <div className="form-alert" role="alert">
        <p>{parseApiError(list.error).message}</p>
        <button type="button" className="button button--small" onClick={() => list.refetch()}>
          다시 시도
        </button>
      </div>
    );
  } else if (list.data.data.length === 0) {
    body = (
      <div className="profile-card empty-state">
        <p>{page > 1 ? '이 페이지에는 알림이 없습니다.' : '아직 받은 알림이 없습니다.'}</p>
      </div>
    );
  } else {
    const { pagination } = list.data;
    body = (
      <>
        <ul className="notification-list" aria-label="알림 목록">
          {list.data.data.map((notification) => (
            <li
              key={notification.id}
              className={`notification-item${notification.isRead ? '' : ' notification-item--unread'}`}
            >
              <button
                type="button"
                className="notification-item__button"
                onClick={() => open(notification)}
                disabled={readOne.isPending}
              >
                <span className="notification-item__meta">
                  <span className="chip">{NOTIFICATION_TYPE_LABELS[notification.type]}</span>
                  {!notification.isRead && (
                    <span className="notification-item__unread">읽지 않음</span>
                  )}
                  <time dateTime={notification.createdAt}>
                    {formatNotificationTime(notification.createdAt)}
                  </time>
                </span>
                <strong className="notification-item__title">{notification.title}</strong>
                <span className="notification-item__message">{notification.message}</span>
              </button>
            </li>
          ))}
        </ul>
        {pagination.totalPages > 1 && (
          <nav className="pagination" aria-label="페이지">
            <button
              type="button"
              className="button button--small button--ghost"
              disabled={page <= 1}
              onClick={() => setSearchParams({ page: String(page - 1) })}
            >
              이전
            </button>
            <span>
              {page} / {pagination.totalPages} 페이지 (총 {pagination.totalCount}개)
            </span>
            <button
              type="button"
              className="button button--small button--ghost"
              disabled={page >= pagination.totalPages}
              onClick={() => setSearchParams({ page: String(page + 1) })}
            >
              다음
            </button>
          </nav>
        )}
      </>
    );
  }

  const unreadCount = list.data?.unreadCount ?? 0;
  return (
    <section className="project-page notification-page">
      <div className="project-page__heading">
        <h1>알림</h1>
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => readAll.mutate()}
          disabled={unreadCount === 0 || readAll.isPending}
        >
          {readAll.isPending ? '처리하는 중…' : '모두 읽음'}
        </button>
      </div>
      <p className="form-field__hint">
        {list.isSuccess && `읽지 않은 알림 ${unreadCount}개 · `}새 알림은 30초마다 확인합니다.
      </p>
      {feedback && (
        <p
          className={feedback.kind === 'success' ? 'form-success' : 'form-alert'}
          role={feedback.kind === 'success' ? 'status' : 'alert'}
        >
          {feedback.text}
        </p>
      )}
      {body}
    </section>
  );
}
