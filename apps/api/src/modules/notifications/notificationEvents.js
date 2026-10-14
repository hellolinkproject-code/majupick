/**
 * RFP 3.3.1 필수 인앱 알림 5종(A-36)의 문구·이동 경로·중복 방지 키.
 * 알림은 상태를 바꾼 트랜잭션(tx) 안에서 만든다. 저장에 실패하면 지원·선정·거절·마감도 함께 롤백된다.
 * 문구에는 프로젝트 제목·지원자 이름(공개 프로필 범위)만 넣고 지원 내용·금액·연락처는 넣지 않는다.
 */

export const NOTIFICATION_TYPES = Object.freeze([
  'APPLICATION_SUBMITTED',
  'APPLICATION_ACCEPTED',
  'APPLICATION_AUTO_REJECTED',
  'APPLICATION_REJECTED',
  'PROJECT_CLOSED',
]);

/** 알림이 가리킬 수 있는 서비스 내부 경로. 이 목록 밖의 값은 저장하지도, 내려보내지도 않는다. */
export const NOTIFICATION_LINK_PATTERN =
  /^\/(?:projects\/[1-9]\d{0,9}(?:#applicants)?|me\/applications|me\/projects)$/;

export const isSafeNotificationLink = (value) =>
  typeof value === 'string' && NOTIFICATION_LINK_PATTERN.test(value);

const links = Object.freeze({
  applicants: (projectId) => `/projects/${projectId}#applicants`,
  myApplications: () => '/me/applications',
});

/** 같은 이벤트는 지원서 하나에 유형별로 한 번만 생긴다(notifications.event_key UNIQUE). */
export const notificationEventKey = (type, applicationId) => `${type}:application:${applicationId}`;

const quoted = (title) => `'${title}'`;

/** 모집 마감 사유(PROJECT_CLOSED 알림 문구에만 쓰인다). */
export const CLOSE_REASONS = Object.freeze({ MANUAL: 'MANUAL', DEADLINE: 'DEADLINE' });

function closedMessage(title, reason, wasPending) {
  if (!wasPending) return `${quoted(title)} 프로젝트의 모집이 마감되었습니다.`;
  return reason === CLOSE_REASONS.MANUAL
    ? `${quoted(title)} 프로젝트의 의뢰인이 모집을 마감하여 대기 중이던 지원이 자동으로 거절되었습니다.`
    : `${quoted(title)} 프로젝트의 모집 기간이 끝나 대기 중이던 지원이 자동으로 거절되었습니다.`;
}

/** 알림 한 건의 저장 값. project는 { id, title, clientId }, application은 { id, freelancerId }. */
export const buildNotification = Object.freeze({
  /** ① 지원 → 의뢰인 */
  submitted: ({ project, application, freelancerName }) => ({
    userId: project.clientId,
    type: 'APPLICATION_SUBMITTED',
    projectId: project.id,
    applicationId: application.id,
    title: '새 지원자가 있습니다',
    message: `${freelancerName}님이 ${quoted(project.title)} 프로젝트에 지원했습니다.`,
    linkUrl: links.applicants(project.id),
    eventKey: notificationEventKey('APPLICATION_SUBMITTED', application.id),
  }),
  /** ② 선정 → 선정된 프리랜서 */
  accepted: ({ project, application }) => ({
    userId: application.freelancerId,
    type: 'APPLICATION_ACCEPTED',
    projectId: project.id,
    applicationId: application.id,
    title: '지원이 선정되었습니다',
    message: `${quoted(project.title)} 프로젝트의 지원자로 선정되었습니다.`,
    linkUrl: links.myApplications(),
    eventKey: notificationEventKey('APPLICATION_ACCEPTED', application.id),
  }),
  /** ③ 다른 지원자 선정으로 자동 거절 → 각 프리랜서 */
  autoRejected: ({ project, application }) => ({
    userId: application.freelancerId,
    type: 'APPLICATION_AUTO_REJECTED',
    projectId: project.id,
    applicationId: application.id,
    title: '지원 결과 안내',
    message: `${quoted(project.title)} 프로젝트에 다른 지원자가 선정되어 지원이 자동으로 거절되었습니다.`,
    linkUrl: links.myApplications(),
    eventKey: notificationEventKey('APPLICATION_AUTO_REJECTED', application.id),
  }),
  /** ④ 직접 거절 → 해당 프리랜서 */
  rejected: ({ project, application }) => ({
    userId: application.freelancerId,
    type: 'APPLICATION_REJECTED',
    projectId: project.id,
    applicationId: application.id,
    title: '지원 결과 안내',
    message: `${quoted(project.title)} 프로젝트의 의뢰인이 지원을 거절했습니다.`,
    linkUrl: links.myApplications(),
    eventKey: notificationEventKey('APPLICATION_REJECTED', application.id),
  }),
  /** ⑤ 모집 마감(수동·자동) → 지원자 전원. wasPending: 이번 마감으로 자동 거절된 지원인지 */
  closed: ({ project, application, reason, wasPending }) => ({
    userId: application.freelancerId,
    type: 'PROJECT_CLOSED',
    projectId: project.id,
    applicationId: application.id,
    title: '모집이 마감되었습니다',
    message: closedMessage(project.title, reason, wasPending),
    linkUrl: links.myApplications(),
    eventKey: notificationEventKey('PROJECT_CLOSED', application.id),
  }),
});

/**
 * 같은 트랜잭션에서 알림을 저장한다. 이미 있는 event_key는 건너뛴다(ON CONFLICT DO NOTHING):
 * 같은 이벤트를 다시 처리해도 알림은 하나만 남는다. 저장한 건수를 돌려준다.
 */
export async function writeNotifications(tx, notifications) {
  if (notifications.length === 0) return 0;
  for (const notification of notifications) {
    if (!isSafeNotificationLink(notification.linkUrl)) {
      throw new Error(`Refusing to store an unsafe notification link: ${notification.linkUrl}`);
    }
  }
  const { count } = await tx.notification.createMany({ data: notifications, skipDuplicates: true });
  return count;
}

/** 지원(APP-01) 트랜잭션 안에서 의뢰인에게 ①을 만든다. */
export async function notifyApplicationSubmitted(tx, { project, application }) {
  const freelancer = await tx.user.findUnique({
    where: { id: application.freelancerId },
    select: { name: true },
  });
  return writeNotifications(tx, [
    buildNotification.submitted({ project, application, freelancerName: freelancer.name }),
  ]);
}

/** 선정·거절(DEC-01·02) 트랜잭션 안에서 ②③ 또는 ④를 만든다. 실제로 바뀐 지원에만 보낸다. */
export async function notifyDecision(tx, { type, project, application, autoRejected = [] }) {
  if (type === 'REJECTED') {
    return writeNotifications(tx, [buildNotification.rejected({ project, application })]);
  }
  return writeNotifications(tx, [
    buildNotification.accepted({ project, application }),
    ...autoRejected.map((rejected) =>
      buildNotification.autoRejected({ project, application: rejected }),
    ),
  ]);
}

/** 마감 트랜잭션 안에서 지원자 전원에게 ⑤를 만든다. */
export async function notifyProjectClosed(tx, { project, reason, rejected, others }) {
  return writeNotifications(tx, [
    ...rejected.map((application) =>
      buildNotification.closed({ project, application, reason, wasPending: true }),
    ),
    ...others.map((application) =>
      buildNotification.closed({ project, application, reason, wasPending: false }),
    ),
  ]);
}
