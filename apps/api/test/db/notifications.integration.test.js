// 알림 5종·읽음 처리(NOTI-01~04)·수동 마감(STAT-01)·자동 마감 작업 통합 테스트.
// 실제 PostgreSQL(workbridge_test) + Supertest. 동시성·롤백은 Mock 없이 실제 트랜잭션·행 잠금으로 확인한다.
// 이번 실행에서 만든 사용자(runId 이메일)·그 사용자의 프로젝트·지원·알림·기술 스택만 만들고 지운다.
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadAuthConfig } from '../../src/config/auth.js';
import { getDatabaseConfig } from '../../src/config/database.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/db/client.js';
import { startRecruitStatusScheduler } from '../../src/jobs/recruitStatusScheduler.js';
import { createApplicationService } from '../../src/modules/applications/application.service.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import {
  notifyApplicationSubmitted,
  notifyDecision,
  notifyProjectClosed,
} from '../../src/modules/notifications/notificationEvents.js';
import { createProjectService } from '../../src/modules/projects/project.service.js';
import { runRecruitStatusSync } from '../../src/modules/projects/projectClosure.js';
import { toDbDate, todayKst } from '../../src/modules/projects/projectStatus.js';

const ORIGIN = 'http://localhost:5173';
const runId = `n${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;
const COVER_LETTER_MARK = `비공개-자기소개-${runId}`;

const config = loadConfig({ CORS_ORIGIN: ORIGIN });
const authConfig = loadAuthConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '1000',
});

let prisma;
let app;
let stack;
const users = {};
const freelancers = [];
const today = todayKst();
const day = (offset) => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
/** KST 벽시계 시각 → Date */
const kst = (dayString, time = '00:00:00.000') => new Date(`${dayString}T${time}+09:00`);

const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });
const withAuth = (req, user) => (user ? req.set(bearer(user)) : req);
const apply = (user, projectId) =>
  request(app)
    .post(`/api/projects/${projectId}/applications`)
    .set(bearer(user))
    .send({ coverLetter: COVER_LETTER_MARK, proposedAmount: '2500000', proposedDurationDays: 30 });
const accept = (user, id) => withAuth(request(app).post(`/api/applications/${id}/accept`), user);
const reject = (user, id) => withAuth(request(app).post(`/api/applications/${id}/reject`), user);
const close = (user, projectId) =>
  withAuth(request(app).post(`/api/projects/${projectId}/close`), user);
const getNotifications = (user, query = {}) =>
  withAuth(request(app).get('/api/notifications'), user).query(query);
const unreadCount = (user) => withAuth(request(app).get('/api/notifications/unread-count'), user);
const markRead = (user, id) => withAuth(request(app).patch(`/api/notifications/${id}/read`), user);
const markAllRead = (user) => withAuth(request(app).patch('/api/notifications/read-all'), user);

async function signup(name, role) {
  const res = await request(app)
    .post('/api/auth/signup')
    .set('Origin', ORIGIN)
    .send({ name: `알림${name}`, email: email(name), password: PASSWORD, role });
  expect(res.status).toBe(201);
  return { id: res.body.data.user.id, token: res.body.data.accessToken, name: `알림${name}` };
}

async function completeFreelancer(user) {
  const res = await request(app)
    .put('/api/users/me/freelancer-profile')
    .set(bearer(user))
    .send({ mainCategory: 'WEB', techStackIds: [stack.id], careerYears: 3, hourlyRate: '50000' });
  expect(res.status).toBe(200);
}

let projectSeq = 0;
/** 날짜가 지났거나 API로 만들 수 없는 상태는 테스트 DB에 직접 넣는다. */
function insertProject(data = {}) {
  projectSeq += 1;
  return prisma.project.create({
    data: {
      clientId: users.client.id,
      title: `알림 대상 ${projectSeq} ${runId}`,
      description: '알림 테스트용 프로젝트',
      category: 'WEB',
      recruitEndDate: toDbDate(day(10)),
      budget: 3_000_000n,
      status: 'RECRUITING',
      ...data,
      techStacks: { create: [{ techStackId: stack.id }] },
    },
  });
}

/** 모집 중 프로젝트에 프리랜서 n명이 API로 지원한다(알림 ① 포함). */
async function projectWithApplicants(count, data = {}) {
  const project = await insertProject(data);
  const ids = [];
  for (const freelancer of freelancers.slice(0, count)) {
    const res = await apply(freelancer, project.id);
    expect(res.status).toBe(201);
    ids.push(res.body.data.id);
  }
  return { project, ids };
}

/** 마감이 지난 프로젝트처럼 API로 지원할 수 없는 경우는 지원 행을 직접 넣는다(알림 ① 없음). */
async function insertApplications(projectId, count, data = {}) {
  const ids = [];
  for (const freelancer of freelancers.slice(0, count)) {
    const row = await prisma.application.create({
      data: {
        projectId,
        freelancerId: freelancer.id,
        coverLetter: COVER_LETTER_MARK,
        proposedAmount: 1_000_000n,
        proposedDurationDays: 10,
        ...data,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

const rowsOf = (projectId) =>
  prisma.application.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
const projectRow = (id) => prisma.project.findUnique({ where: { id } });
const notificationsOf = (projectId, where = {}) =>
  prisma.notification.findMany({ where: { projectId, ...where }, orderBy: { id: 'asc' } });
const freelancerIndex = (userId) => freelancers.findIndex((f) => f.id === userId);

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
  app = createApp(config, { prisma, authConfig });
  stack = await prisma.techStack.create({
    data: { name: `N stack ${runId}`, normalizedName: `nstack${runId}` },
  });

  users.client = await signup('client', 'CLIENT');
  users.otherClient = await signup('client2', 'CLIENT');
  for (const client of [users.client, users.otherClient]) {
    const res = await request(app)
      .put('/api/users/me/client-profile')
      .set(bearer(client))
      .send({ companyName: '알림테스트 주식회사', businessField: 'IT' });
    expect(res.status).toBe(200);
  }
  for (let index = 0; index < 5; index += 1) {
    const freelancer = await signup(`freelancer${index}`, 'FREELANCER');
    await completeFreelancer(freelancer);
    freelancers.push(freelancer);
  }
  const noRole = await prisma.user.create({
    data: { email: email('norole'), name: '역할없음', role: null },
  });
  users.noRole = { id: noRole.id, token: signAccessToken(noRole.id, authConfig) };
});

afterAll(async () => {
  if (!prisma) return;
  const runUsers = { email: { endsWith: `.${runId}@workbridge.test` } };
  await prisma.notification.deleteMany({ where: { user: runUsers } });
  await prisma.application.deleteMany({
    where: { OR: [{ freelancer: runUsers }, { project: { client: runUsers } }] },
  });
  await prisma.project.deleteMany({ where: { client: runUsers } });
  await prisma.user.deleteMany({ where: runUsers });
  await prisma.techStack.deleteMany({ where: { normalizedName: { contains: runId } } });
  await prisma.$disconnect();
});

describe('notifications table', () => {
  it('refuses a second row with the same event_key and any non-internal link', async () => {
    const { project, ids } = await projectWithApplicants(1);
    const [n1] = await notificationsOf(project.id);
    const base = {
      userId: users.client.id,
      type: 'APPLICATION_SUBMITTED',
      projectId: project.id,
      applicationId: ids[0],
      title: 't',
      message: 'm',
    };
    await expect(
      prisma.notification.create({
        data: { ...base, linkUrl: '/me/projects', eventKey: n1.eventKey },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    for (const linkUrl of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      '/\\evil',
    ]) {
      await expect(
        prisma.notification.create({
          data: { ...base, linkUrl, eventKey: `x:${linkUrl}:${runId}` },
        }),
      ).rejects.toThrow();
    }
    expect(await notificationsOf(project.id)).toHaveLength(1);
  });
});

describe('notifications ①~④ with application events', () => {
  it('① tells the client about a new applicant without the cover letter or contact details', async () => {
    const { project, ids } = await projectWithApplicants(1);
    const rows = await notificationsOf(project.id);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: users.client.id,
        type: 'APPLICATION_SUBMITTED',
        applicationId: ids[0],
        linkUrl: `/projects/${project.id}#applicants`,
        eventKey: `APPLICATION_SUBMITTED:application:${ids[0]}`,
        readAt: null,
      }),
    ]);
    expect(rows[0].message).toBe(
      `${freelancers[0].name}님이 '${project.title}' 프로젝트에 지원했습니다.`,
    );
    const body = JSON.stringify((await getNotifications(users.client)).body);
    expect(body).toContain(project.title);
    expect(body).not.toContain(COVER_LETTER_MARK);
    expect(body).not.toMatch(/@workbridge\.test|password|token/i);
    expect(
      await prisma.notification.count({
        where: { userId: freelancers[0].id, projectId: project.id },
      }),
    ).toBe(0);
  });

  it('② and ③ go to the accepted and the auto-rejected freelancers only, once each', async () => {
    const { project, ids } = await projectWithApplicants(4);
    expect((await reject(users.client, ids[3])).status).toBe(200);
    expect((await accept(users.client, ids[1])).status).toBe(200);
    expect((await accept(users.client, ids[1])).status).toBe(409);

    const decided = await notificationsOf(project.id, { type: { not: 'APPLICATION_SUBMITTED' } });
    expect(decided.map((n) => [n.type, n.applicationId, freelancerIndex(n.userId)])).toEqual([
      ['APPLICATION_REJECTED', ids[3], 3],
      ['APPLICATION_ACCEPTED', ids[1], 1],
      ['APPLICATION_AUTO_REJECTED', ids[0], 0],
      ['APPLICATION_AUTO_REJECTED', ids[2], 2],
    ]);
    expect(decided.every((n) => n.linkUrl === '/me/applications')).toBe(true);
    expect(decided[1].message).toBe(`'${project.title}' 프로젝트의 지원자로 선정되었습니다.`);
    expect(decided[2].message).toContain('다른 지원자가 선정되어');
    // 선정된 프로젝트는 계약 대기 그대로이고 마감 알림은 없다.
    expect((await projectRow(project.id)).status).toBe('CONTRACTING');
    expect(await notificationsOf(project.id, { type: 'PROJECT_CLOSED' })).toEqual([]);
  });

  it('④ goes to the directly rejected freelancer and a repeated reject adds nothing', async () => {
    const { project, ids } = await projectWithApplicants(2);
    expect((await reject(users.client, ids[0])).status).toBe(200);
    expect((await reject(users.client, ids[0])).status).toBe(409);
    const rejected = await notificationsOf(project.id, { type: 'APPLICATION_REJECTED' });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ userId: freelancers[0].id, applicationId: ids[0] });
    expect(rejected[0].message).toBe(`'${project.title}' 프로젝트의 의뢰인이 지원을 거절했습니다.`);
  });

  it('rolls back the application when writing notification ① fails', async () => {
    const project = await insertProject();
    const failing = createApplicationService({
      prisma,
      afterApply: async (tx, event) => {
        await notifyApplicationSubmitted(tx, event);
        throw new Error('notification store failed');
      },
    });
    await expect(
      failing.apply(freelancers[0].id, project.id, {
        coverLetter: '롤백',
        proposedAmount: '1000',
        proposedDurationDays: 3,
      }),
    ).rejects.toThrow('notification store failed');
    expect(await rowsOf(project.id)).toEqual([]);
    expect(await notificationsOf(project.id)).toEqual([]);
  });

  it('rolls back the selection, auto-rejects and status when the database refuses a notification', async () => {
    const { project, ids } = await projectWithApplicants(3);
    const before = {
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    };
    const failing = createApplicationService({
      prisma,
      afterDecision: async (tx, event) => {
        await notifyDecision(tx, event);
        // 존재하지 않는 수신자 → FK 위반(DB가 기록을 거부한 경우)
        await tx.notification.create({
          data: {
            userId: 2147483000,
            type: 'APPLICATION_ACCEPTED',
            title: 't',
            message: 'm',
            linkUrl: '/me/applications',
            eventKey: `fk-fail:${runId}`,
          },
        });
      },
    });
    await expect(failing.accept(users.client.id, ids[0])).rejects.toThrow();
    expect({
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    }).toEqual(before);
    expect(await notificationsOf(project.id, { type: { not: 'APPLICATION_SUBMITTED' } })).toEqual(
      [],
    );

    const rejectFailing = createApplicationService({
      prisma,
      afterDecision: async (tx, event) => {
        await notifyDecision(tx, event);
        throw new Error('notification store failed');
      },
    });
    await expect(rejectFailing.reject(users.client.id, ids[1])).rejects.toThrow();
    expect((await rowsOf(project.id))[1].status).toBe('PENDING');
    expect(await notificationsOf(project.id, { type: 'APPLICATION_REJECTED' })).toEqual([]);
  });
});

describe('POST /api/projects/:projectId/close (STAT-01, notification ⑤)', () => {
  it('closes, rejects pending applications and notifies every applicant in one step', async () => {
    const { project, ids } = await projectWithApplicants(3);
    expect((await reject(users.client, ids[2])).status).toBe(200);

    const res = await close(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({
      rejectedCount: 2,
      notifiedCount: 3,
      project: {
        id: project.id,
        status: 'CLOSED',
        publicStatus: 'CLOSED',
        availableActions: ['EDIT', 'DELETE'],
      },
    });

    const stored = await projectRow(project.id);
    expect(stored.status).toBe('CLOSED');
    expect(stored.closedAt).toBeInstanceOf(Date);
    const rows = await rowsOf(project.id);
    expect(rows.map((a) => [a.status, a.rejectReason])).toEqual([
      ['REJECTED', 'PROJECT_CLOSED'],
      ['REJECTED', 'PROJECT_CLOSED'],
      ['REJECTED', 'MANUAL'],
    ]);
    expect(rows[0].decidedAt.getTime()).toBe(stored.closedAt.getTime());

    const closedNotes = await notificationsOf(project.id, { type: 'PROJECT_CLOSED' });
    expect(closedNotes.map((n) => [freelancerIndex(n.userId), n.applicationId])).toEqual([
      [0, ids[0]],
      [1, ids[1]],
      [2, ids[2]],
    ]);
    expect(closedNotes[0].message).toBe(
      `'${project.title}' 프로젝트의 의뢰인이 모집을 마감하여 대기 중이던 지원이 자동으로 거절되었습니다.`,
    );
    expect(closedNotes[2].message).toBe(`'${project.title}' 프로젝트의 모집이 마감되었습니다.`);
    expect(
      await prisma.notification.count({
        where: { projectId: project.id, userId: users.client.id, type: 'PROJECT_CLOSED' },
      }),
    ).toBe(0);

    // 모든 화면에서 같은 결과: 공개 상세·검색 카드 상태와 지원자 본인의 결과.
    expect((await request(app).get(`/api/projects/${project.id}`)).body.data.publicStatus).toBe(
      'CLOSED',
    );
    const mine = await withAuth(request(app).get('/api/me/applications'), freelancers[0]);
    expect(mine.body.data.find((a) => a.id === ids[0])).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'PROJECT_CLOSED',
      project: { publicStatus: 'CLOSED' },
    });
  });

  it('answers a repeated close with 409 and creates no duplicate notifications', async () => {
    const { project } = await projectWithApplicants(2);
    expect((await close(users.client, project.id)).status).toBe(200);
    const after = {
      project: await projectRow(project.id),
      notes: await notificationsOf(project.id),
    };
    const again = await close(users.client, project.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      message: '이미 모집이 마감된 프로젝트입니다.',
    });
    expect({
      project: await projectRow(project.id),
      notes: await notificationsOf(project.id),
    }).toEqual(after);
  });

  it('closes a project without applicants', async () => {
    const project = await insertProject();
    const res = await close(users.client, project.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rejectedCount: 0, notifiedCount: 0 });
    expect((await projectRow(project.id)).status).toBe('CLOSED');
  });

  it('allows only the owner client', async () => {
    const project = await insertProject();
    expect((await close(null, project.id)).status).toBe(401);
    expect((await close(users.noRole, project.id)).body.error.code).toBe('ROLE_REQUIRED');
    expect((await close(freelancers[0], project.id)).status).toBe(403);
    expect((await close(users.otherClient, project.id)).status).toBe(403);
    expect((await close(users.client, 2147483000)).status).toBe(404);
    expect((await close(users.client, 'abc')).status).toBe(404);
    const deleted = await insertProject({ deletedAt: new Date() });
    expect((await close(users.client, deleted.id)).status).toBe(404);
    expect((await projectRow(project.id)).status).toBe('RECRUITING');
  });

  it('refuses scheduled, contract-stage, cancelled and already-expired projects without changes', async () => {
    const cases = [
      [
        { status: 'SCHEDULED', recruitStartDate: toDbDate(day(3)) },
        '모집이 시작되지 않은 프로젝트는 마감할 수 없습니다.',
      ],
      [
        { status: 'CONTRACTING', closedAt: new Date() },
        '이미 지원자를 선정한 프로젝트는 모집을 마감할 수 없습니다.',
      ],
      [
        { status: 'IN_PROGRESS', closedAt: new Date() },
        '이미 지원자를 선정한 프로젝트는 모집을 마감할 수 없습니다.',
      ],
      [
        { status: 'COMPLETED', closedAt: new Date() },
        '이미 지원자를 선정한 프로젝트는 모집을 마감할 수 없습니다.',
      ],
      [{ status: 'CANCELLED', cancelledAt: new Date() }, '취소된 프로젝트는 마감할 수 없습니다.'],
      [
        { recruitStartDate: toDbDate(day(-5)), recruitEndDate: toDbDate(day(-1)) },
        '이미 모집이 마감된 프로젝트입니다.',
      ],
    ];
    for (const [data, message] of cases) {
      const project = await insertProject(data);
      const [applicationId] = await insertApplications(project.id, 1, {
        ...(data.status === 'CONTRACTING' && { status: 'ACCEPTED', decidedAt: new Date() }),
      });
      const before = {
        project: await projectRow(project.id),
        applications: await rowsOf(project.id),
      };
      const res = await close(users.client, project.id);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(message);
      expect({
        project: await projectRow(project.id),
        applications: await rowsOf(project.id),
      }).toEqual(before);
      expect(await notificationsOf(project.id)).toEqual([]);
      expect(applicationId).toBeGreaterThan(0);
    }
  });

  it('rolls back the close when writing notification ⑤ fails', async () => {
    const { project } = await projectWithApplicants(2);
    const before = {
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    };
    const failing = createProjectService({
      prisma,
      afterClose: async (tx, event) => {
        await notifyProjectClosed(tx, event);
        throw new Error('notification store failed');
      },
    });
    await expect(failing.closeProject(users.client.id, project.id)).rejects.toThrow();
    expect({
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    }).toEqual(before);
    expect(await notificationsOf(project.id, { type: 'PROJECT_CLOSED' })).toEqual([]);
  });

  it('never leaves a pending application when a close races with a new application', async () => {
    for (let round = 0; round < 3; round += 1) {
      const project = await insertProject();
      const [closed, applied] = await Promise.all([
        close(users.client, project.id),
        apply(freelancers[round], project.id),
      ]);
      expect(closed.status).toBe(200);
      expect([201, 409]).toContain(applied.status);
      const rows = await rowsOf(project.id);
      expect(rows.filter((a) => a.status === 'PENDING')).toEqual([]);
      if (applied.status === 201) {
        expect(rows).toEqual([
          expect.objectContaining({ status: 'REJECTED', rejectReason: 'PROJECT_CLOSED' }),
        ]);
        expect((await notificationsOf(project.id)).map((n) => n.type).sort()).toEqual([
          'APPLICATION_SUBMITTED',
          'PROJECT_CLOSED',
        ]);
      } else {
        expect(rows).toEqual([]);
        expect(await notificationsOf(project.id)).toEqual([]);
      }
    }
  });

  it('lets exactly one of close and accept win when they race', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { project, ids } = await projectWithApplicants(2);
      const [closed, accepted] = await Promise.all([
        close(users.client, project.id),
        accept(users.client, ids[0]),
      ]);
      expect([closed.status, accepted.status].sort()).toEqual([200, 409]);
      const stored = await projectRow(project.id);
      const rows = await rowsOf(project.id);
      const types = (await notificationsOf(project.id)).map((n) => n.type);
      if (accepted.status === 200) {
        expect(stored.status).toBe('CONTRACTING');
        expect(rows.map((a) => [a.status, a.rejectReason])).toEqual([
          ['ACCEPTED', null],
          ['REJECTED', 'OTHER_ACCEPTED'],
        ]);
        expect(types).not.toContain('PROJECT_CLOSED');
      } else {
        expect(stored.status).toBe('CLOSED');
        expect(rows.every((a) => a.rejectReason === 'PROJECT_CLOSED')).toBe(true);
        expect(types).not.toContain('APPLICATION_ACCEPTED');
      }
    }
  });
});

describe('automatic close job (runRecruitStatusSync)', () => {
  it('follows the KST boundaries: start day opens, deadline day stays open, next 00:00 closes', async () => {
    const start = day(300);
    const end = day(305);
    const project = await insertProject({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate(start),
      recruitEndDate: toDbDate(end),
    });
    const ids = await insertApplications(project.id, 2);
    const run = (now) => runRecruitStatusSync({ prisma, now });

    await run(kst(day(299), '23:59:59.999'));
    expect((await projectRow(project.id)).status).toBe('SCHEDULED');

    await run(kst(start));
    expect((await projectRow(project.id)).status).toBe('RECRUITING');
    expect((await rowsOf(project.id)).map((a) => a.status)).toEqual(['PENDING', 'PENDING']);

    await run(kst(end, '23:59:59.999'));
    expect((await projectRow(project.id)).status).toBe('RECRUITING');
    expect(await notificationsOf(project.id)).toEqual([]);

    const midnight = kst(day(306));
    await run(midnight);
    const stored = await projectRow(project.id);
    expect(stored).toMatchObject({ status: 'CLOSED', closedAt: midnight });
    expect((await rowsOf(project.id)).map((a) => [a.status, a.rejectReason, a.decidedAt])).toEqual([
      ['REJECTED', 'PROJECT_CLOSED', midnight],
      ['REJECTED', 'PROJECT_CLOSED', midnight],
    ]);
    const notes = await notificationsOf(project.id);
    expect(notes.map((n) => [n.type, n.applicationId])).toEqual([
      ['PROJECT_CLOSED', ids[0]],
      ['PROJECT_CLOSED', ids[1]],
    ]);
    expect(notes[0].message).toBe(
      `'${project.title}' 프로젝트의 모집 기간이 끝나 대기 중이던 지원이 자동으로 거절되었습니다.`,
    );
  });

  it('bulk-rejects pending applications and notifies all applicants, including earlier rejections', async () => {
    const project = await insertProject({
      recruitStartDate: toDbDate(day(-10)),
      recruitEndDate: toDbDate(day(-1)),
    });
    const ids = await insertApplications(project.id, 3);
    await prisma.application.update({
      where: { id: ids[2] },
      data: { status: 'REJECTED', rejectReason: 'MANUAL', decidedAt: new Date() },
    });
    const summary = await runRecruitStatusSync({ prisma });
    expect(summary.failed).toEqual([]);
    expect((await rowsOf(project.id)).map((a) => a.rejectReason)).toEqual([
      'PROJECT_CLOSED',
      'PROJECT_CLOSED',
      'MANUAL',
    ]);
    expect((await notificationsOf(project.id)).map((n) => [n.userId, n.type])).toEqual(
      [0, 1, 2].map((index) => [freelancers[index].id, 'PROJECT_CLOSED']),
    );
  });

  it('closes an expired project without applicants and finishes legacy CLOSED rows', async () => {
    const empty = await insertProject({ recruitEndDate: toDbDate(day(-2)) });
    const legacyClosedAt = new Date('2026-10-01T00:00:00.000Z');
    const legacy = await insertProject({
      status: 'CLOSED',
      closedAt: legacyClosedAt,
      recruitEndDate: toDbDate(day(-2)),
    });
    await insertApplications(legacy.id, 2);

    await runRecruitStatusSync({ prisma });
    expect((await projectRow(empty.id)).status).toBe('CLOSED');
    expect(await notificationsOf(empty.id)).toEqual([]);
    expect((await projectRow(legacy.id)).closedAt).toEqual(legacyClosedAt);
    expect((await rowsOf(legacy.id)).every((a) => a.rejectReason === 'PROJECT_CLOSED')).toBe(true);
    expect(await notificationsOf(legacy.id)).toHaveLength(2);
  });

  it('never touches contract-stage, cancelled or deleted projects', async () => {
    const past = { recruitEndDate: toDbDate(day(-3)) };
    const projects = [];
    for (const data of [
      { status: 'CONTRACTING', closedAt: new Date() },
      { status: 'IN_PROGRESS', closedAt: new Date() },
      { status: 'COMPLETED', closedAt: new Date() },
      { status: 'CANCELLED', cancelledAt: new Date() },
      { status: 'RECRUITING', deletedAt: new Date() },
    ]) {
      const project = await insertProject({ ...past, ...data });
      await insertApplications(project.id, 1, {
        ...(data.status === 'CONTRACTING' && { status: 'ACCEPTED', decidedAt: new Date() }),
      });
      projects.push(project);
    }
    const before = await Promise.all(
      projects.map(async (p) => [await projectRow(p.id), await rowsOf(p.id)]),
    );
    await runRecruitStatusSync({ prisma });
    const after = await Promise.all(
      projects.map(async (p) => [await projectRow(p.id), await rowsOf(p.id)]),
    );
    expect(after).toEqual(before);
    for (const project of projects) expect(await notificationsOf(project.id)).toEqual([]);
  });

  it('is idempotent across repeated runs and two concurrent workers', async () => {
    const projects = [];
    for (let index = 0; index < 3; index += 1) {
      const project = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
      await insertApplications(project.id, 3);
      projects.push(project);
    }
    const [first, second] = await Promise.all([
      runRecruitStatusSync({ prisma }),
      runRecruitStatusSync({ prisma }),
    ]);
    expect([...first.failed, ...second.failed]).toEqual([]);
    const snapshot = async () =>
      Promise.all(
        projects.map(async (p) => ({
          project: await projectRow(p.id),
          applications: await rowsOf(p.id),
          notes: await notificationsOf(p.id),
        })),
      );
    const once = await snapshot();
    for (const state of once) {
      expect(state.project.status).toBe('CLOSED');
      expect(state.notes).toHaveLength(3);
      expect(new Set(state.notes.map((n) => n.eventKey)).size).toBe(3);
    }
    await runRecruitStatusSync({ prisma });
    expect(await snapshot()).toEqual(once);
  });

  it('keeps a race between the deadline job and a last-minute accept consistent', async () => {
    for (let round = 0; round < 3; round += 1) {
      const end = day(400 + round);
      const project = await insertProject({ recruitEndDate: toDbDate(end) });
      const ids = await insertApplications(project.id, 2);
      const lastMinute = createApplicationService({
        prisma,
        clock: () => kst(end, '23:59:59.900'),
      });
      const [accepted, summary] = await Promise.allSettled([
        lastMinute.accept(users.client.id, ids[0]),
        runRecruitStatusSync({ prisma, now: kst(day(401 + round)) }),
      ]);
      expect(summary.status).toBe('fulfilled');
      const stored = await projectRow(project.id);
      const rows = await rowsOf(project.id);
      const types = (await notificationsOf(project.id)).map((n) => n.type);
      if (accepted.status === 'fulfilled') {
        expect(stored.status).toBe('CONTRACTING');
        expect(rows.map((a) => a.status)).toEqual(['ACCEPTED', 'REJECTED']);
        expect(types).not.toContain('PROJECT_CLOSED');
      } else {
        expect(accepted.reason.status).toBe(409);
        expect(stored.status).toBe('CLOSED');
        expect(rows.every((a) => a.rejectReason === 'PROJECT_CLOSED')).toBe(true);
        expect(types).toEqual(['PROJECT_CLOSED', 'PROJECT_CLOSED']);
      }
    }
  });

  it('rolls back only the failing project and retries it on the next run', async () => {
    const failing = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    const healthy = await insertProject({ recruitEndDate: toDbDate(day(-1)) });
    await insertApplications(failing.id, 2);
    await insertApplications(healthy.id, 2);

    const summary = await runRecruitStatusSync({
      prisma,
      afterClose: async (tx, event) => {
        const count = await notifyProjectClosed(tx, event);
        if (event.project.id === failing.id) throw new Error('notification store failed');
        return count;
      },
    });
    expect(summary.failed).toEqual([
      { projectId: failing.id, message: 'notification store failed' },
    ]);
    expect((await projectRow(failing.id)).status).toBe('RECRUITING');
    expect((await rowsOf(failing.id)).map((a) => a.status)).toEqual(['PENDING', 'PENDING']);
    expect(await notificationsOf(failing.id)).toEqual([]);
    expect((await projectRow(healthy.id)).status).toBe('CLOSED');
    expect(await notificationsOf(healthy.id)).toHaveLength(2);

    await runRecruitStatusSync({ prisma });
    expect((await projectRow(failing.id)).status).toBe('CLOSED');
    expect(await notificationsOf(failing.id)).toHaveLength(2);
  });

  it('catches up on deadlines missed while the server was stopped, on scheduler start', async () => {
    const project = await insertProject({
      recruitStartDate: toDbDate(day(-20)),
      recruitEndDate: toDbDate(day(-7)),
    });
    await insertApplications(project.id, 1);
    const logs = [];
    const scheduler = startRecruitStatusScheduler({
      run: () => runRecruitStatusSync({ prisma }),
      intervalMs: 60_000,
      logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
    });
    await scheduler.firstRun;
    await scheduler.stop();
    expect((await projectRow(project.id)).status).toBe('CLOSED');
    expect(await notificationsOf(project.id, { type: 'PROJECT_CLOSED' })).toHaveLength(1);
    expect(logs.some((line) => line.startsWith('[jobs] recruit status sync: '))).toBe(true);
  });

  it('blocks new applications right after the deadline even before the job runs, and GET writes nothing', async () => {
    const project = await insertProject({
      recruitStartDate: toDbDate(day(-5)),
      recruitEndDate: toDbDate(day(-1)),
    });
    await insertApplications(project.id, 1);
    const before = {
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    };
    expect((await apply(freelancers[4], project.id)).status).toBe(409);
    expect((await request(app).get(`/api/projects/${project.id}`)).body.data.publicStatus).toBe(
      'CLOSED',
    );
    expect((await withAuth(request(app).get('/api/me/projects'), users.client)).status).toBe(200);
    expect((await withAuth(request(app).get('/api/me/applications'), freelancers[0])).status).toBe(
      200,
    );
    expect((await getNotifications(freelancers[0])).status).toBe(200);
    expect({
      project: await projectRow(project.id),
      applications: await rowsOf(project.id),
    }).toEqual(before);
    expect(await notificationsOf(project.id)).toEqual([]);
  });
});

describe('notification API (NOTI-01~04)', () => {
  let reader;
  let other;

  beforeAll(async () => {
    reader = await signup('reader', 'FREELANCER');
    other = await signup('other', 'CLIENT');
    const base = new Date('2026-10-01T00:00:00.000Z').getTime();
    const rows = [];
    for (let index = 0; index < 23; index += 1) {
      rows.push({
        userId: reader.id,
        type: 'APPLICATION_REJECTED',
        title: `알림 ${index}`,
        message: `메시지 ${index}`,
        linkUrl: '/me/applications',
        eventKey: `test:${runId}:reader:${index}`,
        // 마지막 두 건은 같은 시각: id DESC로 순서가 정해진다.
        createdAt: new Date(base + Math.min(index, 21) * 1000),
      });
    }
    rows.push({
      userId: other.id,
      type: 'APPLICATION_SUBMITTED',
      title: '남의 알림',
      message: '다른 사용자',
      linkUrl: '/me/projects',
      eventKey: `test:${runId}:other:0`,
    });
    await prisma.notification.createMany({ data: rows });
  });

  const readerRows = () =>
    prisma.notification.findMany({ where: { userId: reader.id }, orderBy: { id: 'asc' } });

  it('lists only my notifications, newest first with a stable order, 20 per page', async () => {
    const first = await getNotifications(reader);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 20, totalCount: 23, totalPages: 2 });
    expect(first.body.unreadCount).toBe(23);
    const titles = first.body.data.map((n) => n.title);
    expect(titles.slice(0, 3)).toEqual(['알림 22', '알림 21', '알림 20']);
    const second = await getNotifications(reader, { page: 2 });
    expect(second.body.data.map((n) => n.title)).toEqual(['알림 2', '알림 1', '알림 0']);
    expect(first.body.data[0]).toEqual({
      id: expect.any(Number),
      type: 'APPLICATION_REJECTED',
      title: '알림 22',
      message: '메시지 22',
      linkUrl: '/me/applications',
      projectId: null,
      applicationId: null,
      isRead: false,
      readAt: null,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(first.body)).not.toContain('남의 알림');
    expect((await getNotifications(reader, { page: 3 })).body.data).toEqual([]);
  });

  it('does not mark anything read on GET and counts unread exactly', async () => {
    await getNotifications(reader);
    await unreadCount(reader);
    expect((await readerRows()).every((n) => n.readAt === null)).toBe(true);
    expect((await unreadCount(reader)).body).toEqual({ data: { count: 23 } });
    expect((await unreadCount(other)).body).toEqual({ data: { count: 1 } });
  });

  it('marks one of my notifications read idempotently and hides others’ notifications', async () => {
    const [target] = await readerRows();
    const res = await markRead(reader, target.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: target.id, isRead: true });
    const firstReadAt = res.body.data.readAt;
    const again = await markRead(reader, target.id);
    expect(again.status).toBe(200);
    expect(again.body.data.readAt).toBe(firstReadAt);
    expect((await unreadCount(reader)).body.data.count).toBe(22);
    expect(
      (await getNotifications(reader, { unreadOnly: 'true' })).body.pagination.totalCount,
    ).toBe(22);

    const othersRow = await prisma.notification.findFirst({ where: { userId: other.id } });
    const denied = await markRead(reader, othersRow.id);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');
    expect(
      (await prisma.notification.findUnique({ where: { id: othersRow.id } })).readAt,
    ).toBeNull();
    expect((await markRead(reader, 2147483000)).status).toBe(404);
    expect((await markRead(reader, 'abc')).status).toBe(404);
  });

  it('marks all of my notifications read, persists it, and reports 0 the second time', async () => {
    const res = await markAllRead(reader);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updatedCount: 22 });
    expect((await markAllRead(reader)).body.data).toEqual({ updatedCount: 0 });
    expect((await readerRows()).every((n) => n.readAt instanceof Date)).toBe(true);
    expect((await unreadCount(reader)).body.data.count).toBe(0);
    expect((await unreadCount(other)).body.data.count).toBe(1);
    const list = await getNotifications(reader);
    expect(list.body.data.every((n) => n.isRead)).toBe(true);
    expect(list.body.unreadCount).toBe(0);
  });

  it('requires a signed-in user with a role and validates the query', async () => {
    expect((await getNotifications(null)).status).toBe(401);
    expect((await unreadCount(null)).status).toBe(401);
    expect((await markAllRead(null)).status).toBe(401);
    expect((await unreadCount(users.noRole)).body.error.code).toBe('ROLE_REQUIRED');
    expect((await getNotifications(reader, { unreadOnly: 'yes' })).status).toBe(400);
    expect((await getNotifications(reader, { page: '0' })).status).toBe(400);
  });
});
