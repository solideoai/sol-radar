import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchPageOutcome } from "./connector.model";
import { createOfficialApiConnector, type FetchLike } from "./official-api-connector";

// V2-03 공공 API 실패 구분 + V2-11 서비스키 보호.
// 네트워크는 가짜 fetch 뿐이다. 전역 fetch 는 부르면 실패하게 막아 둔다.

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
// 가짜 서비스키(디코딩형). +·/·= 가 있어 원문·인코딩형이 서로 다르다.
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [
  SERVICE_KEY,
  encodeURIComponent(SERVICE_KEY),
  encodeURIComponent(encodeURIComponent(SERVICE_KEY)),
  new URLSearchParams({ k: SERVICE_KEY }).toString().slice("k=".length),
];
// KST 2026-10-19 하루 = 조각 하나
const INPUT = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z", cursor: null };

const errorEnvelope = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const fetchOutcome = (fetch: FetchLike, timeoutMs?: number): Promise<FetchPageOutcome> =>
  createOfficialApiConnector({
    endpoint: ENDPOINT,
    serviceKey: SERVICE_KEY,
    fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }).fetchPage(INPUT);

const failureOf = async (fetch: FetchLike, timeoutMs?: number) => {
  const outcome = await fetchOutcome(fetch, timeoutMs);
  if (outcome.ok) throw new Error("실패를 기대했는데 성공했다");
  return outcome.failure;
};

const expectNoSecret = (text: string) => {
  for (const form of SECRET_FORMS) expect(text).not.toContain(form);
  expect(text).not.toContain("TESTKEY");
  expect(text).not.toMatch(/servicekey/i);
  expect(text).not.toContain("apis.data.go.kr");
};

// 콘솔 인자를 글자로 펼친다. Error 는 stack(이름·message)과 cause 까지, 객체는 JSON 으로.
const describeArg = (arg: unknown): string => {
  if (arg instanceof Error)
    return `${arg.stack ?? `${arg.name}: ${arg.message}`} ${describeArg(arg.cause)}`;
  if (typeof arg === "string") return arg;
  return JSON.stringify(arg) ?? String(arg);
};

const globalFetch = vi.fn(async () => {
  throw new Error("시험에서 실제 네트워크를 부르면 안 된다");
});

beforeEach(() => {
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalFetch.mockClear();
});

describe("OfficialApiConnector — fetch 가 던질 때", () => {
  it("TimeoutError 는 TIMEOUT 이다", async () => {
    const failure = await failureOf(async (url) => {
      throw new DOMException(`The operation timed out: ${url}`, "TimeoutError");
    });

    expect(failure.kind).toBe("TIMEOUT");
  });

  it("AbortError 는 TIMEOUT 이다", async () => {
    const failure = await failureOf(async (url) => {
      throw new DOMException(`This operation was aborted: ${url}`, "AbortError");
    });

    expect(failure.kind).toBe("TIMEOUT");
  });

  it("timeoutMs 가 지나 signal 이 끊기면 TIMEOUT 이다", async () => {
    // signal 이 끊길 때까지 응답하지 않는 서버. 5ms 뒤 AbortSignal.timeout 이 끊어야 끝난다.
    const hangUntilAborted: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });

    const failure = await failureOf(hangUntilAborted, 5);

    expect(failure.kind).toBe("TIMEOUT");
  });

  it("그 밖의 오류는 status 없는 HTTP_ERROR 다", async () => {
    const failure = await failureOf(async (url) => {
      throw new TypeError("fetch failed", { cause: new Error(`connect ECONNREFUSED ${url}`) });
    });

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", undefined]);
  });
});

describe("OfficialApiConnector — HTTP 상태", () => {
  it("429 는 status 429 인 RATE_LIMITED 다", async () => {
    const failure = await failureOf(async () => new Response("too many", { status: 429 }));

    expect([failure.kind, failure.status]).toEqual(["RATE_LIMITED", 429]);
  });

  it("429 의 Retry-After 정수 초를 retryAfterSec 로 담는다", async () => {
    const failure = await failureOf(
      async () => new Response("too many", { status: 429, headers: { "Retry-After": "3" } }),
    );

    expect(failure.retryAfterSec).toBe(3);
  });

  it("429 의 Retry-After 0 도 retryAfterSec 0 으로 담는다", async () => {
    const failure = await failureOf(
      async () => new Response("too many", { status: 429, headers: { "Retry-After": "0" } }),
    );

    expect(failure.retryAfterSec).toBe(0);
  });

  it("429 에 Retry-After 가 없으면 retryAfterSec 를 두지 않는다", async () => {
    const failure = await failureOf(async () => new Response("too many", { status: 429 }));

    expect(failure.retryAfterSec).toBeUndefined();
  });

  it.each(["Wed, 21 Oct 2026 07:28:00 GMT", "-1", "1.5", "abc", ""])(
    "429 의 Retry-After 가 0 이상 정수 초가 아니면(%j) retryAfterSec 를 두지 않는다",
    async (retryAfter) => {
      const failure = await failureOf(
        async () =>
          new Response("too many", { status: 429, headers: { "Retry-After": retryAfter } }),
      );

      expect([failure.kind, failure.retryAfterSec]).toEqual(["RATE_LIMITED", undefined]);
    },
  );

  it("500 은 status 500 인 HTTP_ERROR 다", async () => {
    const failure = await failureOf(async () => new Response("server error", { status: 500 }));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 500]);
  });

  it("429 가 아닌 4xx 는 status 를 담은 HTTP_ERROR 다", async () => {
    const failure = await failureOf(async () => new Response("forbidden", { status: 403 }));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 403]);
  });
});

describe("OfficialApiConnector — HTTP 200 본문", () => {
  it("오류 봉투 07 은 resultCode 07 인 RESULT_CODE 다", async () => {
    const failure = await failureOf(async () =>
      jsonResponse(errorEnvelope("07", "입력범위값 초과 에러")),
    );

    expect([failure.kind, failure.resultCode]).toEqual(["RESULT_CODE", "07"]);
  });

  it("오류 봉투 22 는 resultCode 22 인 QUOTA_EXCEEDED 다", async () => {
    const failure = await failureOf(async () =>
      jsonResponse(errorEnvelope("22", "서비스 요청제한횟수 초과에러")),
    );

    expect([failure.kind, failure.resultCode]).toEqual(["QUOTA_EXCEEDED", "22"]);
  });

  it("response 봉투의 resultCode 가 00 이 아니면 RESULT_CODE 다", async () => {
    const failure = await failureOf(async () =>
      jsonResponse({ response: { header: { resultCode: "03", resultMsg: "데이터 없음 에러" } } }),
    );

    expect([failure.kind, failure.resultCode]).toEqual(["RESULT_CODE", "03"]);
  });

  it("본문이 JSON 이 아니면 status 200 인 HTTP_ERROR 다", async () => {
    const failure = await failureOf(
      async () =>
        new Response("<OpenAPI_ServiceResponse><cmmMsgHeader /></OpenAPI_ServiceResponse>", {
          status: 200,
          headers: { "content-type": "text/xml" },
        }),
    );

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 200]);
  });

  it("JSON 이지만 봉투 모양이 아니면(MALFORMED) status 200 인 HTTP_ERROR 다", async () => {
    const failure = await failureOf(async () => jsonResponse({ unexpected: true }));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 200]);
  });
});

describe("OfficialApiConnector — 실패에 서비스키·URL 이 남지 않는다", () => {
  // 서버·런타임이 요청 URL(서비스키 포함)을 오류 message 나 본문에 되돌려 주는 경우를 흉내 낸다.
  const LEAKY_FAILURES: [string, FetchLike][] = [
    [
      "TimeoutError",
      async (url) => {
        throw new DOMException(`The operation timed out: ${url}`, "TimeoutError");
      },
    ],
    [
      "AbortError",
      async (url) => {
        throw new DOMException(`This operation was aborted: ${url}`, "AbortError");
      },
    ],
    [
      "네트워크 오류",
      async (url) => {
        throw new TypeError(`fetch failed ${url}`, { cause: new Error(`ECONNREFUSED ${url}`) });
      },
    ],
    [
      "429",
      async (url) =>
        new Response(`rate limited ${url}`, { status: 429, headers: { "Retry-After": "2" } }),
    ],
    ["500", async (url) => new Response(`<error>${url}</error>`, { status: 500 })],
    ["RESULT_CODE 07", async () => jsonResponse(errorEnvelope("07", "입력범위값 초과 에러"))],
    [
      "QUOTA_EXCEEDED 22",
      async () => jsonResponse(errorEnvelope("22", "서비스 요청제한횟수 초과에러")),
    ],
    [
      "비JSON 본문",
      async (url) => new Response(`<OpenAPI_ServiceResponse>${url}</OpenAPI_ServiceResponse>`),
    ],
    ["MALFORMED 본문", async (url) => jsonResponse({ echo: url })],
  ];

  it.each(LEAKY_FAILURES)("%s 실패의 결과에 서비스키·URL 이 없다", async (_label, fetch) => {
    const outcome = await fetchOutcome(fetch);

    expect(outcome.ok).toBe(false);
    expectNoSecret(JSON.stringify(outcome));
  });

  it.each(LEAKY_FAILURES)(
    "%s 실패를 콘솔에 서비스키·URL 과 함께 쓰지 않는다",
    async (_label, fetch) => {
      const methods = ["log", "info", "warn", "error", "debug"] as const;
      const spies = methods.map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );

      await fetchOutcome(fetch);

      for (const spy of spies) {
        expectNoSecret(spy.mock.calls.flat().map(describeArg).join("\n"));
      }
    },
  );

  it("실패를 던지지 않고 ok:false 로 돌려준다", async () => {
    await expect(
      fetchOutcome(async () => new Response("server error", { status: 500 })),
    ).resolves.toMatchObject({ ok: false });
  });

  it("실패 경로에서도 전역 fetch 를 부르지 않는다", async () => {
    await fetchOutcome(async () => new Response("server error", { status: 500 }));

    expect(globalFetch).not.toHaveBeenCalled();
  });
});
