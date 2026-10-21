import { describe, expect, it, vi } from "vitest";
import { requestWatch } from "./watch-bid";

// ★ 토글 요청(N3 디자인 §3.3). 켜기 PUT·끄기 DELETE, 쓰기 머리글(X-Requested-With), 본문 없음.
// 응답 모양이 맞을 때만 ok 이고, 그 밖(4xx·5xx·네트워크·JSON 아님·모양 틀림)은 던지지 않고 ok:false 다 —
// 토글이 되돌리고 토스트 한 줄을 내는 갈래가 하나라서다.

const BID_ID = "b1d00000-0000-4000-8000-000000000001";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fetcherOf = (response: Response | Error) =>
  vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });

describe("requestWatch", () => {
  it("켜기는 PUT, 끄기는 DELETE 이고 쓰기 머리글을 싣고 본문이 없다", async () => {
    const put = fetcherOf(jsonResponse(200, { bidId: BID_ID, watched: true, watcherCount: 1 }));
    await requestWatch(BID_ID, true, put);
    const [putUrl, putInit] = put.mock.calls[0] ?? [];
    expect(putUrl).toBe(`/api/v1/bids/${BID_ID}/watch`);
    expect(putInit?.method).toBe("PUT");
    expect(new Headers(putInit?.headers).get("X-Requested-With")).toBe("sol-radar");
    expect(putInit?.body ?? null).toBeNull();
    expect(putInit?.cache).toBe("no-store");

    const del = fetcherOf(jsonResponse(200, { bidId: BID_ID, watched: false, watcherCount: 0 }));
    await requestWatch(BID_ID, false, del);
    const [delUrl, delInit] = del.mock.calls[0] ?? [];
    expect(delUrl).toBe(`/api/v1/bids/${BID_ID}/watch`);
    expect(delInit?.method).toBe("DELETE");
    expect(new Headers(delInit?.headers).get("X-Requested-With")).toBe("sol-radar");
  });

  it("공고 id 는 주소 조각으로 감싼다(경로를 늘리지 못한다)", async () => {
    const fetcher = fetcherOf(jsonResponse(404, {}));
    await requestWatch("a/../b?x", true, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/bids/a%2F..%2Fb%3Fx/watch");
  });

  it("200 이고 모양이 맞으면 응답의 watched·watcherCount 를 돌려준다", async () => {
    await expect(
      requestWatch(
        BID_ID,
        true,
        fetcherOf(jsonResponse(200, { bidId: BID_ID, watched: true, watcherCount: 3 })),
      ),
    ).resolves.toEqual({ ok: true, watched: true, watcherCount: 3 });
    await expect(
      requestWatch(
        BID_ID,
        false,
        fetcherOf(jsonResponse(200, { bidId: BID_ID, watched: false, watcherCount: 0 })),
      ),
    ).resolves.toEqual({ ok: true, watched: false, watcherCount: 0 });
  });

  it.each([
    ["404", jsonResponse(404, { error: { code: "NOT_FOUND" } })],
    ["401", jsonResponse(401, { error: { code: "UNAUTHENTICATED" } })],
    ["403 CSRF", jsonResponse(403, { error: { code: "CSRF_REJECTED" } })],
    ["500", jsonResponse(500, { error: { code: "INTERNAL_ERROR" } })],
    ["200 인데 JSON 아님", new Response("<html>", { status: 200 })],
    [
      "200 인데 다른 공고 id",
      jsonResponse(200, { bidId: "other", watched: true, watcherCount: 1 }),
    ],
    [
      "200 인데 watched 가 글자",
      jsonResponse(200, { bidId: BID_ID, watched: "true", watcherCount: 1 }),
    ],
    ["200 인데 인원이 음수", jsonResponse(200, { bidId: BID_ID, watched: true, watcherCount: -1 })],
    [
      "200 인데 인원이 소수",
      jsonResponse(200, { bidId: BID_ID, watched: true, watcherCount: 1.5 }),
    ],
    ["200 인데 인원 없음", jsonResponse(200, { bidId: BID_ID, watched: true })],
    ["200 인데 null", jsonResponse(200, null)],
    ["네트워크 오류", new TypeError("Failed to fetch")],
  ])("%s 이면 던지지 않고 ok:false 다", async (_name, response) => {
    await expect(requestWatch(BID_ID, true, fetcherOf(response))).resolves.toEqual({ ok: false });
  });
});
