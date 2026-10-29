import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  fingerprint,
  parseOpportunityQuery,
  serializeOpportunityQuery,
  signOpportunityCursor,
  verifyOpportunityCursor,
} from "./query";
import { filtered, listOpportunities, opportunityKeyset } from "./repo";

const parse = (raw: Record<string, string | string[]>) => {
  const r = parseOpportunityQuery(raw, "live");
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
};
const baseCursor = {
  scope: "org-filter",
  version: "v1",
  asOf: "2026-10-21T00:00:00Z",
  issuedAt: 100000000,
};
// 체인 호출을 [메서드, ...인자] 로 남기는 가짜 client. 어느 질의든 빈 쪽으로 끝나고 데이터 버전은 늘 v1 이다.
const recordingClient = () => {
  const calls: unknown[][] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, method) =>
        method === "then"
          ? (resolve: (value: unknown) => unknown) => resolve({ data: [], count: 0, error: null })
          : (...args: unknown[]) => {
              calls.push([method, ...args]);
              return chain;
            },
    },
  );
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
    rpc: async () => ({ data: "v1", error: null }),
  };
  return { calls, client: client as unknown as SupabaseClient<Database> };
};
describe("사업기회 검색 경계", () => {
  it("early 기본 제외·출처 반복·명시 정렬을 복귀 URL에 보존한다", () => {
    const r = parseOpportunityQuery({ sourceFamily: ["LH", "KEPCO"], sort: "score:desc" }, "live");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.includeEarly).toBe(false);
    expect(r.value.sortExplicit).toBe(true);
    const p = new URLSearchParams(serializeOpportunityQuery(r.value));
    expect(p.getAll("sourceFamily")).toEqual(["LH", "KEPCO"]);
    expect(parseOpportunityQuery({ stage: "PLAN" }, "demo").ok).toBe(false);
    const blank = parseOpportunityQuery({ q: "   " }, "live");
    expect(blank.ok && blank.value.q).toBe(null);
  });
  it("커서는 조직·필터·만료·위변조 경계를 지킨다", () => {
    const key = "x".repeat(32),
      now = 100000000;
    const signed = signOpportunityCursor(
      {
        scope: "org-filter",
        version: "v1",
        asOf: "2026-10-21T00:00:00Z",
        issuedAt: now,
        rank: 0,
        id: "00000000-0000-4000-8000-000000000001",
        value: null,
      },
      key,
    );
    expect(verifyOpportunityCursor(signed, "org-filter", key, now)).not.toBeNull();
    expect(verifyOpportunityCursor(signed, "other-org", key, now)).toBeNull();
    expect(verifyOpportunityCursor(signed, "org-filter", key, now + 86400000)).toBeNull();
    expect(verifyOpportunityCursor(signed + "0", "org-filter", key, now)).toBeNull();
  });
  it("기본 정렬은 추천순이고 키워드를 복귀 URL에 보존한다", () => {
    const q = parse({ keyword: ["AI_AX", "ISP_ISMP"] });
    expect(q.sort).toBe("recommended");
    expect(q.sortExplicit).toBe(false);
    expect(new URLSearchParams(serializeOpportunityQuery(q)).getAll("keyword")).toEqual([
      "AI_AX",
      "ISP_ISMP",
    ]);
    expect(parseOpportunityQuery({ keyword: "NOPE" }, "live").ok).toBe(false);
  });
});

describe("IT 범위·추천순 조회(ADR-069)", () => {
  it("추천순 커서는 recommend_key 오름차순으로 이어 간다", () => {
    const q = { ...parse({}), sort: "recommended" as const, siAiFirst: false, sortExplicit: true };
    const cursor = {
      ...baseCursor,
      id: "00000000-0000-4000-8000-000000000001",
      rank: 2,
      value: "00200",
    };
    const expr = opportunityKeyset(q, cursor);
    expect(expr).toContain('recommend_key.gt."00200"');
    expect(expr).not.toContain("recommend_key.lt.");
  });
  it("관심 목록에는 IT 범위 조건을 걸지 않는다", () => {
    const itScopeCalls = (raw: Record<string, string>) => {
      const { calls, client } = recordingClient();
      filtered(client, "org", parse(raw), "2026-10-29T00:00:00Z");
      return calls.filter(([method, column]) => method === "eq" && column === "it_scope");
    };
    expect(itScopeCalls({})).toEqual([["eq", "it_scope", true]]);
    expect(itScopeCalls({ watched: "me" })).toEqual([]);
  });
  it("AI·SI 우선을 켜면 고른 정렬과 상관없이 묶음이 첫 정렬이다", async () => {
    const orderOf = async (raw: Record<string, string>) => {
      const { calls, client } = recordingClient();
      await listOpportunities(client, "org", parse(raw), "x".repeat(32));
      return calls.filter(([method]) => method === "order").map(([, column]) => column);
    };
    expect(await orderOf({ sort: "publishedAt:desc" })).toEqual([
      "relevance_rank",
      "published_at",
      "id",
    ]);
    expect(await orderOf({})).toEqual(["relevance_rank", "recommend_key", "id"]);
    expect(await orderOf({ sort: "publishedAt:desc", siAiFirst: "false" })).toEqual([
      "published_at",
      "id",
    ]);
  });
  it("AI·SI 우선 커서는 고른 정렬에서도 묶음부터 비교하고, 끄면 정렬 값부터 비교한다", () => {
    const cursor = {
      ...baseCursor,
      id: "00000000-0000-4000-8000-000000000001",
      rank: 2,
      value: "2026-10-20T00:00:00Z",
    };
    const within =
      'or(published_at.lt."2026-10-20T00:00:00Z",published_at.is.null,' +
      'and(published_at.eq."2026-10-20T00:00:00Z",id.gt."00000000-0000-4000-8000-000000000001"))';
    expect(opportunityKeyset(parse({ sort: "publishedAt:desc" }), cursor)).toBe(
      `or(relevance_rank.gt.2,and(relevance_rank.eq.2,${within}))`,
    );
    expect(opportunityKeyset(parse({ sort: "publishedAt:desc", siAiFirst: "false" }), cursor)).toBe(
      within,
    );
  });
  it("고른 키워드는 분류·태그 OR 조건 하나로 건다", () => {
    const { calls, client } = recordingClient();
    filtered(client, "org", parse({ keyword: ["AI_AX", "MAINTENANCE"] }), "2026-10-29T00:00:00Z");
    expect(calls).toContainEqual(["or", "categories.ov.{AI_AX},tags.ov.{maintenance}"]);
  });
});

describe("본인 관심 사업기회 범위", () => {
  it("관심 조건을 URL에 보존하고 다른 사용자의 커서를 거부한다", () => {
    const parsed = parseOpportunityQuery({ watched: "me", sourceFamily: "LH" }, "demo");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(new URLSearchParams(serializeOpportunityQuery(parsed.value)).get("watched")).toBe("me");
    const key = "x".repeat(32);
    const now = Date.now();
    const signed = signOpportunityCursor(
      {
        scope: fingerprint("org", parsed.value, "user-a"),
        version: "v1",
        asOf: new Date(now).toISOString(),
        issuedAt: now,
        rank: 0,
        id: "00000000-0000-4000-8000-000000000001",
        value: null,
      },
      key,
    );
    expect(
      verifyOpportunityCursor(signed, fingerprint("org", parsed.value, "user-b"), key, now),
    ).toBeNull();
    expect(parseOpportunityQuery({ watched: "other-user" }, "demo").ok).toBe(false);
  });
});
