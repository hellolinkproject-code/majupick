/**
 * 모집 상태 자동 동기화(자동 마감) 실행 주기. 별도 인프라 없이 API 프로세스 안에서 돈다(D-99 제안).
 * - 서버 시작 직후 1회 실행: 서버가 꺼져 있던 동안 지난 마감을 따라잡는다.
 * - 이후 RECRUIT_SYNC_INTERVAL_MS마다 실행(기본 60초, 0이면 끈다 → 외부 스케줄러가
 *   `npm run job:sync-project-status -w apps/api`를 부르는 방식으로 바꿀 수 있다).
 * - 이전 실행이 끝나지 않았으면 이번 차례는 건너뛴다. 서버 여러 대가 동시에 돌려도
 *   프로젝트별 행 잠금 + 조건부 UPDATE + 알림 event_key UNIQUE로 결과가 한 번만 반영된다.
 * 마감 경계(다음 날 0시 KST)와 실제 반영 사이에는 최대 한 주기의 지연이 있다. 그 사이에도
 * 화면·검색은 날짜로 계산한 상태를 보여 주고, 새 지원·선정은 실제 상태 확인으로 막힌다(D-83).
 */
export const DEFAULT_RECRUIT_SYNC_INTERVAL_MS = 60_000;
export const MIN_RECRUIT_SYNC_INTERVAL_MS = 5_000;
const MAX_RECRUIT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class JobConfigError extends Error {}

export function parseRecruitSyncInterval(value) {
  if (value === undefined || value === '') return DEFAULT_RECRUIT_SYNC_INTERVAL_MS;
  const ms = /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  if (ms === 0) return 0;
  if (ms >= MIN_RECRUIT_SYNC_INTERVAL_MS && ms <= MAX_RECRUIT_SYNC_INTERVAL_MS) return ms;
  throw new JobConfigError(
    `RECRUIT_SYNC_INTERVAL_MS must be 0 (disabled) or between ${MIN_RECRUIT_SYNC_INTERVAL_MS} and ${MAX_RECRUIT_SYNC_INTERVAL_MS} (received "${value}")`,
  );
}

/** 바뀐 것이 있거나 실패했을 때만 남긴다(매 주기 로그로 덮이지 않게). */
export function describeSyncSummary(summary) {
  const changed = summary.started + summary.closed + summary.rejectedApplications;
  if (changed === 0 && summary.failed.length === 0) return null;
  return (
    `started=${summary.started} closed=${summary.closed} ` +
    `rejectedApplications=${summary.rejectedApplications} notifications=${summary.notifications} ` +
    `failed=${summary.failed.length}`
  );
}

/**
 * @param {{
 *   run: () => Promise<object>,
 *   intervalMs: number,
 *   logger?: { log: Function, error: Function },
 *   timers?: { setInterval: Function, clearInterval: Function },
 * }} options
 * @returns {{ firstRun: Promise<void>, tick: () => Promise<'ran'|'skipped'>, stop: () => Promise<void> }}
 */
export function startRecruitStatusScheduler({
  run,
  intervalMs,
  logger = console,
  timers = { setInterval, clearInterval },
}) {
  let running = null;

  function tick() {
    if (running) return Promise.resolve('skipped');
    running = (async () => {
      try {
        const summary = await run();
        const line = describeSyncSummary(summary);
        if (line) logger.log(`[jobs] recruit status sync: ${line}`);
        for (const failure of summary.failed) {
          logger.error(
            `[jobs] recruit status sync failed for project ${failure.projectId}: ${failure.message}`,
          );
        }
      } catch (error) {
        logger.error(`[jobs] recruit status sync failed: ${error?.message ?? error}`);
      } finally {
        running = null;
      }
      return 'ran';
    })();
    return running;
  }

  const firstRun = tick().then(() => undefined);
  const timer = timers.setInterval(tick, intervalMs);
  timer?.unref?.();

  return {
    firstRun,
    tick,
    async stop() {
      timers.clearInterval(timer);
      await running;
    },
  };
}
