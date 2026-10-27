import {
  assertKakaoTokenKey,
  createKakaoApi,
  createMemoKakaoSender,
  createMockKakaoSender,
  type KakaoLinkStore,
  type KakaoSender,
} from "@/server/kakao-notify";
import {
  processOutboxBatch,
  type KakaoChannelDeps,
  type KakaoOutboxStore,
  type NotificationOutboxStore,
} from "@/server/notifications";
import { errorNameOf } from "@/worker/error-name";

// ── 인앱 알림 outbox 주기 처리(docs/13-NOTIFICATIONS.md "pending polling") ──
// 기동 때 한 번, 그 뒤 NOTIFY_POLL_INTERVAL_MS(기본 2초)마다 processOutboxBatch 를 돈다. 규칙은 notifications 도메인에 있고
// 여기는 설정 읽기와 타이머만 둔다. 모양은 analysis-reconcile 의 startReconciler 와 같다.
// Redis 를 쓰지 않는다. 처리할 이벤트는 outbox_events 표에서 직접 찾는다(service role).
// 회차가 실패하면(DB 장애 등) 다음 회차를 min(intervalMs × 2^연속 실패 수, 60초) 뒤로 미룬다. 장애 동안 2초마다 두드리지 않게.
// 빈 회차(0건)는 성공이라 늦추지 않는다(docs/01-PRD.md 인앱 알림 지연 "분석 완료 후 5초 이내").
// stop 은 진행 중 회차를 최대 5초만 기다린다. Compose 의 stop 은 기본 10초 뒤 SIGKILL 이고 main 이 notify 를 먼저 닫으므로,
// 늦어지면 ingest·analysis 의 종료가 밀린다. 회차는 shouldStop 으로 다음 이벤트에 넘어가지 않는다.
// 카카오톡 추천 공고 알림(설계 docs/plans/2026-10-20-kakao-memo-notify-design.md §8): 같은 회차가 카카오 두 종도 처리한다.
// 발송 수단은 NOTIFY_KAKAO_PROVIDER 로 고른다 — mock 은 외부 호출 없이 성공, memo 는 카카오 "나에게 보내기" 실발송이다.
// 비면 실행 모드(SOL_RUN_MODE)를 본다. mock·fixture(빈 값 포함)는 mock 이고, live 는 카카오 발송을 끈다(disabled).
//   live 에서 env 를 빠뜨렸는데 mock 이 SENT 기록을 남기면 실제로 안 간 알림이 간 것처럼 보이기 때문이다(2026-10-27 점검).
//   꺼짐은 기동을 막지 않는다 — 같은 프로세스의 분석·수집까지 멈추지 않게 경고 한 줄만 남긴다. 카카오 이벤트는 claim·발송 기록 없이
//   알림 회차의 재시도로 남고(KAKAO_CHANNEL_NOT_CONFIGURED) 다섯 번째에 DEAD 가 된다. 인앱 알림은 그대로 나간다.
//   live 에서 mock 을 직접 적은 것은 받는다(시연 녹화 뒤 mock 으로 되돌리는 절차). 대신 "발송은 흉내만 낸다" 경고를 남긴다.
// memo 일 때만 KAKAO_REST_API_KEY·KAKAO_CLIENT_SECRET·KAKAO_TOKEN_ENC_KEY·SITE_URL 이 필요하다. 오류에는 키 이름만 싣고 값은 싣지 않는다.

export type NotifySettings = { intervalMs: number; batchLimit: number };

const INTERVAL_KEY = "NOTIFY_POLL_INTERVAL_MS";
const DEFAULT_INTERVAL_MS = 2_000;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 60_000;
const BATCH_LIMIT = 50;
const DECIMAL_INTEGER = /^[0-9]+$/;
/** stop 이 진행 중 회차를 기다리는 최대 시간. */
const STOP_WAIT_MS = 5_000;
/** 실패 뒤 늦추기의 최대 간격. */
const MAX_BACKOFF_MS = 60_000;

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

const KAKAO_PROVIDER_KEY = "NOTIFY_KAKAO_PROVIDER";
const RUN_MODE_KEY = "SOL_RUN_MODE";
const SITE_URL_KEY = "SITE_URL";
const ENC_KEY_KEY = "KAKAO_TOKEN_ENC_KEY";
/** memo 에 필요한 키. 누락 오류는 이 순서로 이름을 싣는다. */
const MEMO_REQUIRED_KEYS = [
  "KAKAO_REST_API_KEY",
  "KAKAO_CLIENT_SECRET",
  ENC_KEY_KEY,
  SITE_URL_KEY,
] as const;
/** mock 이고 SITE_URL 이 없을 때의 피드 링크 주소(로컬 웹). */
const DEFAULT_SITE_URL = "http://localhost:3000";
/** 카카오 요청 하나(응답 본문 읽기까지)의 시간 제한. */
const KAKAO_TIMEOUT_MS = 5_000;

/** 실제로 보내거나(memo) 흉내 내는(mock) 발송 수단. */
export type ActiveKakaoSettings =
  | { provider: "mock"; siteUrl: string }
  | {
      provider: "memo";
      restApiKey: string;
      clientSecret: string;
      encKey: string;
      siteUrl: string;
      timeoutMs: typeof KAKAO_TIMEOUT_MS;
    };

/** disabled 는 env 값이 아니다. live 인데 NOTIFY_KAKAO_PROVIDER 가 빈 경우에만 readKakaoSettings 가 고른다. */
export type KakaoSettings = ActiveKakaoSettings | { provider: "disabled" };

type Env = Record<string, string | undefined>;

const envError = (key: string): Error => new Error(`worker env 오류: ${key}`);
const envValue = (env: Env, key: string): string => env[key]?.trim() ?? "";
// 실행 모드 값의 검증(mock·fixture·live 밖이면 기동 거부)은 분석 등록(readRunMode)이 한다. 여기서는 live 인지만 본다.
const isLiveRun = (env: Env): boolean => envValue(env, RUN_MODE_KEY) === "live";

/** 피드의 링크가 될 주소라 http·https 만 받는다. 틀리면 키 이름만 담아 던진다. */
function checkSiteUrl(siteUrl: string): string {
  let protocol = "";
  try {
    protocol = new URL(siteUrl).protocol;
  } catch {
    // 아래에서 키 이름만 담아 던진다(값은 싣지 않는다).
  }
  if (protocol !== "http:" && protocol !== "https:") throw envError(SITE_URL_KEY);
  return siteUrl;
}

/** 토큰 암호화 키 형식은 kakao-token.crypto 한 곳이 정한다(정규 base64·32바이트·전부 0 아님). 오류에는 키 이름만 싣는다. */
function checkEncKey(encKey: string): string {
  try {
    assertKakaoTokenKey(encKey);
  } catch {
    throw envError(ENC_KEY_KEY);
  }
  return encKey;
}

/**
 * NOTIFY_KAKAO_PROVIDER 가 비면 SOL_RUN_MODE=live 일 때 disabled(던지지 않는다), 그 밖의 실행 모드는 mock 이다.
 * mock 은 SITE_URL 이 비면 http://localhost:3000 이다. mock·memo 밖의 값이면 던진다.
 * memo 는 네 키가 모두 있어야 하고, KAKAO_TOKEN_ENC_KEY 는 정규 base64(패딩 포함) 32바이트이고 전부 0 이 아니어야 한다.
 * 값은 앞뒤 공백을 뗀다.
 */
export function readKakaoSettings(env: Env): KakaoSettings {
  const value = (key: string): string => envValue(env, key);
  const provider = value(KAKAO_PROVIDER_KEY);
  if (provider === "" && isLiveRun(env)) return { provider: "disabled" };
  if (provider === "" || provider === "mock") {
    return { provider: "mock", siteUrl: checkSiteUrl(value(SITE_URL_KEY) || DEFAULT_SITE_URL) };
  }
  if (provider !== "memo") throw envError(KAKAO_PROVIDER_KEY);
  const missing = MEMO_REQUIRED_KEYS.filter((key) => value(key) === "");
  if (missing.length > 0) throw new Error(`worker env 누락: ${missing.join(", ")}`);
  const encKey = checkEncKey(value(ENC_KEY_KEY));
  return {
    provider: "memo",
    restApiKey: value("KAKAO_REST_API_KEY"),
    clientSecret: value("KAKAO_CLIENT_SECRET"),
    encKey,
    siteUrl: checkSiteUrl(value(SITE_URL_KEY)),
    timeoutMs: KAKAO_TIMEOUT_MS,
  };
}

/**
 * live 에서 카카오가 실제로 나가지 않는 설정이면 기동 때 한 번 남길 경고(JSON 한 줄), 아니면 null.
 * 키 이름만 싣고 env 값은 싣지 않는다. memo 와 live 밖의 mock 은 경고하지 않는다.
 */
export function kakaoStartupWarning(settings: KakaoSettings, env: Env): string | null {
  if (settings.provider === "disabled") {
    return JSON.stringify({
      event: "notify.kakao.disabled",
      message: `${RUN_MODE_KEY}=live 인데 ${KAKAO_PROVIDER_KEY} 가 비어 카카오 발송을 껐다. 실발송은 memo, 흉내는 mock 으로 적는다`,
    });
  }
  if (settings.provider === "mock" && isLiveRun(env)) {
    return JSON.stringify({
      event: "notify.kakao.mock_in_live",
      message: `${RUN_MODE_KEY}=live 인데 ${KAKAO_PROVIDER_KEY}=mock 이라 카카오 발송은 흉내만 낸다(실제로 보내지 않고 SENT 로 적는다)`,
    });
  }
  return null;
}

export type KakaoSenderDeps = {
  links: KakaoLinkStore;
  /** memo 만 쓴다. mock 은 부르지 않는다. */
  fetch: typeof fetch;
  now: () => Date;
  /** memo 가 같은 사용자 1초 1통을 지킬 때 쓴다. */
  sleep: (ms: number) => Promise<void>;
};

/** 설정의 발송 수단을 만든다. mock 은 외부 호출이 없고, memo 는 카카오 REST API 를 deps.fetch 로 부른다. */
export function createKakaoSender(
  settings: ActiveKakaoSettings,
  deps: KakaoSenderDeps,
): KakaoSender {
  if (settings.provider === "mock") {
    return createMockKakaoSender({ links: deps.links, now: deps.now });
  }
  return createMemoKakaoSender({
    api: createKakaoApi({
      fetch: deps.fetch,
      restApiKey: settings.restApiKey,
      clientSecret: settings.clientSecret,
      timeoutMs: settings.timeoutMs,
      now: deps.now,
    }),
    links: deps.links,
    encKey: settings.encKey,
    now: deps.now,
    sleep: deps.sleep,
  });
}

/**
 * 알림 회차에 넘길 카카오 채널. disabled 면 undefined 다 — 회차가 카카오 이벤트를 저장소·발송 수단에 넘기지 않고
 * 재시도로 돌린다(processOutboxBatch 의 KAKAO_CHANNEL_NOT_CONFIGURED). 그래서 claim·KAKAO 알림 행이 생기지 않는다.
 */
export function createKakaoChannel(
  settings: KakaoSettings,
  deps: KakaoSenderDeps & { store: KakaoOutboxStore },
): KakaoChannelDeps | undefined {
  if (settings.provider === "disabled") return undefined;
  return {
    store: deps.store,
    sender: createKakaoSender(settings, deps),
    siteUrl: settings.siteUrl,
  };
}

export type NotifierDeps = {
  store: NotificationOutboxStore;
  /** 카카오 두 종(BID_RECOMMENDED·KAKAO_TEST)의 저장·발송 수단·피드 링크 주소. undefined 면 카카오 발송 꺼짐(createKakaoChannel). */
  kakao: KakaoChannelDeps | undefined;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
  settings: NotifySettings;
};

type NotifierTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/** 연속 failures 번 실패한 뒤 다음 회차까지의 간격. intervalMs × 2^failures 이고 MAX_BACKOFF_MS 를 넘지 않는다. */
const backoffDelayMs = (intervalMs: number, failures: number): number =>
  Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);

/**
 * 기동 때 한 번, 그 뒤 intervalMs 마다 돈다. 앞 회차가 안 끝났으면 이번 회차는 건너뛴다(겹치지 않는다).
 * 회차 오류는 삼키고 로그 한 줄만 남긴다(worker 를 죽이지 않는다). 실패 뒤에는 늦춘 시각 전의 틱을 건너뛴다(기준 시각은 deps.now()).
 * stop 은 타이머를 멈추고 진행 중 회차를 최대 STOP_WAIT_MS 기다린다. 넘으면 stop_timeout 한 줄을 남기고 돌아온다.
 */
export function startNotifier(
  deps: NotifierDeps,
  timers: NotifierTimers = { setInterval, clearInterval, setTimeout, clearTimeout },
): { stop(): Promise<void> } {
  // 진행 중인 회차. 끝나면 null 로 되돌린다. 이 closure 밖에서는 보이지 않는다.
  let running: Promise<void> | null = null;
  let isStopped = false;
  // 연속 실패 수와, 다음 회차를 돌 수 있는 가장 이른 시각(epoch ms). 성공한 회차(빈 회차 포함)가 둘 다 0 으로 되돌린다.
  let consecutiveFailures = 0;
  let notBeforeMs = 0;

  const round = () => {
    if (isStopped || running !== null) return;
    if (deps.now().getTime() < notBeforeMs) return;
    running = processOutboxBatch({
      store: deps.store,
      kakao: deps.kakao,
      now: deps.now,
      log: deps.log,
      limit: deps.settings.batchLimit,
      shouldStop: () => isStopped,
    }).then(
      () => {
        consecutiveFailures = 0;
        notBeforeMs = 0;
      },
      (error: unknown) => {
        consecutiveFailures += 1;
        const nextDelayMs = backoffDelayMs(deps.settings.intervalMs, consecutiveFailures);
        notBeforeMs = deps.now().getTime() + nextDelayMs;
        deps.log(
          JSON.stringify({
            event: "notify.outbox.failed",
            errorName: errorNameOf(error),
            consecutiveFailures,
            nextDelayMs,
          }),
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
      // 회차가 먼저 끝나면 대기 타이머를 지운다(프로세스를 붙잡지 않게). 시간이 다 되면 회차는 두고 돌아온다.
      const isSettled = await new Promise<boolean>((resolve) => {
        const waitHandle = timers.setTimeout(() => resolve(false), STOP_WAIT_MS);
        const settle = () => {
          timers.clearTimeout(waitHandle);
          resolve(true);
        };
        void current.then(settle, settle);
      });
      if (!isSettled) deps.log(JSON.stringify({ event: "notify.outbox.stop_timeout" }));
    },
  };
}
