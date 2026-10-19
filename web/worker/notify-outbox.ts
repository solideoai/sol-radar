import { processOutboxBatch, type NotificationOutboxStore } from "@/server/notifications";
import { errorNameOf } from "@/worker/error-name";

// ── 인앱 알림 outbox 주기 처리(docs/13-NOTIFICATIONS.md "pending polling") ──
// 기동 때 한 번, 그 뒤 NOTIFY_POLL_INTERVAL_MS(기본 2초)마다 processOutboxBatch 를 돈다. 규칙은 notifications 도메인에 있고
// 여기는 설정 읽기와 타이머만 둔다. 모양은 analysis-reconcile 의 startReconciler 와 같다.
// Redis 를 쓰지 않는다. 처리할 이벤트는 outbox_events 표에서 직접 찾는다(service role).

export type NotifySettings = { intervalMs: number; batchLimit: number };

const INTERVAL_KEY = "NOTIFY_POLL_INTERVAL_MS";
const DEFAULT_INTERVAL_MS = 2_000;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 60_000;
const BATCH_LIMIT = 50;
const DECIMAL_INTEGER = /^[0-9]+$/;

/** 빈 값은 기본값, 500 이상 60000 이하 10진 정수만 받는다. 오류에는 키 이름만 싣고 값은 싣지 않는다. */
export function readNotifySettings(env: Record<string, string | undefined>): NotifySettings {
  const raw = env[INTERVAL_KEY]?.trim() ?? "";
  if (raw === "") return { intervalMs: DEFAULT_INTERVAL_MS, batchLimit: BATCH_LIMIT };
  const intervalMs = DECIMAL_INTEGER.test(raw) ? Number(raw) : Number.NaN;
  if (!(intervalMs >= MIN_INTERVAL_MS && intervalMs <= MAX_INTERVAL_MS)) {
    throw new Error(`worker env 오류: ${INTERVAL_KEY}`);
  }
  return { intervalMs, batchLimit: BATCH_LIMIT };
}

export type NotifierDeps = {
  store: NotificationOutboxStore;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
  settings: NotifySettings;
};

type NotifierTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

/**
 * 기동 때 한 번, 그 뒤 intervalMs 마다 돈다. 앞 회차가 안 끝났으면 이번 회차는 건너뛴다(겹치지 않는다).
 * 회차 오류는 삼키고 로그 한 줄만 남긴다(worker 를 죽이지 않는다). stop 은 타이머를 멈추고 진행 중 회차를 기다린다.
 */
export function startNotifier(
  deps: NotifierDeps,
  timers: NotifierTimers = { setInterval, clearInterval },
): { stop(): Promise<void> } {
  // 진행 중인 회차. 끝나면 null 로 되돌린다. 이 closure 밖에서는 보이지 않는다.
  let running: Promise<void> | null = null;
  let isStopped = false;

  const round = () => {
    if (isStopped || running !== null) return;
    running = processOutboxBatch({
      store: deps.store,
      now: deps.now,
      log: deps.log,
      limit: deps.settings.batchLimit,
    }).then(
      () => undefined,
      (error: unknown) => {
        deps.log(JSON.stringify({ event: "notify.outbox.failed", errorName: errorNameOf(error) }));
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
      if (running !== null) await running;
    },
  };
}
