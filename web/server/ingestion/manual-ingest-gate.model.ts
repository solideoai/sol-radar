import "server-only";
import type { IngestionRunMode } from "./ingestion-admin.model";
import type { SourceReadinessSnapshot } from "./source-readiness.model";
import {
  INGEST_SCHEDULE_PATTERN,
  INGEST_SCHEDULE_SLOT_HOURS_KST,
  INGEST_SCHEDULE_TIMEZONE,
} from "./ingest-schedule";
import { KST_OFFSET_MINUTES } from "./normalize-date";

// ── 수동 수집 gate(10-26 운영 전환): 공공 API 를 부르는 수동 요청의 사용자 쿨다운·전역 공유 실행·하루 상한 ──
// 저장(원자적 검사+설정)은 포트 ManualIngestGate 가 맡는다. Redis 구현은 web/app/_lib/manual-ingest-gate.ts(Lua 한 번),
// 메모리 구현은 manual-ingest-gate.memory.ts(시험용)다. 여기에는 규칙 값과 시각 계산만 둔다.

/** 같은 사용자는 수동 수집을 정상 접수한 뒤 이만큼 다시 접수하지 않는다 */
export const MANUAL_INGEST_COOLDOWN_MINUTES = 60;
/** 누가 접수했든 그 뒤 이만큼은 새 job 을 넣지 않고 그 run 을 알려 준다. 같은 창을 두 번 부르지 않게 한다 */
export const MANUAL_INGEST_SHARED_MINUTES = 10;
/**
 * 한국시간 날짜당 수동 접수 상한(전역). 호출 예산 근거: 정기 수집은 하루 8회 × 목록 1~3회 + 신규 공고당 보조 3회로
 * 하루 300회 안팎을 쓴다(나라장터 일 한도 1000, worker 가 수동 job 은 800까지만 쓴다). 수동 수집은 다음 정기 창의
 * 앞부분을 먼저 받을 뿐이라 회당 추가 비용이 목록 1~2회다. 20회면 많아야 40회 남짓이고 정기용 몫을 침범하지 않는다.
 */
export const MANUAL_INGEST_DAILY_LIMIT = 20;
/** worker 가 거는 정기 수집 BullMQ Job Scheduler 의 id. 웹은 이 id 로 등록 여부·다음 실행을 읽는다 */
export const INGEST_SCHEDULER_ID = "g2b-scheduled";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KST_OFFSET_MS = KST_OFFSET_MINUTES * MINUTE_MS;
export const MANUAL_INGEST_COOLDOWN_MS = MANUAL_INGEST_COOLDOWN_MINUTES * MINUTE_MS;
export const MANUAL_INGEST_SHARED_MS = MANUAL_INGEST_SHARED_MINUTES * MINUTE_MS;

/**
 * gate 에 남는 접수 한 건. requestedAt 은 서버 시각(deps.now) ISO, userId 는 접수한 사용자다.
 * userId 는 저장소 안에서 "내 접수인가"(mine)를 가리는 데만 쓴다. 응답·로그에는 싣지 않는다.
 */
export type ManualIngestEntry = { runId: string; requestedAt: string; userId: string };

/** 접수에 성공했을 때 되돌리기(release)에 쓰는 표. 접수한 날짜 키를 들고 있어 자정을 넘겨도 그날 카운터를 되돌린다 */
export type ManualIngestTicket = { userId: string; dayKey: string; entry: ManualIngestEntry };

export type ManualIngestClaim =
  | { status: "CLAIMED"; ticket: ManualIngestTicket }
  | { status: "USER_COOLDOWN"; entry: ManualIngestEntry }
  | { status: "SHARED_RUN"; entry: ManualIngestEntry }
  | { status: "DAILY_LIMIT"; used: number };

/** 읽기(GET manual-gate). 만료된 항목은 null 이다 */
export type ManualIngestGateState = {
  user: ManualIngestEntry | null;
  shared: ManualIngestEntry | null;
  dailyUsed: number;
};

/**
 * 수동 수집 gate 포트. claim 은 사용자 쿨다운 → 전역 공유 실행 → 하루 상한을 한 번에(원자적으로) 보고, 모두 비면
 * 세 값을 함께 남긴다. 동시 요청이 몇 개든 하나만 CLAIMED 다. release 는 자기가 남긴 값일 때만 지우고 하루 카운터를 되돌린다.
 * 저장소 오류는 던진다(서비스가 503 {component:"redis"} 로 끝내고 접수하지 않는다).
 */
export type ManualIngestGate = {
  claim(input: { userId: string; runId: string; at: Date }): Promise<ManualIngestClaim>;
  release(ticket: ManualIngestTicket): Promise<void>;
  read(input: { userId: string; at: Date }): Promise<ManualIngestGateState>;
};

/** 정기 수집 Job Scheduler 의 실제 상태. 등록돼 있지 않으면 active false, nextRunAt null 이다 */
export type IngestSchedulerState = { active: boolean; nextRunAt: string | null };
/** 저장소 오류는 던진다 */
export type IngestSchedulerReader = { read(): Promise<IngestSchedulerState> };

/** 한국시간 날짜 YYYYMMDD. 하루 상한 키에 쓴다 */
export function manualIngestDayKey(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10).replaceAll("-", "");
}

/** at 뒤 첫 한국시간 자정(하루 상한이 다시 차는 시각) */
export function nextKstMidnightAfter(at: Date): Date {
  const kstDay = Math.floor((at.getTime() + KST_OFFSET_MS) / DAY_MS);
  return new Date((kstDay + 1) * DAY_MS - KST_OFFSET_MS);
}

const addMs = (iso: string, ms: number): Date => new Date(Date.parse(iso) + ms);

/** 사용자 쿨다운이 끝나는 시각 */
export const cooldownEndsAt = (entry: ManualIngestEntry): Date =>
  addMs(entry.requestedAt, MANUAL_INGEST_COOLDOWN_MS);

/** 공유 실행 창이 끝나는 시각 */
export const sharedRunEndsAt = (entry: ManualIngestEntry): Date =>
  addMs(entry.requestedAt, MANUAL_INGEST_SHARED_MS);

/** 남은 초(올림). 이미 지났어도 Retry-After 로 쓸 수 있게 1 이상이다 */
export const secondsUntil = (target: Date, now: Date): number =>
  Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));

// ── 읽기 모델(GET /admin/ingestion/manual-gate). 화면이 [지금 불러오기]·다음 가능 시각·정기 일정에 쓴다 ──

export type ManualIngestGateView = {
  cooldownMinutes: number;
  /** 이 사용자의 쿨다운이 끝나는 시각. 쿨다운이 없으면 null(공유 실행·하루 상한은 아래 칸이 따로 알린다) */
  nextAvailableAt: string | null;
  /**
   * 최근 10분 안에 접수된 수동 수집(누가 했든). until 이 지나면 새로 접수할 수 있다.
   * mine 은 지금 요청자가 접수했는지다(다른 사용자 id 는 내보내지 않는다).
   */
  sharedRun: { runId: string; requestedAt: string; until: string; mine: boolean } | null;
  daily: { used: number; limit: number; resetsAt: string };
  /** 정기 수집 일정. active·nextRunAt 은 ingest 큐 Job Scheduler 의 실제 등록 상태다 */
  schedule: {
    pattern: string;
    timezone: string;
    slotHoursKst: number[];
    active: boolean;
    nextRunAt: string | null;
  };
  /** redis-api 쪽 수집 실행 모드(SOL_INGEST_MODE, 없으면 SOL_RUN_MODE). live 일 때만 공공 API 수동 수집을 받는다 */
  ingestMode: IngestionRunMode;
  /**
   * ingest Worker 가 남긴 외부 서비스별 상태(키 없음·한도 미정·인증 실패 등). Worker 가 아직 남기지 않았거나
   * 읽지 못했으면 null 이다(외부 서비스 수동 수집 단추를 막는다). 나라장터 입찰공고는 여기 없다(schedule 이 정한다)
   */
  services: SourceReadinessSnapshot["services"] | null;
};

/** 저장소가 돌려준 상태 → 읽기 모델. 저장소 시계와 어긋나 남아 있는 항목도 now 기준으로 지났으면 없는 것으로 본다 */
export function toManualIngestGateView(input: {
  state: ManualIngestGateState;
  scheduler: IngestSchedulerState;
  ingestMode: IngestionRunMode;
  /** 지금 요청자. sharedRun.mine 계산에만 쓴다 */
  requesterId: string;
  now: Date;
  /** Worker 가 남긴 외부 서비스 상태. 없거나 읽지 못했으면 null */
  sources?: SourceReadinessSnapshot | null;
}): ManualIngestGateView {
  const { state, scheduler, ingestMode, requesterId, now } = input;
  const cooldownEnd = state.user === null ? null : cooldownEndsAt(state.user);
  const sharedEnd = state.shared === null ? null : sharedRunEndsAt(state.shared);
  return {
    cooldownMinutes: MANUAL_INGEST_COOLDOWN_MINUTES,
    nextAvailableAt: cooldownEnd !== null && cooldownEnd > now ? cooldownEnd.toISOString() : null,
    sharedRun:
      state.shared !== null && sharedEnd !== null && sharedEnd > now
        ? {
            runId: state.shared.runId,
            requestedAt: state.shared.requestedAt,
            until: sharedEnd.toISOString(),
            mine: state.shared.userId === requesterId,
          }
        : null,
    daily: {
      used: state.dailyUsed,
      limit: MANUAL_INGEST_DAILY_LIMIT,
      resetsAt: nextKstMidnightAfter(now).toISOString(),
    },
    schedule: {
      pattern: INGEST_SCHEDULE_PATTERN,
      timezone: INGEST_SCHEDULE_TIMEZONE,
      slotHoursKst: [...INGEST_SCHEDULE_SLOT_HOURS_KST],
      active: scheduler.active,
      nextRunAt: scheduler.active ? scheduler.nextRunAt : null,
    },
    ingestMode,
    services: input.sources?.services ?? null,
  };
}
