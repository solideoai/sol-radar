import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CURSOR_TTL_MS,
  cursorScope,
  defaultOrigin,
  fingerprintOf,
  parseBidListQuery,
  parseNotificationQuery,
  parseOriginQuery,
  parsePageQuery,
  readCursorSecret,
  signCursor,
  verifyCursor,
  type BidListQuery,
} from "./bid-query";

const SECRET = "test-secret";
const ORG = "org-1";
const NOW = Date.parse("2026-10-20T00:00:00Z");

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
    queryFingerprint: fingerprintOf(ORG, query),
    issuedAt: NOW,
  };
  const invalid = { ok: false, code: "INVALID_CURSOR" };

  it("같은 쿼리로 검증하면 통과한다", () => {
    const cursor = signCursor(payload, SECRET);
    const result = verifyCursor(cursor, fingerprintOf(ORG, query), SECRET, NOW);
    expect(result).toEqual({ ok: true, payload });
  });

  it("한 글자를 바꾸면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    const tampered = `${cursor.slice(0, 5)}${cursor[5] === "A" ? "B" : "A"}${cursor.slice(6)}`;
    expect(verifyCursor(tampered, fingerprintOf(ORG, query), SECRET, NOW)).toEqual(invalid);
    expect(verifyCursor("garbage", fingerprintOf(ORG, query), SECRET, NOW).ok).toBe(false);
  });

  it("다른 비밀로 서명한 커서는 거절한다", () => {
    expect(
      verifyCursor(signCursor(payload, "other"), fingerprintOf(ORG, query), SECRET, NOW).ok,
    ).toBe(false);
  });

  it("필터가 바뀐 쿼리로 검증하면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    const changed = parsed({ stage: "PLAN" });
    expect(verifyCursor(cursor, fingerprintOf(ORG, changed), SECRET, NOW)).toEqual(invalid);
  });

  it("limit·cursor 가 바뀌어도 지문은 같다", () => {
    const other = parsed({ stage: "NOTICE", limit: "50" });
    expect(fingerprintOf(ORG, other)).toBe(fingerprintOf(ORG, query));
  });

  // 보안 L3: 다른 조직에서 받은 커서를 이 조직 목록에 쓰지 못한다(05 :478 people 커서와 같은 규칙).
  it("다른 조직의 지문으로 검증하면 INVALID_CURSOR 다", () => {
    expect(fingerprintOf("org-2", query)).not.toBe(fingerprintOf(ORG, query));
    const cursor = signCursor(payload, SECRET);
    expect(verifyCursor(cursor, fingerprintOf("org-2", query), SECRET, NOW)).toEqual(invalid);
  });

  it("발급 뒤 24시간이 되면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    const fingerprint = fingerprintOf(ORG, query);
    expect(verifyCursor(cursor, fingerprint, SECRET, NOW + CURSOR_TTL_MS - 1).ok).toBe(true);
    expect(verifyCursor(cursor, fingerprint, SECRET, NOW + CURSOR_TTL_MS)).toEqual(invalid);
  });

  it("발급 시각이 지금보다 뒤면 INVALID_CURSOR 다", () => {
    const cursor = signCursor(payload, SECRET);
    expect(verifyCursor(cursor, fingerprintOf(ORG, query), SECRET, NOW - 1)).toEqual(invalid);
  });

  it("발급 시각이 없는 서명 커서는 INVALID_CURSOR 다", () => {
    // 서명은 맞고 본문에 issuedAt 만 없다(L3 이전에 발급한 커서와 같은 모양).
    const legacy = {
      sortValue: payload.sortValue,
      id: payload.id,
      queryFingerprint: payload.queryFingerprint,
    };
    const body = Buffer.from(JSON.stringify(legacy), "utf8").toString("base64url");
    const legacyCursor = `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
    expect(verifyCursor(legacyCursor, fingerprintOf(ORG, query), SECRET, NOW)).toEqual(invalid);
  });
});

describe("status·deadline 파라미터 (O8)", () => {
  it("status 기본값은 OPEN·AMENDED 다", () => {
    expect(parsed({}).status).toEqual(["OPEN", "AMENDED"]);
  });

  it("status 를 반복해서 받는다", () => {
    expect(parsed({ status: ["CANCELLED", "OPEN"] }).status).toEqual(["CANCELLED", "OPEN"]);
  });

  it("status=bogus 는 path 가 status 인 실패다", () => {
    const result = parseBidListQuery({ status: "bogus" }, "mock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("status");
  });

  it("deadlineFrom 이 deadlineTo 보다 늦으면 path 가 deadlineFrom 인 실패다", () => {
    const result = parseBidListQuery(
      { deadlineFrom: "2026-11-01T00:00:00Z", deadlineTo: "2026-10-01T00:00:00Z" },
      "mock",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("deadlineFrom");
  });

  it("offset 이 없는 날짜는 실패다", () => {
    const result = parseBidListQuery({ deadlineTo: "2026-10-01" }, "mock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("deadlineTo");
  });

  it("offset 이 있는 범위와 같은 시각은 받는다", () => {
    const value = parsed({
      deadlineFrom: "2026-10-01T09:00:00+09:00",
      deadlineTo: "2026-10-01T00:00:00Z",
    });
    expect(value.deadlineFrom).toBe("2026-10-01T09:00:00+09:00");
    expect(value.deadlineTo).toBe("2026-10-01T00:00:00Z");
    expect(parsed({}).deadlineFrom).toBeNull();
  });

  it("status·deadlineFrom·deadlineTo 가 바뀐 쿼리로 검증한 커서는 INVALID_CURSOR 다", () => {
    const base = parsed({ deadlineFrom: "2026-10-01T00:00:00Z" });
    const cursor = signCursor(
      { sortValue: "x", id: "b1", queryFingerprint: fingerprintOf(ORG, base), issuedAt: NOW },
      SECRET,
    );
    expect(verifyCursor(cursor, fingerprintOf(ORG, base), SECRET, NOW).ok).toBe(true);
    const invalid = { ok: false, code: "INVALID_CURSOR" };
    for (const changed of [
      parsed({ deadlineFrom: "2026-10-01T00:00:00Z", status: "CANCELLED" }),
      parsed({ deadlineFrom: "2026-10-01T00:00:00Z", deadlineTo: "2026-12-01T00:00:00Z" }),
      parsed({ deadlineFrom: "2026-10-02T00:00:00Z" }),
    ]) {
      expect(verifyCursor(cursor, fingerprintOf(ORG, changed), SECRET, NOW)).toEqual(invalid);
    }
  });
});

describe("cursorScope", () => {
  it("종류가 다르면 같은 값이어도 지문이 다르다", () => {
    expect(cursorScope("notifications", [true])).not.toBe(cursorScope("analyses", [true]));
    expect(cursorScope("notifications", [true])).not.toBe(cursorScope("notifications", [false]));
    expect(cursorScope("notifications", [true])).toBe(cursorScope("notifications", [true]));
  });
});

describe("readCursorSecret (O9)", () => {
  it("32자 미만이거나 공백뿐이면 null 이다", () => {
    expect(readCursorSecret(undefined)).toBeNull();
    expect(readCursorSecret("a".repeat(31))).toBeNull();
    expect(readCursorSecret(" ".repeat(40))).toBeNull();
  });
  it("32자 이상이면 trim 한 값이다", () => {
    expect(readCursorSecret("a".repeat(32))).toBe("a".repeat(32));
    expect(readCursorSecret(` ${"b".repeat(32)} `)).toBe("b".repeat(32));
  });
});

describe("parsePageQuery·parseNotificationQuery·parseOriginQuery", () => {
  it("parsePageQuery 는 기본 크기 20 과 커서를 받는다", () => {
    expect(parsePageQuery({})).toEqual({ ok: true, value: { cursor: null, limit: 20 } });
    expect(parsePageQuery({ cursor: "c", limit: "5" })).toEqual({
      ok: true,
      value: { cursor: "c", limit: 5 },
    });
  });

  it("parsePageQuery 는 범위를 벗어난 limit 을 거절한다", () => {
    const result = parsePageQuery({ limit: "101" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("limit");
  });

  it("parseNotificationQuery 의 unreadOnly 는 true·false 만 받는다", () => {
    const base = { cursor: null, limit: 20 };
    expect(parseNotificationQuery({})).toEqual({ ok: true, value: { ...base, unreadOnly: false } });
    expect(parseNotificationQuery({ unreadOnly: "true" })).toEqual({
      ok: true,
      value: { ...base, unreadOnly: true },
    });
    const bad = parseNotificationQuery({ unreadOnly: "yes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.path).toBe("unreadOnly");
  });

  it("parseOriginQuery 는 실행 모드별 기본값과 isDemo 충돌을 다룬다", () => {
    expect(parseOriginQuery({}, "live")).toEqual({ ok: true, value: { origin: "live" } });
    expect(parseOriginQuery({}, "mock")).toEqual({ ok: true, value: { origin: "demo" } });
    expect(parseOriginQuery({ origin: "all" }, "mock")).toEqual({
      ok: true,
      value: { origin: "all" },
    });
    expect(parseOriginQuery({ isDemo: "true", origin: "live" }, "mock").ok).toBe(false);
    expect(parseOriginQuery({ origin: "bogus" }, "mock").ok).toBe(false);
  });
});

describe("defaultOrigin", () => {
  it("live 만 live, fixture·mock 은 demo 다", () => {
    expect(defaultOrigin("live")).toBe("live");
    expect(defaultOrigin("fixture")).toBe("demo");
    expect(defaultOrigin("mock")).toBe("demo");
  });
});
