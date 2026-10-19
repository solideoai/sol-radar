import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recheckTopbarAfterReview, submitReview, TOPBAR_RECHECK_MS } from "./submit-review";

// 결정 기록 전송(스펙 §5.4.9 결정 기록 흐름). fetch 를 가짜로 바꾸고 보낸 요청과 옮긴 결과만 본다.

const BID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const INPUT = { decision: "WATCH" as const, reason: "일정 위험이 있어 지켜봅니다." };

const envelope = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  requestId = "req-1",
) =>
  new Response(JSON.stringify({ error: { code, message: "서버 문장", details, requestId } }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("submitReview", () => {
  it("POST 에 CSRF 머리글과 JSON 본문을 싣고 201 이면 ok 다", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "r1" }), { status: 201 }));
    await expect(submitReview(BID, INPUT)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/bids/${BID}/reviews`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Requested-With")).toBe("sol-radar");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(INPUT);
  });

  it("400 VALIDATION_ERROR 의 첫 issue 가 reason 이면 field 가 reason 이다", async () => {
    fetchMock.mockResolvedValue(
      envelope(400, "VALIDATION_ERROR", { issues: [{ path: "reason", message: "짧다" }] }),
    );
    await expect(submitReview(BID, INPUT)).resolves.toEqual({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "서버 문장",
      requestId: "req-1",
      field: "reason",
    });
  });

  it("400 VALIDATION_ERROR 라도 첫 issue 가 다른 칸이면 field 가 없다", async () => {
    fetchMock.mockResolvedValue(
      envelope(400, "VALIDATION_ERROR", { issues: [{ path: "decision", message: "없다" }] }),
    );
    const result = await submitReview(BID, INPUT);
    expect(result).not.toHaveProperty("field");
  });

  it("404 {resource:assignee} 면 field 가 assigneeUserId 다", async () => {
    fetchMock.mockResolvedValue(envelope(404, "NOT_FOUND", { resource: "assignee" }));
    const result = await submitReview(BID, INPUT);
    expect(result).toMatchObject({ ok: false, status: 404, field: "assigneeUserId" });
  });

  it("404 {resource:bid} 면 field 가 없다", async () => {
    fetchMock.mockResolvedValue(envelope(404, "NOT_FOUND", { resource: "bid" }));
    expect(await submitReview(BID, INPUT)).not.toHaveProperty("field");
  });

  it("500 이면 code 와 requestId 를 옮긴다", async () => {
    fetchMock.mockResolvedValue(envelope(500, "INTERNAL_ERROR", {}, "req-500"));
    await expect(submitReview(BID, INPUT)).resolves.toEqual({
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "서버 문장",
      requestId: "req-500",
    });
  });

  it("봉투가 아닌 오류면 상태 코드로 code 를 정하고 requestId 는 응답 머리글에서 읽는다", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "X-Request-Id": "req-head" },
      }),
    );
    expect(await submitReview(BID, INPUT)).toMatchObject({
      ok: false,
      status: 502,
      code: "INTERNAL_ERROR",
      requestId: "req-head",
    });
  });

  it("네트워크 오류는 던지지 않고 NETWORK_ERROR 로 돌려준다", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await submitReview(BID, INPUT)).toMatchObject({
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
    });
  });
});

describe("recheckTopbarAfterReview", () => {
  it("지금 한 번, 5초 뒤 한 번 더 읽는다(D5)", () => {
    vi.useFakeTimers();
    const recheck = vi.fn(() => Promise.resolve());
    recheckTopbarAfterReview(recheck);
    expect(recheck).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TOPBAR_RECHECK_MS - 1);
    expect(recheck).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(recheck).toHaveBeenCalledTimes(2);
    expect(TOPBAR_RECHECK_MS).toBe(5_000);
  });

  it("돌려준 취소 함수를 부르면 두 번째 읽기를 하지 않는다", () => {
    vi.useFakeTimers();
    const recheck = vi.fn(() => Promise.resolve());
    const cancel = recheckTopbarAfterReview(recheck);
    cancel();
    vi.advanceTimersByTime(TOPBAR_RECHECK_MS * 2);
    expect(recheck).toHaveBeenCalledTimes(1);
  });
});
