import {
  failureOf,
  isRecord,
  JSON_HEADERS,
  NETWORK_ERROR,
  NETWORK_MESSAGE,
  readJson,
  type ApiFailure,
} from "@/app/(app)/(work)/bids/[id]/api-envelope";
import type { RunMode } from "@/server/bids";
import {
  MANUAL_GATE_ENDPOINT,
  RUNS_ENDPOINT,
  type IngestBatch,
  type IngestRun,
} from "./ingestion-copy";

// 수집 관리 화면이 부르는 v1 주소(N8 구현 계획 §1 + 10-26 manual-gate). 오류 봉투 읽기는 공고 상세와 같은 api-envelope 를 쓴다.
// 브라우저 번들이라 서버 모듈을 부르지 않는다. 응답 항목 모양은 같은 서버의 05 IngestionRun 을 믿고 필요한 칸만 확인한다.

export type RunRequestBody = { source: "fixture"; batch: IngestBatch } | { source: "g2b" };

const ACCEPT_JSON = { Accept: "application/json" } as const;

const runUrl = (id: string): string => `${RUNS_ENDPOINT}/${encodeURIComponent(id)}`;

const networkFailure = (): ApiFailure => ({
  status: 0,
  code: NETWORK_ERROR,
  message: NETWORK_MESSAGE,
  details: {},
});

// 화면이 쓰는 칸(id·상태·시각·요약)이 있는지만 본다.
function isRun(value: unknown): value is IngestRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.startedAt === "string" &&
    isRecord(value.summary) &&
    Array.isArray(value.errors)
  );
}

function runsOf(body: unknown): { items: IngestRun[]; nextCursor: string | null } | null {
  if (!isRecord(body) || !Array.isArray(body.items) || !isRecord(body.pageInfo)) return null;
  const { nextCursor } = body.pageInfo;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return body.items.every(isRun) ? { items: body.items, nextCursor } : null;
}

// 05 §5: 429 는 Retry-After 머리글(초)을 준다. 없거나 숫자가 아니면 null.
function retryAfterOf(response: Response, failure: ApiFailure): number | null {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isInteger(header) && header > 0) return header;
  const detail = failure.details.retryAfterSeconds;
  return typeof detail === "number" && Number.isInteger(detail) && detail > 0 ? detail : null;
}

export type RequestOutcome =
  { ok: true; run: IngestRun } | { ok: false; failure: ApiFailure; retryAfterSec: number | null };

/**
 * 수동 수집 요청(POST, 202). key 는 Idempotency-Key 다. 같은 제출을 다시 보낼 때는 같은 키를 넘긴다(쓰는 쪽이 정한다).
 * 네트워크 오류는 상태 0 의 NETWORK_ERROR 로 돌려준다. 던지지 않는다.
 */
export async function requestIngestionRun(
  body: RunRequestBody,
  key: string,
): Promise<RequestOutcome> {
  let response: Response;
  try {
    response = await fetch(RUNS_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: { ...JSON_HEADERS, "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: networkFailure(), retryAfterSec: null };
  }
  const json = await readJson(response);
  if (response.ok && isRun(json)) return { ok: true, run: json };
  const failure = response.ok
    ? { ...failureOf(response, json), status: 500, code: "INTERNAL_ERROR" }
    : failureOf(response, json);
  return { ok: false, failure, retryAfterSec: retryAfterOf(response, failure) };
}

export type FirstPageOutcome =
  { kind: "ok"; items: IngestRun[] } | { kind: "denied"; status: 401 | 403 } | { kind: "failed" };

/** 폴링이 읽는 첫 쪽(커서 없음, 서버가 그린 첫 쪽과 같은 크기). 401·403 은 다시 읽어도 같아 따로 돌려준다. */
export async function readFirstPage(signal: AbortSignal): Promise<FirstPageOutcome> {
  try {
    const response = await fetch(RUNS_ENDPOINT, {
      cache: "no-store",
      headers: ACCEPT_JSON,
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { kind: "denied", status: response.status };
    const page = response.ok ? runsOf(await readJson(response)) : null;
    return page === null ? { kind: "failed" } : { kind: "ok", items: page.items };
  } catch {
    return { kind: "failed" };
  }
}

export type RunOutcome =
  | { kind: "ok"; run: IngestRun }
  | { kind: "not-found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "failed"; requestId?: string };

/** 실행 상세(GET :id). worker 가 행을 만들기 전에는 404 일 수 있다(쓰는 쪽이 접수한 run 인지로 가른다). */
export async function readIngestionRun(id: string, signal: AbortSignal): Promise<RunOutcome> {
  let response: Response;
  try {
    response = await fetch(runUrl(id), { cache: "no-store", headers: ACCEPT_JSON, signal });
  } catch {
    return { kind: "failed" };
  }
  const json = await readJson(response);
  if (response.ok && isRun(json)) return { kind: "ok", run: json };
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 401 || response.status === 403)
    return { kind: "denied", status: response.status };
  const { requestId } = failureOf(response, json);
  return requestId === undefined ? { kind: "failed" } : { kind: "failed", requestId };
}

// ── 수동 불러오기 판정(GET manual-gate, 10-26 운영 전환) ──
// 쿨다운·공유 run·하루 한도·정기 수집 일정은 서버가 정한다. 화면은 서버가 준 시각(ISO)을 보이고 그 시각에 다시 읽을 뿐이다.

export type ManualGate = {
  /** 회사 redis-api 의 수집 모드. 서버가 주지 않았거나 모르는 값이면 null 이다(실수집 단추를 보이지 않는다). */
  ingestMode: RunMode | null;
  cooldownMinutes: number;
  /** 다음 수동 불러오기가 가능한 시각. null 이면 지금 가능하다. */
  nextAvailableAt: string | null;
  /** 최근 접수돼 모두가 함께 기다리는 run. mine 은 그 run 을 접수한 사람이 지금 사용자인지다(서버가 정한다). */
  sharedRun: { runId: string; requestedAt: string; until: string; mine: boolean } | null;
  daily: { used: number; limit: number; resetsAt: string };
  schedule: {
    pattern: string;
    timezone: string;
    slotHoursKst: number[];
    active: boolean;
    nextRunAt: string | null;
  };
};

export type GateOutcome =
  | { kind: "ok"; gate: ManualGate }
  | { kind: "denied"; status: 401 | 403 }
  /** 503: 판정 저장소에 닿지 못했다. */
  | { kind: "unavailable" }
  /** 404: 이 서버에 판정 주소가 없다(이전 배포). */
  | { kind: "absent" }
  | { kind: "failed" };

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const ingestModeOf = (value: unknown): RunMode | null =>
  value === "live" || value === "fixture" || value === "mock" ? value : null;

function sharedRunOf(value: unknown): ManualGate["sharedRun"] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { runId, requestedAt, until, mine } = value;
  return isText(runId) && isText(requestedAt) && isText(until) && typeof mine === "boolean"
    ? { runId, requestedAt, until, mine }
    : undefined;
}

function scheduleOf(value: unknown): ManualGate["schedule"] | undefined {
  if (!isRecord(value)) return undefined;
  const { pattern, timezone, slotHoursKst, active, nextRunAt } = value;
  if (
    typeof pattern !== "string" ||
    typeof timezone !== "string" ||
    !Array.isArray(slotHoursKst) ||
    !slotHoursKst.every(isCount) ||
    typeof active !== "boolean" ||
    !isTextOrNull(nextRunAt)
  )
    return undefined;
  return { pattern, timezone, slotHoursKst, active, nextRunAt };
}

/** 응답 본문을 판정으로 읽는다. 화면이 쓰는 칸 중 하나라도 모양이 다르면 null 이다. */
export function gateOf(body: unknown): ManualGate | null {
  if (!isRecord(body) || !isRecord(body.daily)) return null;
  const sharedRun = sharedRunOf(body.sharedRun);
  const schedule = scheduleOf(body.schedule);
  const { used, limit, resetsAt } = body.daily;
  if (
    sharedRun === undefined ||
    schedule === undefined ||
    !isCount(body.cooldownMinutes) ||
    !isTextOrNull(body.nextAvailableAt) ||
    !isCount(used) ||
    !isCount(limit) ||
    !isText(resetsAt)
  )
    return null;
  return {
    ingestMode: ingestModeOf(body.ingestMode),
    cooldownMinutes: body.cooldownMinutes,
    nextAvailableAt: body.nextAvailableAt,
    sharedRun,
    daily: { used, limit, resetsAt },
    schedule,
  };
}

export async function readManualGate(signal: AbortSignal): Promise<GateOutcome> {
  try {
    const response = await fetch(MANUAL_GATE_ENDPOINT, {
      cache: "no-store",
      headers: ACCEPT_JSON,
      signal,
    });
    if (response.status === 401 || response.status === 403)
      return { kind: "denied", status: response.status };
    if (response.status === 503) return { kind: "unavailable" };
    if (response.status === 404) return { kind: "absent" };
    const gate = response.ok ? gateOf(await readJson(response)) : null;
    return gate === null ? { kind: "failed" } : { kind: "ok", gate };
  } catch {
    return { kind: "failed" };
  }
}
