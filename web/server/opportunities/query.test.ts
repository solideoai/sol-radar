import { describe, it, expect } from "vitest";
import {
  fingerprint,
  parseOpportunityQuery,
  serializeOpportunityQuery,
  signOpportunityCursor,
  verifyOpportunityCursor,
} from "./query";
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
