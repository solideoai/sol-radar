import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  sourceFamilySchema,
  opportunityStageSchema,
  categorySchema,
  recommendationSchema,
} from "./model";

export const OPPORTUNITY_SORTS = [
  "publishedAt:desc",
  "deadlineAt:asc",
  "score:desc",
  "budgetKrw:desc",
] as const;
const schema = z.object({
  q: z.string().trim().max(100).nullable(),
  sourceFamily: z.array(sourceFamilySchema),
  agencyId: z.array(z.uuid()),
  companyId: z.array(z.string().regex(/^COM\d{2}$/)),
  stage: z.array(opportunityStageSchema),
  status: z.array(z.enum(["OPEN", "AMENDED", "CANCELLED", "CLOSED"])),
  recommendation: z.array(recommendationSchema),
  decision: z.array(z.enum(["BID", "WATCH", "NO_BID", "NONE"])),
  category: z.array(categorySchema),
  origin: z.enum(["live", "demo", "all"]),
  siAiFirst: z.enum(["true", "false"]),
  includeEarly: z.enum(["true", "false"]),
  sort: z.enum(OPPORTUNITY_SORTS),
  cursor: z.string().max(4096).nullable(),
  limit: z.coerce.number().int().min(1).max(100),
  asOf: z.iso.datetime({ offset: true }).nullable(),
  watched: z.literal("me").optional(),
});
type Parsed = z.infer<typeof schema>;
export type OpportunityQuery = Omit<Parsed, "siAiFirst" | "includeEarly"> & {
  siAiFirst: boolean;
  includeEarly: boolean;
  sortExplicit: boolean;
};
type Raw = Readonly<Record<string, string | string[] | undefined>>;
const repeated = (v: string | string[] | undefined) =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).filter(Boolean);
const scalar = (v: string | string[] | undefined) =>
  Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v;
// fallbackOrigin 은 origin 이 없을 때 쓰는 화면 기본 출처다(@/server/bids defaultOrigin 이 정한다).
export function parseOpportunityQuery(
  raw: Raw,
  fallbackOrigin: "live" | "demo" | "all",
):
  | { ok: true; value: OpportunityQuery }
  | { ok: false; issues: { path: string; message: string }[] } {
  const r = schema.safeParse({
    q: scalar(raw.q) || null,
    sourceFamily: repeated(raw.sourceFamily),
    agencyId: repeated(raw.agencyId),
    companyId: repeated(raw.companyId),
    stage: repeated(raw.stage),
    status: repeated(raw.status),
    recommendation: repeated(raw.recommendation),
    decision: repeated(raw.decision),
    category: repeated(raw.category),
    origin: scalar(raw.origin) || fallbackOrigin,
    siAiFirst: scalar(raw.siAiFirst) || "true",
    includeEarly: scalar(raw.includeEarly) || "false",
    sort: scalar(raw.sort) || "publishedAt:desc",
    cursor: scalar(raw.cursor) || null,
    limit: scalar(raw.limit) || 20,
    asOf: scalar(raw.asOf) || null,
    watched: scalar(raw.watched),
  });
  if (!r.success)
    return {
      ok: false,
      issues: r.error.issues.map((x) => ({ path: x.path.join("."), message: x.message })),
    };
  if (
    r.data.includeEarly === "false" &&
    r.data.stage.some((s) => ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC"].includes(s))
  )
    return {
      ok: false,
      issues: [
        { path: "includeEarly", message: "예정 사업 단계는 Early Opportunity를 켜야 합니다" },
      ],
    };
  return {
    ok: true,
    value: {
      ...r.data,
      q: r.data.q || null,
      siAiFirst: r.data.siAiFirst === "true",
      includeEarly: r.data.includeEarly === "true",
      sortExplicit: raw.sort !== undefined,
    },
  };
}
export function serializeOpportunityQuery(q: OpportunityQuery): string {
  const p = new URLSearchParams();
  for (const k of ["q", "origin", "cursor", "asOf", "watched"] as const) if (q[k]) p.set(k, q[k]);
  for (const k of [
    "sourceFamily",
    "agencyId",
    "companyId",
    "stage",
    "status",
    "recommendation",
    "decision",
    "category",
  ] as const)
    for (const v of q[k]) p.append(k, v);
  p.set("siAiFirst", String(q.siAiFirst));
  p.set("includeEarly", String(q.includeEarly));
  p.set("limit", String(q.limit));
  if (q.sortExplicit) p.set("sort", q.sort);
  return p.toString();
}
export const fingerprint = (org: string, q: OpportunityQuery, userId?: string) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        org,
        { ...q, cursor: null, limit: 0, asOf: null },
        ...(q.watched ? [userId] : []),
      ]),
    )
    .digest("hex");
const cursorSchema = z.object({
  scope: z.string(),
  version: z.string(),
  asOf: z.string(),
  issuedAt: z.number(),
  rank: z.number(),
  id: z.uuid(),
  value: z.union([z.string(), z.number()]).nullable(),
});
export type OpportunityCursor = z.infer<typeof cursorSchema>;
const mac = (s: string, k: string) => createHmac("sha256", k).update(s).digest("base64url");
export function signOpportunityCursor(c: OpportunityCursor, key: string) {
  const b = Buffer.from(JSON.stringify(c)).toString("base64url");
  return `${b}.${mac(b, key)}`;
}
export function verifyOpportunityCursor(
  value: string,
  scope: string,
  key: string,
  now = Date.now(),
): OpportunityCursor | null {
  if (value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const a = Buffer.from(sig),
    b = Buffer.from(mac(body, key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const r = cursorSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return r.success &&
      r.data.scope === scope &&
      r.data.issuedAt <= now &&
      now - r.data.issuedAt < 86400000
      ? r.data
      : null;
  } catch {
    return null;
  }
}
