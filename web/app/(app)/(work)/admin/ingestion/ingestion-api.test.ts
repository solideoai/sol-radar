import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFirstPage, readIngestionRun, requestIngestionRun } from "./ingestion-api";
import type { IngestRun } from "./ingestion-copy";

// 수집 관리 화면이 부르는 v1 세 주소(N8 구현 계획 §1, 디자인 스펙 §4.8·§4.11·§4.12). fetch 를 가짜로 바꾸고
// 보낸 요청(주소·머리글·본문)과 응답 해석만 본다.

const ENDPOINT = "/api/v1/admin/ingestion/runs";
const RUN_ID = "d5367aa6-0000-4000-8000-000000000001";
const KEY = "0b0e4c4e-2f1a-4c1e-9a7e-3b2c1d0e9f80";

const RUN: IngestRun = {
  id: RUN_ID,
  source: "fixture",
  runMode: "mock",
  batch: "seed",
  trigger: "MANUAL",
  status: "RUNNING",
  summary: {
    created: 0,
    changed: 0,
    cancelled: 0,
    skippedDuplicate: 0,
    quarantined: 0,
    retried: 0,
  },
  quotaUsed: 0,
  errors: [],
  cursor: null,
  requestedBy: { id: "u1", name: "김가람" },
  startedAt: "2026-10-20T05:00:00.000Z",
  finishedAt: null,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const envelope = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  json(
    status,
    { error: { code, message: "server text", details, requestId: "req-1" } },
    { "X-Request-Id": "req-1", ...headers },
  );

const page = (items: unknown[], nextCursor: unknown = null) =>
  json(200, { items, pageInfo: { cursor: null, nextCursor, hasNext: nextCursor !== null } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestIngestionRun — POST", () => {
  it("POST 에 CSRF 머리글·Idempotency-Key·JSON 본문을 싣는다", async () => {
    fetchMock.mockResolvedValue(json(202, RUN));
    await requestIngestionRun({ source: "fixture", batch: "seed" }, KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("sol-radar");
    expect(headers.get("Idempotency-Key")).toBe(KEY);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ source: "fixture", batch: "seed" });
  });

  it("202 본문이 run 모양이면 ok 와 그 run 이다", async () => {
    fetchMock.mockResolvedValue(json(202, RUN));
    await expect(requestIngestionRun({ source: "g2b" }, KEY)).resolves.toEqual({
      ok: true,
      run: RUN,
    });
  });

  it("2xx 인데 본문이 run 모양이 아니면 500 INTERNAL_ERROR 실패다", async () => {
    fetchMock.mockResolvedValue(json(202, { id: RUN_ID }, { "X-Request-Id": "req-9" }));
    const outcome = await requestIngestionRun({ source: "g2b" }, KEY);
    expect(outcome).toMatchObject({
      ok: false,
      failure: { status: 500, code: "INTERNAL_ERROR", requestId: "req-9" },
      retryAfterSec: null,
    });
  });

  it("오류 봉투의 code·details·requestId 를 옮긴다(409 INGESTION_IN_PROGRESS)", async () => {
    fetchMock.mockResolvedValue(envelope(409, "INGESTION_IN_PROGRESS", { runId: RUN_ID }));
    const outcome = await requestIngestionRun({ source: "fixture", batch: "live" }, KEY);
    expect(outcome).toEqual({
      ok: false,
      failure: {
        status: 409,
        code: "INGESTION_IN_PROGRESS",
        message: "server text",
        requestId: "req-1",
        details: { runId: RUN_ID },
      },
      retryAfterSec: null,
    });
  });

  it("fetch 가 던지면 상태 0 NETWORK_ERROR 이고 던지지 않는다", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestIngestionRun({ source: "g2b" }, KEY)).resolves.toEqual({
      ok: false,
      failure: {
        status: 0,
        code: "NETWORK_ERROR",
        message: "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.",
        details: {},
      },
      retryAfterSec: null,
    });
  });
});

describe("requestIngestionRun — Retry-After(05 §5)", () => {
  it("429 의 Retry-After 머리글(초)을 retryAfterSec 으로 옮긴다", async () => {
    fetchMock.mockResolvedValue(envelope(429, "RATE_LIMITED", {}, { "Retry-After": "17" }));
    const outcome = await requestIngestionRun({ source: "g2b" }, KEY);
    expect(outcome).toMatchObject({ ok: false, retryAfterSec: 17 });
  });

  it("머리글이 숫자가 아니면 details.retryAfterSeconds 를 쓴다", async () => {
    fetchMock.mockResolvedValue(
      envelope(429, "RATE_LIMITED", { retryAfterSeconds: 9 }, { "Retry-After": "soon" }),
    );
    expect(await requestIngestionRun({ source: "g2b" }, KEY)).toMatchObject({ retryAfterSec: 9 });
  });

  it.each(["0", "-3", "1.5"])("머리글 %s 은 쓰지 않는다(양의 정수만)", async (value) => {
    fetchMock.mockResolvedValue(envelope(429, "RATE_LIMITED", {}, { "Retry-After": value }));
    expect(await requestIngestionRun({ source: "g2b" }, KEY)).toMatchObject({
      retryAfterSec: null,
    });
  });

  it("머리글도 details 도 없으면 null 이다(화면이 60초로 정한다)", async () => {
    fetchMock.mockResolvedValue(envelope(429, "RATE_LIMITED"));
    expect(await requestIngestionRun({ source: "g2b" }, KEY)).toMatchObject({
      retryAfterSec: null,
    });
  });
});

describe("readFirstPage — 폴링 첫 쪽(§4.8)", () => {
  const signal = new AbortController().signal;

  it("커서 없이 첫 쪽을 Accept JSON 으로 읽고 signal 을 넘긴다", async () => {
    fetchMock.mockResolvedValue(page([RUN]));
    await readFirstPage(signal);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });

  it("200 이고 모양이 맞으면 items 다", async () => {
    fetchMock.mockResolvedValue(page([RUN], "cursor-2"));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "ok", items: [RUN] });
  });

  it.each([401, 403] as const)("%i 는 denied 다(폴링을 멈춘다)", async (status) => {
    fetchMock.mockResolvedValue(envelope(status, status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "denied", status });
  });

  it.each([429, 500, 502, 503])("%i 는 failed 다(다음 주기에 다시 읽는다)", async (status) => {
    fetchMock.mockResolvedValue(envelope(status, "X"));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "failed" });
  });

  it("네트워크 오류·중단(abort)은 failed 다", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "failed" });
  });

  it.each([
    ["items 가 없다", { pageInfo: { nextCursor: null } }],
    ["pageInfo 가 없다", { items: [] }],
    ["nextCursor 가 숫자다", { items: [], pageInfo: { nextCursor: 2 } }],
    [
      "항목에 summary 가 없다",
      { items: [{ ...RUN, summary: null }], pageInfo: { nextCursor: null } },
    ],
    [
      "항목에 errors 배열이 없다",
      { items: [{ ...RUN, errors: {} }], pageInfo: { nextCursor: null } },
    ],
    ["항목 id 가 글자가 아니다", { items: [{ ...RUN, id: 1 }], pageInfo: { nextCursor: null } }],
  ])("200 이라도 %s 면 failed 다", async (_name, body) => {
    fetchMock.mockResolvedValue(json(200, body));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "failed" });
  });

  it("200 이라도 본문이 JSON 이 아니면 failed 다", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(readFirstPage(signal)).resolves.toEqual({ kind: "failed" });
  });
});

describe("readIngestionRun — 상세(§4.12)", () => {
  const signal = new AbortController().signal;

  it("id 를 주소에 인코딩해 붙인다", async () => {
    fetchMock.mockResolvedValue(json(200, RUN));
    await readIngestionRun("a/b?c", signal);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ENDPOINT}/a%2Fb%3Fc`);
  });

  it("200 이고 run 모양이면 ok 다", async () => {
    fetchMock.mockResolvedValue(json(200, RUN));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({ kind: "ok", run: RUN });
  });

  it("404 는 not-found 다(접수 run 이면 '아직 시작 전')", async () => {
    fetchMock.mockResolvedValue(envelope(404, "NOT_FOUND"));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({ kind: "not-found" });
  });

  it.each([401, 403] as const)("%i 는 denied 다", async (status) => {
    fetchMock.mockResolvedValue(envelope(status, "X"));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({ kind: "denied", status });
  });

  it("그 밖의 실패는 봉투 requestId 와 함께 failed 다", async () => {
    fetchMock.mockResolvedValue(envelope(500, "INTERNAL_ERROR"));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({
      kind: "failed",
      requestId: "req-1",
    });
  });

  it("봉투가 없으면 X-Request-Id 머리글을 requestId 로 쓴다", async () => {
    fetchMock.mockResolvedValue(
      new Response("bad gateway", { status: 502, headers: { "X-Request-Id": "req-h" } }),
    );
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({
      kind: "failed",
      requestId: "req-h",
    });
  });

  it("requestId 를 알 수 없으면 requestId 키가 없다", async () => {
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({ kind: "failed" });
  });

  it("네트워크 오류는 failed 다", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(readIngestionRun(RUN_ID, signal)).resolves.toEqual({ kind: "failed" });
  });
});
