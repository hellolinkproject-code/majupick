import { CLOSE_REASONS, notifyProjectClosed } from '../notifications/notificationEvents.js';
import { effectiveStatus, OPEN_STATUSES, todayKst, toDbDate } from './projectStatus.js';

/**
 * 모집 마감(A-24·A-34)과 날짜에 따른 상태 저장. 수동 마감(STAT-01), 주기 작업(recruitStatusJob),
 * 수정·삭제 전 동기화가 모두 이 함수들을 쓴다. 호출자는 프로젝트 행을 FOR UPDATE로 잠근 트랜잭션을 넘긴다.
 * 지원(FOR SHARE)·선정·거절(FOR UPDATE)도 같은 행을 먼저 잠그므로 마감과 엇갈려 처리되지 않는다.
 */

/**
 * 잠근 프로젝트를 마감한다. 한 트랜잭션 안에서
 * ① 저장 상태가 모집 예정·모집 중이면 CLOSED + closed_at
 * ② PENDING 지원 → REJECTED(PROJECT_CLOSED) + decided_at (조건부 UPDATE라 다시 실행해도 같은 결과)
 * ③ 지원자 전원에게 알림 ⑤(이번에 거절된 지원 + 이전에 거절된 지원). ACCEPTED는 건드리지 않는다.
 * 계약 단계·취소 상태는 호출자가 걸러야 한다. 여기서도 저장 상태를 덮어쓰지 않는다.
 * @param {{ now: Date, reason: 'MANUAL'|'DEADLINE', afterClose?: Function }} options
 */
export async function closeLockedProject(
  tx,
  project,
  { now, reason, afterClose = notifyProjectClosed },
) {
  if (OPEN_STATUSES.has(project.status)) {
    await tx.project.update({
      where: { id: project.id },
      data: { status: 'CLOSED', closedAt: now },
    });
  }
  const rejected = await tx.application.updateManyAndReturn({
    where: { projectId: project.id, status: 'PENDING' },
    data: { status: 'REJECTED', rejectReason: 'PROJECT_CLOSED', decidedAt: now },
    select: { id: true, freelancerId: true },
  });
  const others = await tx.application.findMany({
    where: {
      projectId: project.id,
      status: 'REJECTED',
      id: { notIn: rejected.map((application) => application.id) },
    },
    select: { id: true, freelancerId: true },
    orderBy: { id: 'asc' },
  });
  const notifiedCount = await afterClose(tx, {
    project: { id: project.id, title: project.title, clientId: project.clientId },
    reason,
    rejected,
    others,
    closedAt: now,
  });
  return { rejectedCount: rejected.length, notifiedCount: notifiedCount ?? 0 };
}

/**
 * 잠근 프로젝트의 저장 상태를 오늘(KST) 기준 실제 상태에 맞춘다(D-83의 저장 단계).
 * 시작일 도래: SCHEDULED → RECRUITING. 마감일 경과: 모집 예정·모집 중 → closeLockedProject(DEADLINE).
 * 06-C 이전에 CLOSED로만 저장되고 대기 지원이 남은 프로젝트도 같은 방식으로 정리한다(D-94).
 * 계약 단계·취소·삭제된 프로젝트는 바꾸지 않는다. 바뀐 것이 없으면 아무것도 쓰지 않는다.
 * @returns {Promise<{ project: object|null, started: boolean, closed: boolean, rejectedCount: number, notifiedCount: number }>}
 */
export async function syncLockedProject(tx, projectId, { now, afterClose } = {}) {
  const at = now ?? new Date();
  const result = {
    project: null,
    started: false,
    closed: false,
    rejectedCount: 0,
    notifiedCount: 0,
  };
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.deletedAt) return { ...result, project };

  const status = effectiveStatus(project, todayKst(at));
  let needsClose = OPEN_STATUSES.has(project.status) && status === 'CLOSED';
  if (!needsClose && project.status === 'CLOSED') {
    const pending = await tx.application.count({ where: { projectId, status: 'PENDING' } });
    needsClose = pending > 0;
  }

  if (needsClose) {
    const closed = await closeLockedProject(tx, project, {
      now: at,
      reason: CLOSE_REASONS.DEADLINE,
      afterClose,
    });
    Object.assign(result, closed, { closed: OPEN_STATUSES.has(project.status) });
  } else if (project.status === 'SCHEDULED' && status === 'RECRUITING') {
    await tx.project.update({ where: { id: projectId }, data: { status: 'RECRUITING' } });
    result.started = true;
  } else {
    return { ...result, project };
  }
  return { ...result, project: await tx.project.findUnique({ where: { id: projectId } }) };
}

/**
 * 상태를 저장해야 할 수 있는 프로젝트 ID(오름차순). 실제 처리는 행을 잠근 뒤 다시 판단한다.
 * 시작일 도래한 모집 예정, 마감일 지난 모집 예정·모집 중, 대기 지원이 남은 CLOSED(06-C 이전 데이터).
 */
export async function findProjectsToSync(db, now = new Date()) {
  const today = toDbDate(todayKst(now));
  const rows = await db.project.findMany({
    where: {
      deletedAt: null,
      OR: [
        { status: 'SCHEDULED', recruitStartDate: { lte: today } },
        { status: { in: [...OPEN_STATUSES] }, recruitEndDate: { lt: today } },
        { status: 'CLOSED', applications: { some: { status: 'PENDING' } } },
      ],
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

/**
 * 모집 상태 동기화 1회 실행(자동 마감, A-24·A-34·A-36 ⑤). 프로젝트마다 별도 트랜잭션으로
 * `SELECT … FOR UPDATE` 후 다시 판단하므로, 같은 작업이 겹치거나 서버 여러 대에서 동시에 돌아도
 * 한 프로젝트는 한 번만 마감되고 알림도 한 번만 생긴다(event_key UNIQUE가 마지막 방어선).
 * 한 프로젝트가 실패하면 그 프로젝트만 롤백되고 나머지는 계속 처리한다(다음 실행에서 다시 시도).
 * @param {{ prisma: object, now?: Date, afterClose?: Function }} options
 */
export async function runRecruitStatusSync({ prisma, now = new Date(), afterClose }) {
  const ids = await findProjectsToSync(prisma, now);
  const summary = {
    checked: ids.length,
    started: 0,
    closed: 0,
    rejectedApplications: 0,
    notifications: 0,
    failed: [],
  };
  for (const id of ids) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id} FOR UPDATE`;
        return syncLockedProject(tx, id, { now, afterClose });
      });
      if (result.started) summary.started += 1;
      if (result.closed) summary.closed += 1;
      summary.rejectedApplications += result.rejectedCount;
      summary.notifications += result.notifiedCount;
    } catch (error) {
      summary.failed.push({ projectId: id, message: error?.message ?? String(error) });
    }
  }
  return summary;
}
