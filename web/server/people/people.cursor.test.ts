import "server-only";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPeopleCursor, readPeopleCursor } from "./people.cursor";
import { PeopleReadError } from "./people.model";
const secret = "test-only-cursor-secret-at-least-32-characters";
const now = Date.parse("2026-10-18T00:00:00Z");
const binding = { orgId: "org-a", query: { q: "김", limit: 20 } };
const position = { personCode: "SOL-P0020", id: "00000000-0000-4000-8000-000000000020" };
afterEach(() => vi.unstubAllEnvs());
describe("HMAC pagination", () => {
  it("roundtrips the last sort key, binds org/filter/limit, and expires at 24h", () => {
    vi.stubEnv("API_CURSOR_SECRET", secret);
    const token = createPeopleCursor(binding, position, now);
    expect(readPeopleCursor(token, binding, now)).toEqual(position);
    for (const other of [
      { ...binding, orgId: "org-b" },
      { ...binding, query: { q: "다른", limit: 20 } },
      { ...binding, query: { q: "김", limit: 21 } },
    ])
      expect(() => readPeopleCursor(token, other, now)).toThrowError(PeopleReadError);
    expect(() => readPeopleCursor(token, binding, now + 86400000)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => readPeopleCursor(token, binding, now - 1)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(readPeopleCursor(token, binding, now + 86399999)).toEqual(position);
  });
  it("rejects malformed, changed and oversized signatures", () => {
    vi.stubEnv("API_CURSOR_SECRET", secret);
    const token = createPeopleCursor(binding, position, now);
    const [body, signature] = token.split(".");
    for (const invalid of [
      "",
      "bad",
      `${body}.a`,
      `${body}.${signature.slice(1)}`,
      `${body}.${signature}.extra`,
      `${body.slice(1)}.${signature}`,
      `${body}.${signature.slice(0, -1)}!`,
    ])
      expect(() => readPeopleCursor(invalid, binding, now)).toThrowError(
        expect.objectContaining({ code: "INVALID_CURSOR" }),
      );
  });
  it.each(["", "short"])("never falls back when cursor secret is %s", (value) => {
    vi.stubEnv("API_CURSOR_SECRET", value);
    expect(() => createPeopleCursor(binding, position, now)).toThrowError(
      expect.objectContaining({
        httpStatus: 503,
        code: "SERVICE_UNAVAILABLE",
        details: { component: "cursor" },
      }),
    );
    expect(() => readPeopleCursor("invalid", binding, now)).toThrowError(
      expect.objectContaining({ httpStatus: 503 }),
    );
  });
  it("normalizes field order and ignores the input cursor in the binding", () => {
    vi.stubEnv("API_CURSOR_SECRET", secret);
    const token = createPeopleCursor(binding, position, now);
    expect(
      readPeopleCursor(
        token,
        { orgId: "org-a", query: { limit: 20, q: "김", cursor: token } },
        now,
      ),
    ).toEqual(position);
  });
});
