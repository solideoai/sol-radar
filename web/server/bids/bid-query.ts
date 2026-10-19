import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  bidStageSchema,
  recommendationSchema,
  type BidStage,
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

export type BidListQuery = {
  q: string | null;
  stage: BidStage[];
  recommendation: Recommendation[];
  decision: DecisionFilter[];
  origin: BidListOrigin;
  sort: BidSort;
  cursor: string | null;
  limit: number;
};

export type QueryIssue = { path: string; message: string };
export type RawQuery = Readonly<Record<string, string | string[] | undefined>>;

const decisionSchema = z.union([recommendationSchema, z.literal("NONE")]);
const parsedSchema = z.strictObject({
  q: z.string().min(1, "검색어는 1자 이상입니다").max(100, "검색어는 100자 이하입니다").optional(),
  stage: z.array(bidStageSchema),
  recommendation: z.array(recommendationSchema),
  decision: z.array(decisionSchema),
  origin: z.enum(["live", "demo", "all"]).optional(),
  isDemo: z.enum(["true", "false"]).optional(),
  sort: z.enum(BID_SORTS),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1, "1 이상이어야 합니다").max(100, "100 이하입니다"),
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

const defaultOrigin = (runMode: RunMode): BidListOrigin => (runMode === "live" ? "live" : "demo");

export function parseBidListQuery(
  query: RawQuery,
  runMode: RunMode,
): { ok: true; value: BidListQuery } | { ok: false; issues: QueryIssue[] } {
  const result = parsedSchema.safeParse({
    q: scalar(query.q),
    stage: repeated(query.stage),
    recommendation: repeated(query.recommendation),
    decision: repeated(query.decision),
    origin: scalar(query.origin),
    isDemo: scalar(query.isDemo),
    sort: scalar(query.sort) ?? "publishedAt:desc",
    cursor: scalar(query.cursor),
    limit: scalar(query.limit) ?? "20",
  });
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const parsed = result.data;
  if (parsed.isDemo !== undefined) {
    const fromIsDemo: BidListOrigin = parsed.isDemo === "true" ? "demo" : "live";
    if (parsed.origin !== undefined && parsed.origin !== fromIsDemo) {
      return {
        ok: false,
        issues: [{ path: "isDemo", message: "isDemo 와 origin 의 뜻이 다릅니다" }],
      };
    }
    parsed.origin = fromIsDemo;
  }
  return {
    ok: true,
    value: {
      q: parsed.q ?? null,
      stage: parsed.stage,
      recommendation: parsed.recommendation,
      decision: parsed.decision,
      origin: parsed.origin ?? defaultOrigin(runMode),
      sort: parsed.sort,
      cursor: parsed.cursor ?? null,
      limit: parsed.limit,
    },
  };
}

// ── 커서 ──

export const cursorPayloadSchema = z.strictObject({
  sortValue: z.union([z.string(), z.number()]).nullable(),
  id: z.string().min(1),
  queryFingerprint: z.string().min(1),
});
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

// 커서와 페이지 크기를 뺀 필터·정렬의 지문. 이것이 바뀌면 커서를 버린다.
export function fingerprintOf(query: BidListQuery): string {
  const key = JSON.stringify([
    query.q,
    [...query.stage].sort(),
    [...query.recommendation].sort(),
    [...query.decision].sort(),
    query.origin,
    query.sort,
  ]);
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

export function signCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyCursor(
  cursor: string,
  query: BidListQuery,
  secret: string,
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
  if (!payload.success || payload.data.queryFingerprint !== fingerprintOf(query)) return invalid;
  return { ok: true, payload: payload.data };
}
