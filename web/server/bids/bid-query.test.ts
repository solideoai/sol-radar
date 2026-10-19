import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  parseBidListQuery,
  signCursor,
  verifyCursor,
  type BidListQuery,
} from "./bid-query";

const SECRET = "test-secret";

function parsed(query: Parameters<typeof parseBidListQuery>[0]): BidListQuery {
  const result = parseBidListQuery(query, "mock");
  if (!result.ok) throw new Error("파싱 실패");
  return result.value;
}

describe("parseBidListQuery", () => {
  it("origin 기본값은 실행 모드를 따른다", () => {
    const mock = parseBidListQuery({}, "mock");
    expect(mock.ok && mock.value.origin).toBe("demo");
    const fixture = parseBidListQuery({}, "fixture");
    expect(fixture.ok && fixture.value.origin).toBe("demo");
    const live = parseBidListQuery({}, "live");
    expect(live.ok && live.value.origin).toBe("live");
  });

  it("기본 정렬·크기를 채운다", () => {
    const result = parseBidListQuery({}, "mock");
    expect(result.ok && result.value.sort).toBe("publishedAt:desc");
    expect(result.ok && result.value.limit).toBe(20);
  });

  it("반복 가능한 값을 배열로 받는다", () => {
    const value = parsed({ stage: ["NOTICE", "PLAN"], decision: "NONE", origin: "all" });
    expect(value.stage).toEqual(["NOTICE", "PLAN"]);
    expect(value.decision).toEqual(["NONE"]);
    expect(value.origin).toBe("all");
  });

  it("sort=bogus 는 path 가 sort 인 실패다", () => {
    const result = parseBidListQuery({ sort: "bogus" }, "mock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("sort");
  });

  it("q 가 101자면 실패다", () => {
    const result = parseBidListQuery({ q: "a".repeat(101) }, "mock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("q");
  });

  it("limit 범위를 벗어나면 실패다", () => {
    expect(parseBidListQuery({ limit: "0" }, "mock").ok).toBe(false);
    expect(parseBidListQuery({ limit: "101" }, "mock").ok).toBe(false);
    expect(parseBidListQuery({ limit: "100" }, "mock").ok).toBe(true);
  });

  it("isDemo=true 와 origin=live 는 함께 올 수 없다", () => {
    expect(parseBidListQuery({ isDemo: "true", origin: "live" }, "mock").ok).toBe(false);
    const same = parseBidListQuery({ isDemo: "true", origin: "demo" }, "live");
    expect(same.ok && same.value.origin).toBe("demo");
    const alone = parseBidListQuery({ isDemo: "false" }, "mock");
    expect(alone.ok && alone.value.origin).toBe("live");
  });
});

describe("cursor", () => {
  const query = parsed({ stage: "NOTICE" });
  const payload = {
    sortValue: "2026-10-01T00:00:00Z",
    id: "b1",
    queryFingerprint: fingerprintOf(query),
  };

  it("같은 쿼리로 검증하면 통과한다", () => {
    const cursor = signCursor(payload, SECRET);
    const result = verifyCursor(cursor, query, SECRET);
    expect(result).toEqual({ ok: true, payload });
  });

  it("한 글자를 바꾸면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    const tampered = `${cursor.slice(0, 5)}${cursor[5] === "A" ? "B" : "A"}${cursor.slice(6)}`;
    expect(verifyCursor(tampered, query, SECRET)).toEqual({ ok: false, code: "INVALID_CURSOR" });
    expect(verifyCursor("garbage", query, SECRET).ok).toBe(false);
  });

  it("다른 비밀로 서명한 커서는 거절한다", () => {
    expect(verifyCursor(signCursor(payload, "other"), query, SECRET).ok).toBe(false);
  });

  it("필터가 바뀐 쿼리로 검증하면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    const changed = parsed({ stage: "PLAN" });
    expect(verifyCursor(cursor, changed, SECRET)).toEqual({ ok: false, code: "INVALID_CURSOR" });
  });

  it("limit·cursor 가 바뀌어도 지문은 같다", () => {
    const other = parsed({ stage: "NOTICE", limit: "50" });
    expect(fingerprintOf(other)).toBe(fingerprintOf(query));
  });
});
