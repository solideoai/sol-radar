import { runDeadlineReminders, type DeadlineReminderStore } from "@/server/notifications";
import { errorNameOf } from "@/worker/error-name";

// ── 관심 공고 마감 알림 주기 작업(N3, 설계 D7) ──
// 기동 때 한 번, 그 뒤 DEADLINE_REMINDER_INTERVAL_MS(기본 5분)마다 runDeadlineReminders 를 돈다. 규칙은 DB 함수
// send_deadline_reminders 에 있고 여기는 설정 읽기와 타이머만 둔다. 모양은 notify-outbox 의 startNotifier 와 같다.
// 09:00 KST 뒤 첫 회차가 그날 D-3·D-1 알림을 넣고, 같은 날 다음 회차는 멱등 키에 막혀 0 이다.
// Redis 를 쓰지 않는다(service role 로 DB 함수만 부른다). 실패 뒤 늦추기는 두지 않는다 — 간격이 이미 5분이다.

export type DeadlineSettings = { intervalMs: number };

const INTERVAL_KEY = "DEADLINE_REMINDER_INTERVAL_MS";
const DEFAULT_INTERVAL_MS = 300_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 3_600_000;
const DECIMAL_INTEGER = /^[0-9]+$/;
/** stop 이 진행 중 회차를 기다리는 최대 시간. */
const STOP_WAIT_MS = 5_000;

/** 빈 값은 기본값, 60000 이상 3600000 이하 10진 정수만 받는다. 오류에는 키 이름만 싣고 값은 싣지 않는다. */
export function readDeadlineSettings(env: Record<string, string | undefined>): DeadlineSettings {
  const raw = env[INTERVAL_KEY]?.trim() ?? "";
  if (raw === "") return { intervalMs: DEFAULT_INTERVAL_MS };
  const intervalMs = DECIMAL_INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!(intervalMs >= MIN_INTERVAL_MS && intervalMs <= MAX_INTERVAL_MS)) {
    throw new Error(`worker env 오류: ${INTERVAL_KEY}`);
  }
  return { intervalMs };
}

export type DeadlineReminderWorkerDeps = {
  store: DeadlineReminderStore;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
  settings: DeadlineSettings;
};

type Timers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/**
 * 기동 때 한 번, 그 뒤 intervalMs 마다 돈다. 앞 회차가 안 끝났으면 이번 회차는 건너뛴다(겹치지 않는다).
 * 회차 오류는 삼키고 오류 이름만 실은 로그 한 줄을 남긴다(worker 를 죽이지 않는다).
 * stop 은 타이머를 멈추고 진행 중 회차를 최대 STOP_WAIT_MS 기다린다. 넘으면 stop_timeout 한 줄을 남기고 돌아온다.
 */
export function startDeadlineReminders(
  deps: DeadlineReminderWorkerDeps,
  timers: Timers = { setInterval, clearInterval, setTimeout, clearTimeout },
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  let isStopped = false;

  const round = () => {
    if (isStopped || running !== null) return;
    running = runDeadlineReminders({ store: deps.store, now: deps.now, log: deps.log }).then(
      () => undefined,
      (error: unknown) => {
        deps.log(
          JSON.stringify({ event: "notify.deadline.failed", errorName: errorNameOf(error) }),
        );
      },
    );
    void running.finally(() => {
      running = null;
    });
  };

  round();
  const handle = timers.setInterval(round, deps.settings.intervalMs);

  return {
    async stop() {
      isStopped = true;
      timers.clearInterval(handle);
      const current = running;
      if (current === null) return;
      const isSettled = await new Promise<boolean>((resolve) => {
        const waitHandle = timers.setTimeout(() => resolve(false), STOP_WAIT_MS);
        const settle = () => {
          timers.clearTimeout(waitHandle);
          resolve(true);
        };
        void current.then(settle, settle);
      });
      if (!isSettled) deps.log(JSON.stringify({ event: "notify.deadline.stop_timeout" }));
    },
  };
}
