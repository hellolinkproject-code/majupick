// 서버 허용 목록(apps/api/src/modules/notifications/notificationEvents.js)과 같은 기준.
// 알림의 이동 경로는 서비스 내부 화면만 허용한다. 그 밖의 값(외부 URL, '//', 조작된 경로)이면 이동하지 않는다.
const NOTIFICATION_PATH =
  /^\/(?:projects\/[1-9]\d{0,9}(?:#applicants)?|me\/applications|me\/projects)$/;

export function safeNotificationPath(linkUrl) {
  return typeof linkUrl === 'string' && NOTIFICATION_PATH.test(linkUrl) ? linkUrl : null;
}

/** 알림 유형 표시 이름(RFP 3.3.1 5종). */
export const NOTIFICATION_TYPE_LABELS = Object.freeze({
  APPLICATION_SUBMITTED: '새 지원',
  APPLICATION_ACCEPTED: '선정',
  APPLICATION_AUTO_REJECTED: '자동 거절',
  APPLICATION_REJECTED: '거절',
  PROJECT_CLOSED: '모집 마감',
});

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 알림 시각(한국 시간). */
export function formatNotificationTime(iso) {
  return timeFormat.format(new Date(iso));
}

/** 헤더 배지 숫자. 100개 이상은 99+로 줄인다. */
export function badgeText(count) {
  return count > 99 ? '99+' : String(count);
}
