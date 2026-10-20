import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGatewayHealth } from "./ai-status.repo";

// gateway GET /health 한 번(재시도 없음). 실패는 던지지 않고 null 이다. 바깥 세계(fetch)만 가짜로 바꾼다.

const HEALTH_URL = "http://gw.invalid:8000/health";
const MOCK_HEALTH = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: {
    model: "fixture",
    promptHash: "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e",
  },
  kev: { modelId: "mock", registryMatch: null },
  questionSets: ["kev-qs/v0.1"],
  parsers: [{ format: "PDF", parserId: null }],
};

const jsonReply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(reply: () => Promise<Response>) {
  const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(reply);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGatewayHealth", () => {
  it("200 과 스키마에 맞는 본문이면 그 본문을 돌려준다", async () => {
    stubFetch(async () => jsonReply(MOCK_HEALTH));
    expect(await fetchGatewayHealth(HEALTH_URL)).toEqual(MOCK_HEALTH);
  });

  it("받은 주소 그대로 한 번만 부른다", async () => {
    const fetchMock = stubFetch(async () => jsonReply(MOCK_HEALTH));
    await fetchGatewayHealth(HEALTH_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(HEALTH_URL);
  });

  it("리다이렉트를 따라가지 않고(redirect: error) 캐시하지 않는다", async () => {
    const fetchMock = stubFetch(async () => jsonReply(MOCK_HEALTH));
    await fetchGatewayHealth(HEALTH_URL);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("500 이면 null 이고 다시 부르지 않는다", async () => {
    const fetchMock = stubFetch(async () => jsonReply(MOCK_HEALTH, 500));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([203, 404])("%s 이면 본문이 스키마에 맞아도 null 이다(200 만 받는다)", async (status) => {
    stubFetch(async () => jsonReply(MOCK_HEALTH, status));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("204(본문 없음)도 null 이다", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("리다이렉트 응답(302)은 따라가지 않고 null 이다", async () => {
    const fetchMock = stubFetch(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://evil.invalid/" } }),
    );
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("본문이 JSON 이 아니면 null 이다", async () => {
    stubFetch(async () => new Response("<html>gateway</html>", { status: 200 }));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("본문이 스키마에 맞지 않으면 null 이다", async () => {
    stubFetch(async () => jsonReply({ ...MOCK_HEALTH, provider: "openai" }));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("status 가 ok 가 아니면 null 이다", async () => {
    stubFetch(async () => jsonReply({ ...MOCK_HEALTH, status: "degraded" }));
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("fetch 가 거부되면(연결 실패·리다이렉트 오류) 던지지 않고 null 이며 다시 부르지 않는다", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("본문 읽기가 실패해도 null 이다", async () => {
    stubFetch(async () => {
      const response = jsonReply(MOCK_HEALTH);
      vi.spyOn(response, "json").mockRejectedValue(new Error("aborted"));
      return response;
    });
    expect(await fetchGatewayHealth(HEALTH_URL)).toBeNull();
  });

  it("모르는 필드는 결과에서 버린다", async () => {
    stubFetch(async () => jsonReply({ ...MOCK_HEALTH, modelPath: "/srv/models/secret" }));
    expect(await fetchGatewayHealth(HEALTH_URL)).not.toHaveProperty("modelPath");
  });
});
