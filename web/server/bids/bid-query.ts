import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  bidStageSchema,
  bidStatusSchema,
  recommendationSchema,
  type BidStage,
  type BidStatus,
  type Recommendation,
  type RunMode,
} from "./bid.model";

// 05 §3 GET /bids 쿼리와 커서. 비밀(API_CURSOR_SECRET)은 인자로 받는다 — env 는 Route Handler 가 읽는다.

export const BID_SORTS = [
  "publishedAt:desc",
  "publishedAt:asc",
  "deadlineAt:asc",
  "deadlineAt:desc",
  "score:desc",
  "budgetKrw:desc",
] as const;
export type BidSort = (typeof BID_SORTS)[number];
export type BidListOrigin = "live" | "demo" | "all";
export type DecisionFilter = Recommendation | "NONE";
// 05 §3: 기본은 진행 중인 공고(OPEN·AMENDED)다. "취소 포함"은 CANCELLED 를 더한다(ADR-029 A7).
export const DEFAULT_BID_STATUS: readonly BidStatus[] = ["OPEN", "AMENDED"];

export type BidListQuery = {
  q: string | null;
  stage: BidStage[];
  status: BidStatus[];
  // ISO8601 offset 문자열. from <= to
  deadlineFrom: string | null;
  deadlineTo: string | null;
  recommendation: Recommendation[];
  decision: DecisionFilter[];
  origin: BidListOrigin;
  sort: BidSort;
  cursor: string | null;
  limit: number;
  watched?: "me";
};

export type QueryIssue = { path: string; message: string };
export type PageQuery = { cursor: string | null; limit: number };
export type RawQuery = Readonly<Record<string, string | string[] | undefined>>;

const decisionSchema = z.union([recommendationSchema, z.literal("NONE")]);
const isoOffset = z.iso.datetime({ offset: true, message: "offset 이 있는 ISO8601 이어야 합니다" });
const limitSchema = z.coerce
  .number()
  .int()
  .min(1, "1 이상이어야 합니다")
  .max(100, "100 이하입니다");
const originSchema = z.enum(["live", "demo", "all"]);
const parsedSchema = z.strictObject({
  q: z.string().min(1, "검색어는 1자 이상입니다").max(100, "검색어는 100자 이하입니다").optional(),
  stage: z.array(bidStageSchema),
  status: z.array(bidStatusSchema),
  deadlineFrom: isoOffset.optional(),
  deadlineTo: isoOffset.optional(),
  recommendation: z.array(recommendationSchema),
  decision: z.array(decisionSchema),
  origin: originSchema.optional(),
  isDemo: z.enum(["true", "false"]).optional(),
  sort: z.enum(BID_SORTS),
  cursor: z.string().min(1).optional(),
  limit: limitSchema,
  watched: z.literal("me").optional(),
});

function repeated(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== "");
}

// 한 번만 받는 값에 반복이 오면 배열째 넘겨 검증이 실패하게 한다.
function scalar(value: string | string[] | undefined): string | string[] | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : value;
  return value === "" ? undefined : value;
}

export const defaultOrigin = (runMode: RunMode): BidListOrigin =>
  runMode === "live" ? "live" : "demo";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: QueryIssue[] };

// 반복 파라미터의 항목 번호는 클라이언트에게 뜻이 없으므로 파라미터 이름까지만 낸다.
const issuesOf = (error: z.ZodError): QueryIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.filter((part) => typeof part === "string").join("."),
    message: issue.message,
  }));

// origin 과 옛 isDemo 를 하나로 합친다. 둘의 뜻이 다르면 isDemo 의 실패다.
function resolveOrigin(
  origin: BidListOrigin | undefined,
  isDemo: "true" | "false" | undefined,
  runMode: RunMode,
): ParseResult<BidListOrigin> {
  if (isDemo === undefined) return { ok: true, value: origin ?? defaultOrigin(runMode) };
  const fromIsDemo: BidListOrigin = isDemo === "true" ? "demo" : "live";
  if (origin !== undefined && origin !== fromIsDemo) {
    return {
      ok: false,
      issues: [{ path: "isDemo", message: "isDemo 와 origin 의 뜻이 다릅니다" }],
    };
  }
  return { ok: true, value: fromIsDemo };
}

export function parseBidListQuery(query: RawQuery, runMode: RunMode): ParseResult<BidListQuery> {
  const result = parsedSchema.safeParse({
    q: scalar(query.q),
    stage: repeated(query.stage),
    status: repeated(query.status),
    deadlineFrom: scalar(query.deadlineFrom),
    deadlineTo: scalar(query.deadlineTo),
    recommendation: repeated(query.recommendation),
    decision: repeated(query.decision),
    origin: scalar(query.origin),
    isDemo: scalar(query.isDemo),
    sort: scalar(query.sort) ?? "publishedAt:desc",
    cursor: scalar(query.cursor),
    limit: scalar(query.limit) ?? "20",
    watched: scalar(query.watched),
  });
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  const parsed = result.data;
  const origin = resolveOrigin(parsed.origin, parsed.isDemo, runMode);
  if (!origin.ok) return origin;
  const { deadlineFrom, deadlineTo } = parsed;
  if (
    deadlineFrom !== undefined &&
    deadlineTo !== undefined &&
    Date.parse(deadlineFrom) > Date.parse(deadlineTo)
  ) {
    return {
      ok: false,
      issues: [
        { path: "deadlineFrom", message: "deadlineFrom 은 deadlineTo 보다 늦을 수 없습니다" },
      ],
    };
  }
  return {
    ok: true,
    value: {
      q: parsed.q ?? null,
      stage: parsed.stage,
      status: parsed.status.length > 0 ? parsed.status : [...DEFAULT_BID_STATUS],
      deadlineFrom: deadlineFrom ?? null,
      deadlineTo: deadlineTo ?? null,
      recommendation: parsed.recommendation,
      decision: parsed.decision,
      origin: origin.value,
      sort: parsed.sort,
      cursor: parsed.cursor ?? null,
      limit: parsed.limit,
      ...(parsed.watched === undefined ? {} : { watched: parsed.watched }),
    },
  };
}

const pageSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: limitSchema,
});

// 커서 페이지 쪽 공통 쿼리(분석 이력).
export function parsePageQuery(query: RawQuery): ParseResult<PageQuery> {
  const result = pageSchema.safeParse({
    cursor: scalar(query.cursor),
    limit: scalar(query.limit) ?? "20",
  });
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, value: { cursor: result.data.cursor ?? null, limit: result.data.limit } };
}

const notificationSchema = pageSchema.extend({ unreadOnly: z.enum(["true", "false"]) });

export function parseNotificationQuery(
  query: RawQuery,
): ParseResult<PageQuery & { unreadOnly: boolean }> {
  const result = notificationSchema.safeParse({
    cursor: scalar(query.cursor),
    limit: scalar(query.limit) ?? "20",
    unreadOnly: scalar(query.unreadOnly) ?? "false",
  });
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return {
    ok: true,
    value: {
      cursor: result.data.cursor ?? null,
      limit: result.data.limit,
      unreadOnly: result.data.unreadOnly === "true",
    },
  };
}

const originOnlySchema = z.strictObject({
  origin: originSchema.optional(),
  isDemo: z.enum(["true", "false"]).optional(),
});

// 대시보드처럼 origin 만 받는 쿼리.
export function parseOriginQuery(
  query: RawQuery,
  runMode: RunMode,
): ParseResult<{ origin: BidListOrigin }> {
  const result = originOnlySchema.safeParse({
    origin: scalar(query.origin),
    isDemo: scalar(query.isDemo),
  });
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  const origin = resolveOrigin(result.data.origin, result.data.isDemo, runMode);
  return origin.ok ? { ok: true, value: { origin: origin.value } } : origin;
}

// ── 커서 ──

// 커서는 발급 뒤 24시간까지만 쓴다. people 커서(05 :478)와 같은 규칙이다(보안 L3).
export const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

export const cursorPayloadSchema = z.strictObject({
  sortValue: z.union([z.string(), z.number()]).nullable(),
  id: z.string().min(1),
  queryFingerprint: z.string().min(1),
  // 발급 시각(epoch ms). 24시간이 지났거나 지금보다 뒤면 거절한다.
  issuedAt: z.number().int().nonnegative(),
});
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

// ingestionRuns 는 수집 관리(N8) 이력이다. 그 커서는 app 층(app/_lib/ingestion-deps.ts)이 조직을 넣어 만든다.
export type CursorKind = "bids" | "analyses" | "notifications" | "ingestionRuns";

// 커서가 묶이는 범위의 지문. 종류가 달라지면 같은 값이어도 지문이 다르다.
// parts 에는 조직(알림은 사람도)을 넣는다. 다른 조직·사람이 받은 커서를 쓰지 못하게 한다(보안 L3).
export function cursorScope(kind: CursorKind, parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify([kind, ...parts]))
    .digest("hex")
    .slice(0, 32);
}

// 조직과, 커서와 페이지 크기를 뺀 필터·정렬의 지문. 이것이 바뀌면 커서를 버린다.
export function fingerprintOf(orgId: string, query: BidListQuery, userId?: string): string {
  return cursorScope("bids", [
    orgId,
    query.q,
    [...query.stage].sort(),
    [...query.status].sort(),
    query.deadlineFrom,
    query.deadlineTo,
    [...query.recommendation].sort(),
    [...query.decision].sort(),
    query.origin,
    query.sort,
    ...(query.watched === undefined ? [] : [`watched:${query.watched}`, userId]),
  ]);
}

// API_CURSOR_SECRET 를 읽는다. 공백을 뗀 뒤 32자 미만이면 쓰지 않는다(null → 서비스가 503).
export function readCursorSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

export function signCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyCursor(
  cursor: string,
  fingerprint: string,
  secret: string,
  now: number,
): { ok: true; payload: CursorPayload } | { ok: false; code: "INVALID_CURSOR" } {
  const invalid = { ok: false, code: "INVALID_CURSOR" } as const;
  const parts = cursor.split(".");
  if (parts.length !== 2) return invalid;
  const [body, signature] = parts;
  if (body === undefined || signature === undefined) return invalid;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return invalid;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return invalid;
  }
  const payload = cursorPayloadSchema.safeParse(json);
  if (!payload.success || payload.data.queryFingerprint !== fingerprint) return invalid;
  const { issuedAt } = payload.data;
  if (issuedAt > now || now - issuedAt >= CURSOR_TTL_MS) return invalid;
  return { ok: true, payload: payload.data };
}
