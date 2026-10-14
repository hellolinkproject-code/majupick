import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECRUIT_SYNC_INTERVAL_MS,
  describeSyncSummary,
  JobConfigError,
  parseRecruitSyncInterval,
  startRecruitStatusScheduler,
} from '../src/jobs/recruitStatusScheduler.js';
import {
  buildNotification,
  CLOSE_REASONS,
  isSafeNotificationLink,
  notificationEventKey,
  notifyDecision,
  notifyProjectClosed,
  writeNotifications,
} from '../src/modules/notifications/notificationEvents.js';
import { toNotification } from '../src/modules/notifications/notification.service.js';
import {
  parseNotificationId,
  parseNotificationListQuery,
} from '../src/modules/notifications/notifications.router.js';

const project = { id: 41, title: '쇼핑몰 리뉴얼', clientId: 7 };
const application = { id: 12, freelancerId: 8 };

function fakeTx() {
  const created = [];
  return {
    created,
    notification: {
      createMany: vi.fn(async ({ data, skipDuplicates }) => {
        created.push({ data, skipDuplicates });
        return { count: data.length };
      }),
    },
  };
}

describe('notification links', () => {
  it('allows only the internal pages notifications point to', () => {
    for (const link of [
      '/projects/41#applicants',
      '/projects/41',
      '/me/applications',
      '/me/projects',
    ]) {
      expect(isSafeNotificationLink(link)).toBe(true);
    }
    for (const link of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/projects/0',
      '/projects/41/../../admin',
      '/projects/41#other',
      '/me/applications?next=https://evil.example',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isSafeNotificationLink(link)).toBe(false);
    }
  });

  it('drops an unexpected stored link instead of sending it to the browser', () => {
    const row = {
      id: 1,
      type: 'APPLICATION_REJECTED',
      title: 't',
      message: 'm',
      linkUrl: 'https://evil.example',
      projectId: null,
      applicationId: null,
      readAt: null,
      createdAt: new Date('2026-10-14T00:00:00Z'),
    };
    expect(toNotification(row)).toMatchObject({ linkUrl: null, isRead: false });
    expect(
      toNotification({ ...row, linkUrl: '/me/applications', readAt: new Date() }),
    ).toMatchObject({
      linkUrl: '/me/applications',
      isRead: true,
    });
  });
});

describe('notification builders (RFP 3.3.1 ①~⑤)', () => {
  it('builds each type for the right recipient with a per-application event key', () => {
    const submitted = buildNotification.submitted({
      project,
      application,
      freelancerName: '박프리',
    });
    expect(submitted).toEqual({
      userId: 7,
      type: 'APPLICATION_SUBMITTED',
      projectId: 41,
      applicationId: 12,
      title: '새 지원자가 있습니다',
      message: "박프리님이 '쇼핑몰 리뉴얼' 프로젝트에 지원했습니다.",
      linkUrl: '/projects/41#applicants',
      eventKey: 'APPLICATION_SUBMITTED:application:12',
    });
    expect(buildNotification.accepted({ project, application })).toMatchObject({
      userId: 8,
      type: 'APPLICATION_ACCEPTED',
      linkUrl: '/me/applications',
      eventKey: notificationEventKey('APPLICATION_ACCEPTED', 12),
    });
    expect(buildNotification.autoRejected({ project, application }).userId).toBe(8);
    expect(buildNotification.rejected({ project, application }).type).toBe('APPLICATION_REJECTED');

    const manual = buildNotification.closed({
      project,
      application,
      reason: CLOSE_REASONS.MANUAL,
      wasPending: true,
    });
    const deadline = buildNotification.closed({
      project,
      application,
      reason: CLOSE_REASONS.DEADLINE,
      wasPending: true,
    });
    const earlier = buildNotification.closed({
      project,
      application,
      reason: CLOSE_REASONS.DEADLINE,
      wasPending: false,
    });
    expect(manual.message).toContain('의뢰인이 모집을 마감하여');
    expect(deadline.message).toContain('모집 기간이 끝나');
    expect(earlier.message).toBe("'쇼핑몰 리뉴얼' 프로젝트의 모집이 마감되었습니다.");
    expect(new Set([manual.eventKey, deadline.eventKey, earlier.eventKey])).toEqual(
      new Set(['PROJECT_CLOSED:application:12']),
    );
  });

  it('keeps messages within the column size for the longest titles and names', () => {
    const longProject = { ...project, title: '가'.repeat(100) };
    const longest = [
      buildNotification.submitted({
        project: longProject,
        application,
        freelancerName: '나'.repeat(50),
      }),
      buildNotification.autoRejected({ project: longProject, application }),
      buildNotification.closed({
        project: longProject,
        application,
        reason: 'MANUAL',
        wasPending: true,
      }),
    ];
    for (const notification of longest) {
      expect(notification.message.length).toBeLessThanOrEqual(255);
      expect(notification.title.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('writeNotifications', () => {
  it('stores with ON CONFLICT DO NOTHING and returns the stored count', async () => {
    const tx = fakeTx();
    const count = await notifyDecision(tx, {
      type: 'ACCEPTED',
      project,
      application,
      autoRejected: [
        { id: 13, freelancerId: 9 },
        { id: 14, freelancerId: 10 },
      ],
    });
    expect(count).toBe(3);
    expect(tx.created[0].skipDuplicates).toBe(true);
    expect(tx.created[0].data.map((n) => [n.type, n.userId])).toEqual([
      ['APPLICATION_ACCEPTED', 8],
      ['APPLICATION_AUTO_REJECTED', 9],
      ['APPLICATION_AUTO_REJECTED', 10],
    ]);

    const rejectTx = fakeTx();
    await notifyDecision(rejectTx, { type: 'REJECTED', project, application });
    expect(rejectTx.created[0].data.map((n) => n.type)).toEqual(['APPLICATION_REJECTED']);
  });

  it('writes nothing for an empty list and refuses an unsafe link', async () => {
    const tx = fakeTx();
    expect(
      await notifyProjectClosed(tx, { project, reason: 'MANUAL', rejected: [], others: [] }),
    ).toBe(0);
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    await expect(
      writeNotifications(tx, [
        { ...buildNotification.rejected({ project, application }), linkUrl: '//evil' },
      ]),
    ).rejects.toThrow(/unsafe notification link/);
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('notification query parsing', () => {
  it('parses page and unreadOnly strictly', () => {
    expect(parseNotificationListQuery({})).toEqual({ page: 1, unreadOnly: false });
    expect(parseNotificationListQuery({ page: '2', unreadOnly: 'true' })).toEqual({
      page: 2,
      unreadOnly: true,
    });
    expect(parseNotificationListQuery({ unreadOnly: 'false' }).unreadOnly).toBe(false);
    expect(() => parseNotificationListQuery({ unreadOnly: '1' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => parseNotificationListQuery({ page: '0' })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('turns malformed IDs into 404', () => {
    expect(parseNotificationId('15')).toBe(15);
    for (const value of ['0', 'abc', '-1', '1e3', '9999999999']) {
      expect(() => parseNotificationId(value)).toThrow(expect.objectContaining({ status: 404 }));
    }
  });
});

describe('recruit status scheduler', () => {
  it('parses the interval: default 60s, 0 disables, rejects out-of-range values', () => {
    expect(parseRecruitSyncInterval(undefined)).toBe(DEFAULT_RECRUIT_SYNC_INTERVAL_MS);
    expect(parseRecruitSyncInterval('')).toBe(60_000);
    expect(parseRecruitSyncInterval('0')).toBe(0);
    expect(parseRecruitSyncInterval('300000')).toBe(300_000);
    for (const value of ['100', '-1', 'abc', '86400001', '1.5']) {
      expect(() => parseRecruitSyncInterval(value)).toThrow(JobConfigError);
    }
  });

  it('runs once on start, then on each tick, skipping a tick while the previous run is busy', async () => {
    let release;
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              started: 0,
              closed: 0,
              rejectedApplications: 0,
              notifications: 0,
              failed: [],
            });
        }),
    );
    const timers = { setInterval: vi.fn(() => ({ unref: vi.fn() })), clearInterval: vi.fn() };
    const scheduler = startRecruitStatusScheduler({
      run,
      intervalMs: 60_000,
      logger: { log: vi.fn(), error: vi.fn() },
      timers,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(await scheduler.tick()).toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await scheduler.firstRun;
    const next = scheduler.tick();
    expect(run).toHaveBeenCalledTimes(2);
    release();
    expect(await next).toBe('ran');
    await scheduler.stop();
    expect(timers.clearInterval).toHaveBeenCalled();
  });

  it('logs changes and failures but keeps running after an error', async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({
        started: 1,
        closed: 2,
        rejectedApplications: 3,
        notifications: 4,
        failed: [{ projectId: 9, message: 'boom' }],
      });
    const scheduler = startRecruitStatusScheduler({
      run,
      intervalMs: 5_000,
      logger,
      timers: { setInterval: () => null, clearInterval: () => {} },
    });
    await scheduler.firstRun;
    expect(logger.error).toHaveBeenCalledWith('[jobs] recruit status sync failed: db down');
    await scheduler.tick();
    expect(logger.log).toHaveBeenCalledWith(
      '[jobs] recruit status sync: started=1 closed=2 rejectedApplications=3 notifications=4 failed=1',
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[jobs] recruit status sync failed for project 9: boom',
    );
    await scheduler.stop();
  });

  it('stays quiet when nothing changed', () => {
    expect(
      describeSyncSummary({
        started: 0,
        closed: 0,
        rejectedApplications: 0,
        notifications: 0,
        failed: [],
      }),
    ).toBeNull();
  });
});
