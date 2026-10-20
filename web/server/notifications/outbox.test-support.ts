// 시험 전용 도우미(C7 인앱 알림 producer). 제품 코드가 import 하지 않는다.
// 1. 시험 id·outbox 이벤트 견본. id 는 zod uuid 가 받는 RFC 모양(v4)이다.
// 2. 메모리 저장(NotificationOutboxStore 흉내). notifications.idempotency_key UNIQUE(같은 키는 조용히 무시)와
//    outbox_events 상태 갱신의 compare-and-set(id·status·attempts 가 같을 때만 바꾼다)을 흉내 낸다.
// 3. 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어 PostgREST 요청(표·방법·필터·Prefer·본문)을 기록하고 정해 둔 답을 준다.
//    필터 흉내(filteredReply)는 요청의 필터·정렬·limit·select 를 메모리 행에 적용한다. 모르는 연산자는 400 으로 답해
//    흉내가 조용히 틀린 행을 고르지 않게 한다. 실제 네트워크는 부르지 않는다.
// 근거: docs/13-NOTIFICATIONS.md(두 단계 멱등·상태 전이·수신자 확인), docs/04-DATABASE.md §3.6.
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { NotificationOutboxStore, OutboxEventRow } from "@/server/notifications";

// ── 1. id·견본 ──

export const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
export const OTHER_ORG_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const BID_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
export const OTHER_BID_ID = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968";
export const REVIEW_ID = "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
export const ASSIGNEE_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
export const REVIEWER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const RUN_ID = "1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f";
export const REQUESTER_ID = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";
export const EVENT_ID = "7d6c5b4a-3928-4170-8e5d-4c3b2a190807";
export const OTHER_EVENT_ID = "4c3b2a19-0807-46f5-a4e3-d2c1b0a99887";

/** 공고명(알림 title). 로그로 새면 안 되는 값으로 본다. */
export const BID_TITLE = "대전광역시 스마트시티 통합플랫폼 유지보수 (가상)";

export const NOW_ISO = "2026-10-20T09:00:00.000Z";
export const NOW = new Date(NOW_ISO);

/** now 에서 ms 만큼 지난 ISO 시각. */
export const isoAfter = (now: Date, ms: number): string =>
  new Date(now.getTime() + ms).toISOString();

/** REVIEW_ASSIGNED outbox(20261019000007 log_bid_review_audit 가 쓰는 payload 모양). */
export function reviewAssignedEvent(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: EVENT_ID,
    org_id: ORG_ID,
    event_type: "REVIEW_ASSIGNED",
    payload: {
      reviewId: REVIEW_ID,
      bidId: BID_ID,
      orgId: ORG_ID,
      assigneeUserId: ASSIGNEE_ID,
      reviewerId: REVIEWER_ID,
      decision: "BID",
    },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  };
}

/** ANALYSIS_COMPLETE outbox(20261019000016 finish_score_run 이 쓰는 payload 모양). */
export function analysisCompleteEvent(
  status: "COMPLETED" | "PARTIAL" = "COMPLETED",
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: EVENT_ID,
    org_id: ORG_ID,
    event_type: "ANALYSIS_COMPLETE",
    payload: {
      scoreRunId: RUN_ID,
      bidId: BID_ID,
      orgId: ORG_ID,
      requestedBy: REQUESTER_ID,
      status,
    },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  };
}

/** 객체 payload 의 키 하나를 바꾸거나(값) 지운다(undefined). */
export function withPayload(
  event: OutboxEventRow,
  patch: Record<string, Json | undefined>,
): OutboxEventRow {
  const base =
    typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
      ? event.payload
      : {};
  const merged: Record<string, Json | undefined> = { ...base, ...patch };
  const payload: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) payload[key] = value;
  }
  return { ...event, payload };
}

/** reject 한 Error. resolve 하거나 Error 가 아닌 값을 던지면 시험을 실패시킨다. */
export async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

/** 로그 줄을 JSON 으로 읽는다. JSON 이 아니면 시험이 여기서 실패한다. */
export const records = (lines: readonly string[]): Record<string, unknown>[] =>
  lines.map((line): Record<string, unknown> => JSON.parse(line));

// ── 2. 메모리 저장 ──

/** outbox_events 한 행(메모리). findDue 는 이 가운데 OutboxEventRow 열만 돌려준다. */
export type MemoryOutboxRow = {
  id: string;
  org_id: string | null;
  event_type: string;
  payload: Json;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  processed_at: string | null;
  created_at: string;
};

/** 이벤트 견본을 메모리 행으로. created_at 은 순서를 정할 때 덮어쓴다. */
export function memoryRow(
  event: OutboxEventRow,
  extra: Partial<Omit<MemoryOutboxRow, keyof OutboxEventRow>> = {},
): MemoryOutboxRow {
  return {
    ...event,
    next_attempt_at: null,
    processed_at: null,
    created_at: "2026-10-20T08:00:00.000Z",
    ...extra,
  };
}

type StoreMethod = keyof NotificationOutboxStore;
type NotificationRow = Parameters<NotificationOutboxStore["insertNotification"]>[0];
type RetryUpdate = Parameters<NotificationOutboxStore["markRetry"]>[1];

/** 저장 호출 하나. key 는 무엇에 대한 호출인지(이벤트 id·bidId·"org:user"·알림 키). */
export type StoreCall = { method: StoreMethod; key: string };

/** 알림 단계가 고르는 이벤트 종류(docs/13). 메모리 저장은 DB 처럼 이 둘만 고른다. */
const DUE_EVENT_TYPES: readonly string[] = ["REVIEW_ASSIGNED", "ANALYSIS_COMPLETE"];

const toEventRow = (row: MemoryOutboxRow): OutboxEventRow => {
  if (row.status !== "PENDING" && row.status !== "FAILED") {
    throw new Error(`findDue 가 ${row.status} 행을 골랐다`);
  }
  return {
    id: row.id,
    org_id: row.org_id,
    event_type: row.event_type,
    payload: structuredClone(row.payload),
    status: row.status,
    attempts: row.attempts,
  };
};

const isDue = (row: MemoryOutboxRow, now: string): boolean =>
  DUE_EVENT_TYPES.includes(row.event_type) &&
  (row.status === "PENDING" ||
    (row.status === "FAILED" &&
      row.next_attempt_at !== null &&
      new Date(row.next_attempt_at).getTime() <= new Date(now).getTime()));

/**
 * 메모리 저장. fail 이 Error 를 돌려주면 그 호출이 그 오류로 실패한다(실패한 쓰기는 아무것도 바꾸지 않는다).
 * isActive 는 inactive 에 없는 사용자면 true 다(docs/09-SECURITY.md "정지" — 정지 계정에게는 알리지 않는다).
 * notifications 는 idempotency_key 가 같으면 넣지 않고(on conflict do nothing) 오류도 내지 않는다.
 * markProcessed·markRetry 는 받은 이벤트의 id·status·attempts 가 지금 행과 같을 때만 바꾼다(아니면 0행, 오류 아님).
 */
export function createMemoryStore(
  options: {
    events?: readonly MemoryOutboxRow[];
    /** bidId → 공고명 */
    bids?: Readonly<Record<string, string>>;
    /** [orgId, userId] 멤버십 */
    members?: readonly (readonly [string, string])[];
    /** 정지(profiles.status = 'suspended') 계정의 userId. 없으면 모두 활동 계정이다(기존 시험은 그대로 SEND). */
    inactive?: readonly string[];
    fail?: (call: StoreCall) => Error | undefined;
  } = {},
) {
  const events: MemoryOutboxRow[] = (options.events ?? []).map((row) => structuredClone(row));
  const notifications: Record<string, unknown>[] = [];
  const calls: StoreCall[] = [];
  const findDueInputs: { now: string; limit: number }[] = [];
  const bids = options.bids ?? { [BID_ID]: BID_TITLE };
  const members = options.members ?? [
    [ORG_ID, ASSIGNEE_ID],
    [ORG_ID, REQUESTER_ID],
  ];
  const inactive = options.inactive ?? [];

  const record = (method: StoreMethod, key: string): void => {
    const call = { method, key };
    calls.push(call);
    const error = options.fail?.(call);
    if (error) throw error;
  };

  const compareAndSet = (event: OutboxEventRow, patch: Record<string, unknown>): void => {
    const row = events.find(
      (candidate) =>
        candidate.id === event.id &&
        candidate.status === event.status &&
        candidate.attempts === event.attempts,
    );
    if (row) Object.assign(row, patch);
  };

  const store: NotificationOutboxStore = {
    async findDue(input) {
      findDueInputs.push({ ...input });
      record("findDue", input.now);
      return events
        .filter((row) => isDue(row, input.now))
        .toSorted(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .slice(0, input.limit)
        .map(toEventRow);
    },
    async readBidTitle(bidId) {
      record("readBidTitle", bidId);
      return bids[bidId] ?? null;
    },
    async isMember(orgId, userId) {
      record("isMember", `${orgId}:${userId}`);
      return members.some(([org, user]) => org === orgId && user === userId);
    },
    async isActive(userId) {
      record("isActive", userId);
      return !inactive.includes(userId);
    },
    async insertNotification(row: NotificationRow) {
      record("insertNotification", row.idempotency_key);
      if (notifications.some((existing) => existing.idempotency_key === row.idempotency_key)) {
        return;
      }
      notifications.push(structuredClone({ ...row }));
    },
    async markProcessed(event, now) {
      record("markProcessed", event.id);
      compareAndSet(event, { status: "PROCESSED", processed_at: now.toISOString() });
    },
    async markRetry(event, update: RetryUpdate) {
      record("markRetry", event.id);
      compareAndSet(event, { ...update });
    },
  };

  return {
    store,
    events,
    notifications,
    calls,
    findDueInputs,
    /** 이벤트 id 의 지금 행. 없으면 시험이 실패한다. */
    eventOf(id: string): MemoryOutboxRow {
      const row = events.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`outbox 행이 없다: ${id}`);
      return row;
    },
    /** 처리한 이벤트를 다시 PENDING 으로 되돌린다(재전송 흉내). */
    resetToPending(id: string): void {
      const row = events.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`outbox 행이 없다: ${id}`);
      Object.assign(row, { status: "PENDING", processed_at: null, next_attempt_at: null });
    },
  };
}

// ── 3. 가짜 PostgREST(실제 supabase-js + 가짜 fetch) ──

export type PostgrestCall = {
  method: string;
  /** /rest/v1/<표> 의 표 이름(rpc 면 "rpc/<함수>") */
  table: string;
  params: URLSearchParams;
  prefer: string;
  accept: string;
  /** JSON 본문. 없으면 null. */
  body: unknown;
};
export type PostgrestReply = { status: number; body?: unknown };
/** undefined 를 돌려주면 기본 답(아래 defaultReply)을 쓴다. */
export type PostgrestRoute = (call: PostgrestCall) => PostgrestReply | undefined;
/** DB 에 묻는 라우트(PGlite 다리)는 비동기다. */
export type AsyncPostgrestRoute = (
  call: PostgrestCall,
) => PostgrestReply | undefined | Promise<PostgrestReply | undefined>;

const SUPABASE_URL = "http://supabase.test";
// 시험용 가짜 값. 실제 키 모양이 아니다.
const FAKE_SERVICE_KEY = "fake-service-role-key-for-tests";

/** eq 필터 값. "eq.<값>" 하나가 아니면 undefined. */
export function eqValue(call: PostgrestCall, column: string): string | undefined {
  const values = call.params.getAll(column).filter((value) => value.startsWith("eq."));
  return values.length === 1 ? values[0].slice("eq.".length) : undefined;
}

/** in 필터 값(정렬). "in.(a,b)" 가 아니면 undefined. */
export function inValues(call: PostgrestCall, column: string): string[] | undefined {
  const value = call.params.getAll(column).find((entry) => entry.startsWith("in.("));
  if (value === undefined) return undefined;
  return value
    .slice("in.(".length, -1)
    .split(",")
    .map((item) => item.replace(/^"|"$/g, ""))
    .toSorted();
}

/** select 열(정렬). */
export function selectedColumns(call: PostgrestCall): string[] {
  return (call.params.get("select") ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .toSorted();
}

/** on_conflict 열(정렬). */
export function conflictColumns(call: PostgrestCall): string[] {
  return (call.params.get("on_conflict") ?? "").split(",").filter(Boolean).toSorted();
}

const rowsOf = (body: unknown): unknown[] => {
  if (Array.isArray(body)) return body;
  return body === null || body === undefined ? [] : [body];
};

/** 본문의 행들(객체 하나면 한 행). */
export function bodyRows(call: PostgrestCall): Record<string, unknown>[] {
  return rowsOf(call.body).flatMap((row) =>
    typeof row === "object" && row !== null && !Array.isArray(row) ? [{ ...row }] : [],
  );
}

/** 라우트가 없을 때의 답. 읽기는 빈 목록, 쓰기는 성공(갱신은 0행). */
function defaultReply(call: PostgrestCall): PostgrestReply {
  const representation = call.prefer.includes("return=representation");
  if (call.method === "GET") {
    return call.accept.includes("vnd.pgrst.object+json")
      ? postgrestError("PGRST116", 406)
      : { status: 200, body: [] };
  }
  if (call.method === "POST") return representation ? { status: 201, body: [] } : { status: 201 };
  if (call.method === "PATCH") return representation ? { status: 200, body: [] } : { status: 204 };
  return { status: 204 };
}

/** PostgREST 오류 답. message·details·hint 에는 값처럼 보이는 글자를 넣는다(오류 메시지로 새면 안 된다). */
export const LEAKY_ERROR_TEXT = "LEAK-공고원문-비밀값";
export function postgrestError(code: string | null, status = 400): PostgrestReply {
  return {
    status,
    body: {
      ...(code === null ? {} : { code }),
      message: `${LEAKY_ERROR_TEXT} message`,
      details: `${LEAKY_ERROR_TEXT} details`,
      hint: `${LEAKY_ERROR_TEXT} hint`,
    },
  };
}

/** 그 표·방법 요청에만 답한다. */
export function on(method: string, table: string, reply: PostgrestReply): PostgrestRoute {
  return (call) => (call.method === method && call.table === table ? reply : undefined);
}

/** 앞 라우트가 답하지 않으면 다음 라우트에 묻는다. */
export function routes(...list: PostgrestRoute[]): PostgrestRoute {
  return (call) =>
    list.reduce<PostgrestReply | undefined>((reply, route) => reply ?? route(call), undefined);
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;

export function fakeSupabase(route: AsyncPostgrestRoute = () => undefined) {
  const calls: PostgrestCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const call: PostgrestCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      table: url.pathname.replace(/^\/rest\/v1\//, ""),
      params: url.searchParams,
      prefer: headers.get("prefer") ?? "",
      accept: headers.get("accept") ?? "",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const reply = (await route(call)) ?? defaultReply(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>(SUPABASE_URL, FAKE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return {
    client,
    calls,
    /** 그 표(와 방법)로 간 요청. */
    callsTo: (table: string, method?: string) =>
      calls.filter(
        (call) => call.table === table && (method === undefined || call.method === method),
      ),
    /** 요청 순서를 "방법 표" 로. */
    sequence: () => calls.map((call) => `${call.method} ${call.table}`),
  };
}

// ── 3-1. PostgREST 필터 흉내(메모리 행 고르기) ──
// 지원: <열>=[not.]<op>.<값>(eq·neq·lt·lte·gt·gte·in·is), or·and 와 그 안의 and(…)·or(…).
// 같은 이름의 필터가 여럿이면 모두 맞아야 한다(AND). 시각 열(…_at)은 시각으로, 둘 다 수면 수로, 나머지는 글자로 비교한다.
// null 칸은 is 말고는 어떤 비교에도 맞지 않는다(SQL 의 null). 모르는 연산자·없는 열·틀린 모양이면 400(FAKE_UNSUPPORTED_FILTER).

export type FakeRow = Record<string, unknown>;

const NON_FILTER_PARAMS: readonly string[] = [
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "columns",
];

class UnsupportedFilter extends Error {}

/** 괄호·큰따옴표 밖의 쉼표로 나눈다. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")") depth -= 1;
    else if (!quoted && depth === 0 && char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted || depth !== 0) throw new UnsupportedFilter(`괄호·따옴표가 맞지 않는다: ${text}`);
  parts.push(current);
  return parts;
}

const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

/** 칸과 값의 순서(-1·0·1). 시각 열은 시각으로, 칸이 수면 수로 비교한다. 값이 시각이 아니면 거절한다. */
function compareCell(column: string, cell: unknown, value: string): number {
  if (column.endsWith("_at")) {
    const left = new Date(String(cell)).getTime();
    const right = new Date(value).getTime();
    if (Number.isNaN(left) || Number.isNaN(right)) {
      throw new UnsupportedFilter(`시각이 아니다: ${column}`);
    }
    return Math.sign(left - right);
  }
  if (typeof cell === "number") {
    const right = Number(value);
    if (Number.isNaN(right)) throw new UnsupportedFilter(`수가 아니다: ${column}`);
    return Math.sign(cell - right);
  }
  const text = String(cell);
  if (text === value) return 0;
  return text < value ? -1 : 1;
}

function matchesOperator(column: string, cell: unknown, operator: string): boolean {
  const negated = operator.startsWith("not.");
  const body = negated ? operator.slice("not.".length) : operator;
  const dot = body.indexOf(".");
  if (dot === -1) throw new UnsupportedFilter(`연산자가 없다: ${column}=${operator}`);
  const op = body.slice(0, dot);
  const raw = body.slice(dot + 1);
  if (op === "is") {
    if (raw !== "null") throw new UnsupportedFilter(`is 값: ${raw}`);
    const isNull = cell === null || cell === undefined;
    return negated ? !isNull : isNull;
  }
  if (cell === null || cell === undefined) return false;
  const isMatch = (() => {
    if (op === "in") {
      if (!raw.startsWith("(") || !raw.endsWith(")")) throw new UnsupportedFilter(`in 값: ${raw}`);
      return splitTopLevel(raw.slice(1, -1))
        .map(unquote)
        .some((value) => compareCell(column, cell, value) === 0);
    }
    const order = compareCell(column, cell, unquote(raw));
    if (op === "eq") return order === 0;
    if (op === "neq") return order !== 0;
    if (op === "lt") return order < 0;
    if (op === "lte") return order <= 0;
    if (op === "gt") return order > 0;
    if (op === "gte") return order >= 0;
    throw new UnsupportedFilter(`모르는 연산자: ${op}`);
  })();
  return negated ? !isMatch : isMatch;
}

function matchesColumn(row: FakeRow, column: string, operator: string): boolean {
  if (!Object.hasOwn(row, column)) throw new UnsupportedFilter(`없는 열: ${column}`);
  return matchesOperator(column, row[column], operator);
}

function matchesLogic(row: FakeRow, kind: string, inner: string): boolean {
  const conditions = splitTopLevel(inner);
  return kind === "and"
    ? conditions.every((condition) => matchesCondition(row, condition))
    : conditions.some((condition) => matchesCondition(row, condition));
}

/** 논리 트리 안의 조건 하나: and(…)·or(…) 또는 <열>.<op>.<값>. */
function matchesCondition(row: FakeRow, condition: string): boolean {
  const logic = /^(and|or)\(([\s\S]*)\)$/.exec(condition);
  if (logic !== null) return matchesLogic(row, logic[1], logic[2]);
  const dot = condition.indexOf(".");
  if (dot === -1) throw new UnsupportedFilter(`조건 모양: ${condition}`);
  return matchesColumn(row, condition.slice(0, dot), condition.slice(dot + 1));
}

/** 요청의 필터를 행 하나에 적용한다. 모르는 모양이면 UnsupportedFilter 를 던진다. */
function matchesParams(row: FakeRow, params: URLSearchParams): boolean {
  return [...params.entries()].every(([key, value]) => {
    if (NON_FILTER_PARAMS.includes(key)) return true;
    if (key === "and" || key === "or") {
      if (!value.startsWith("(") || !value.endsWith(")")) {
        throw new UnsupportedFilter(`${key} 값: ${value}`);
      }
      return matchesLogic(row, key, value.slice(1, -1));
    }
    return matchesColumn(row, key, value);
  });
}

/** order=<열>.<asc|desc>[.nullsfirst|.nullslast],… 순서로 정렬한다. */
function orderRows(rows: FakeRow[], order: string | null): FakeRow[] {
  if (order === null || order === "") return rows;
  const keys = order.split(",").map((part) => {
    const [column, direction = "asc"] = part.split(".");
    if (direction !== "asc" && direction !== "desc") {
      throw new UnsupportedFilter(`order 방향: ${part}`);
    }
    return { column, sign: direction === "asc" ? 1 : -1 };
  });
  const compare = (a: FakeRow, b: FakeRow): number => {
    for (const { column, sign } of keys) {
      const left = a[column];
      const right = b[column];
      if (left === right) continue;
      // Postgres 기본: asc 는 null 이 뒤, desc 는 null 이 앞이다.
      if (left === null || left === undefined) return sign;
      if (right === null || right === undefined) return -sign;
      const order = compareCell(column, left, String(right));
      if (order !== 0) return order * sign;
    }
    return 0;
  };
  return rows.toSorted(compare);
}

function projectRow(row: FakeRow, select: string | null): FakeRow {
  if (select === null || select === "*") return { ...row };
  return Object.fromEntries(
    select.split(",").map((raw) => {
      const column = raw.trim();
      if (!Object.hasOwn(row, column)) throw new UnsupportedFilter(`없는 select 열: ${column}`);
      return [column, row[column]];
    }),
  );
}

function unsupportedReply(error: unknown): PostgrestReply {
  if (!(error instanceof UnsupportedFilter)) throw error;
  return { status: 400, body: { code: "FAKE_UNSUPPORTED_FILTER", message: error.message } };
}

/** 고른 행을 select 열로 줄여 답한다. 한 행 요청(object+json)이면 객체(1행이 아니면 PGRST116), 아니면 배열. */
export function projectedReply(
  call: PostgrestCall,
  rows: readonly FakeRow[],
  status = 200,
): PostgrestReply {
  try {
    const projected = rows.map((row) => projectRow(row, call.params.get("select")));
    if (!call.accept.includes("vnd.pgrst.object+json")) return { status, body: projected };
    return projected.length === 1
      ? { status, body: projected[0] }
      : postgrestError("PGRST116", 406);
  } catch (error) {
    return unsupportedReply(error);
  }
}

/** 요청의 필터에 맞는 행. 모르는 모양이면 UnsupportedFilter 를 던진다. */
function matchingRows(call: PostgrestCall, rows: readonly FakeRow[]): FakeRow[] {
  return rows.filter((row) => matchesParams(row, call.params));
}

/** PATCH 처럼 필터에 맞는 행을 고른다. 모르는 모양이면 400 답을 돌려준다. */
export function matchOrReply(
  call: PostgrestCall,
  rows: readonly FakeRow[],
): { rows: FakeRow[] } | { reply: PostgrestReply } {
  try {
    return { rows: matchingRows(call, rows) };
  } catch (error) {
    return { reply: unsupportedReply(error) };
  }
}

/** GET 요청의 필터·정렬·offset·limit 를 메모리 행에 적용해 답한다. */
export function filteredReply(call: PostgrestCall, rows: readonly FakeRow[]): PostgrestReply {
  try {
    const ordered = orderRows(matchingRows(call, rows), call.params.get("order"));
    const offset = Number(call.params.get("offset") ?? "0");
    const limit = call.params.get("limit");
    const page = ordered.slice(offset, limit === null ? undefined : offset + Number(limit));
    return projectedReply(call, page);
  } catch (error) {
    return unsupportedReply(error);
  }
}

/**
 * 메모리 표 하나. GET 은 필터를 적용해 고르고, PATCH 는 필터에 맞는 행만 본문으로 바꾼다(0행이면 0행 답).
 * POST 는 unique 열이 같은 행이 있으면, 요청의 on_conflict 가 그 열이고 Prefer 가 resolution=ignore-duplicates 일 때만
 * 아무것도 하지 않고, merge-duplicates 면 덮고, 그 밖에는 23505 로 답한다(DB 의 UNIQUE). 다른 표 요청에는 답하지 않는다.
 */
export function memoryTable(
  table: string,
  initial: readonly FakeRow[] = [],
  options: { unique?: readonly string[] } = {},
) {
  const rows: FakeRow[] = initial.map((row) => structuredClone(row));
  const unique = [...(options.unique ?? [])].toSorted();
  const route: PostgrestRoute = (call) => {
    if (call.table !== table) return undefined;
    if (call.method === "GET") return filteredReply(call, rows);
    if (call.method === "PATCH") {
      const matched = matchOrReply(call, rows);
      if ("reply" in matched) return matched.reply;
      const patch = bodyRows(call)[0] ?? {};
      for (const row of matched.rows) Object.assign(row, patch);
      return call.prefer.includes("return=representation")
        ? projectedReply(call, matched.rows)
        : { status: 204 };
    }
    if (call.method === "POST") {
      const onConflict = conflictColumns(call);
      const sameTarget =
        unique.length > 0 &&
        onConflict.length === unique.length &&
        onConflict.every((column, index) => column === unique[index]);
      const touched: FakeRow[] = [];
      for (const body of bodyRows(call)) {
        const existing =
          unique.length === 0
            ? undefined
            : rows.find((row) => unique.every((key) => row[key] === body[key]));
        if (existing === undefined) {
          const inserted = { ...body };
          rows.push(inserted);
          touched.push(inserted);
        } else if (sameTarget && call.prefer.includes("resolution=ignore-duplicates")) {
          continue;
        } else if (sameTarget && call.prefer.includes("resolution=merge-duplicates")) {
          Object.assign(existing, body);
          touched.push(existing);
        } else {
          return postgrestError("23505", 409);
        }
      }
      return call.prefer.includes("return=representation")
        ? projectedReply(call, touched, 201)
        : { status: 201 };
    }
    return undefined;
  };
  return { rows, route };
}
