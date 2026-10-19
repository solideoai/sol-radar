import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayClient, type GatewayClient } from "./gateway.client";
import type {
  ExtractRequest,
  GatewayConfig,
  GatewayRequestBody,
  GatewayResult,
} from "./gateway.model";

// 실제 네트워크는 부르지 않는다. fetch 와 시각(now)을 주입하고, 오류는 가짜 fetch 가 바로 던진다(기다리지 않는다).

// ── 가짜 fetch ──

type Reply = () => Promise<Response>;
type Call = { url: string; init: RequestInit | undefined };

const jsonReply =
  (status: number, body: unknown): Reply =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

const textReply =
  (status: number, text: string): Reply =>
  () =>
    Promise.resolve(new Response(text, { status, headers: { "content-type": "text/html" } }));

const rejectReply =
  (error: unknown): Reply =>
  () =>
    Promise.reject(error);

/** fetch 가 Promise 를 돌려주지 않고 그 자리에서 던진다. */
const throwSyncReply =
  (error: unknown): Reply =>
  () => {
    throw error;
  };

/** 헤더는 왔는데 본문을 읽는 중에 오류가 난다. */
const bodyErrorReply =
  (status: number, error: unknown): Reply =>
  () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        }),
        { status },
      ),
    );

/** 응답을 시험이 직접 풀어 주는 답. 요청이 나가 있는 동안을 만든다. */
function deferredReply() {
  let resolve: (response: Response) => void = () => {};
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  return { reply: (): Promise<Response> => pending, resolve };
}

/** 준비한 답을 차례로 쓰고, 다 쓰면 마지막 답을 되풀이한다. 받은 요청을 calls 에 남긴다. */
function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return replies[Math.min(calls.length - 1, replies.length - 1)]();
  };
  return { fetch, calls };
}

// ── 오류 ──

/** undici 의 연결 거부 모양. 메시지에 주소가 들어 있다. */
const refused = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:8000"), {
      code: "ECONNREFUSED",
    }),
  });

/** AbortSignal.timeout 이 끊었을 때의 오류 모양. */
const timedOut = () => Object.assign(new Error("x"), { name: "TimeoutError" });

// ── 설정·요청·정상 본문 ──

/** 엔드포인트마다 timeout 을 다르게 줘서 어느 값을 썼는지 구분한다. */
const config: GatewayConfig = {
  baseUrl: "http://gw.test:8000",
  extractTimeoutMs: 11_000,
  explainTimeoutMs: 12_000,
  kevTimeoutMs: 13_000,
  healthTimeoutMs: 14_000,
};

const extractRequest: ExtractRequest = {
  requestId: "req-extract-1",
  bidId: "bid-1",
  revisionId: "rev-1",
  fixtureId: "FX-07",
  meta: { stage: "NOTICE", agency: "가상 기관", budgetKrw: "1200000000", deadlineAt: null },
  body: "가상 공고 본문",
  attachments: [{ documentId: "doc-1", text: "첨부 본문", pages: [{ page: 1, charOffset: 0 }] }],
};

const kevRequest: GatewayRequestBody = {
  requestId: "req-kev-1",
  questionSetVersion: "kev-qs/v0.1",
  stateLanguage: "en",
};

const explainRequest: GatewayRequestBody = {
  requestId: "req-explain-1",
  qualificationChecks: [],
  kevSummary: null,
};

const healthBody = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: { model: "fixture", promptHash: "a".repeat(64) },
  kev: { modelId: "mock", registryMatch: null },
  questionSets: ["kev-qs/v0.1"],
  parsers: [
    { format: "PDF", parserId: null },
    { format: "HWPX", parserId: null },
    { format: "HWP", parserId: null },
  ],
};

const extractBody = {
  status: "COMPLETED",
  payload: { schemaVersion: "req-extraction/v0.1", fields: [] },
  translations: null,
  errorCode: null,
  injectionSuspected: false,
  warnings: [],
  timings: { extractMs: 12 },
};

const kevBody = {
  kev: { enabled: true, provider: "mock", model: "mock", disclaimer: "참고 지표" },
  stateHash: "b".repeat(64),
  requirements: null,
  wire: null,
  timings: { kevMs: 3 },
  errorCode: null,
};

const explainBody = {
  text: "규칙 판정 결과 입찰 권고입니다.",
  usedNumbers: ["94"],
  fallback: true,
};

type Endpoint = {
  name: string;
  method: "GET" | "POST";
  path: string;
  timeoutMs: number;
  body: unknown;
  call: (client: GatewayClient) => Promise<GatewayResult<unknown>>;
};

const endpoints: Endpoint[] = [
  {
    name: "health",
    method: "GET",
    path: "/health",
    timeoutMs: 14_000,
    body: healthBody,
    call: (client) => client.health(),
  },
  {
    name: "extract",
    method: "POST",
    path: "/extract",
    timeoutMs: 11_000,
    body: extractBody,
    call: (client) => client.extract(extractRequest),
  },
  {
    name: "kev",
    method: "POST",
    path: "/kev",
    timeoutMs: 13_000,
    body: kevBody,
    call: (client) => client.kev(kevRequest),
  },
  {
    name: "explain",
    method: "POST",
    path: "/explain",
    timeoutMs: 12_000,
    body: explainBody,
    call: (client) => client.explain(explainRequest),
  },
];

type PostEndpoint = Omit<Endpoint, "method" | "path" | "timeoutMs"> & {
  request: { requestId: string };
};

const postEndpoints: PostEndpoint[] = [
  {
    name: "extract",
    request: extractRequest,
    body: extractBody,
    call: (client) => client.extract(extractRequest),
  },
  { name: "kev", request: kevRequest, body: kevBody, call: (client) => client.kev(kevRequest) },
  {
    name: "explain",
    request: explainRequest,
    body: explainBody,
    call: (client) => client.explain(explainRequest),
  },
];

/** 키 하나를 뺀 사본. "필드가 없다"는 경우를 만든다. */
function omit(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createGatewayClient 요청 모양", () => {
  for (const endpoint of endpoints) {
    it(`${endpoint.name} 는 ${endpoint.method} {baseUrl}${endpoint.path} 로 보낸다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].url).toBe(`http://gw.test:8000${endpoint.path}`);
      expect((fake.calls[0].init?.method ?? "GET").toUpperCase()).toBe(endpoint.method);
    });

    it(`${endpoint.name} 는 fetch 에 AbortSignal 을 넘긴다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(fake.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    });

    it(`${endpoint.name} 는 그 엔드포인트의 timeout(${endpoint.timeoutMs}ms)으로 AbortSignal.timeout 을 건다`, async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(timeout).toHaveBeenCalledWith(endpoint.timeoutMs);
    });

    it(`${endpoint.name} 는 리다이렉트를 따라가지 않도록 redirect: error 를 준다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(fake.calls[0].init?.redirect).toBe("error");
    });
  }

  for (const endpoint of postEndpoints) {
    it(`${endpoint.name} 는 Content-Type: application/json 을 단다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(new Headers(fake.calls[0].init?.headers).get("content-type")).toBe("application/json");
    });

    it(`${endpoint.name} 는 X-Request-Id 에 requestId 를 단다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(new Headers(fake.calls[0].init?.headers).get("x-request-id")).toBe(
        endpoint.request.requestId,
      );
    });

    it(`${endpoint.name} 는 요청을 JSON 문자열 본문으로 보낸다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      const body = fake.calls[0].init?.body;
      expect(typeof body).toBe("string");
      expect(JSON.parse(String(body))).toEqual(endpoint.request);
    });
  }

  it("deps 를 주지 않으면 globalThis.fetch 를 쓴다", async () => {
    const fake = fakeFetch(jsonReply(200, healthBody));
    vi.stubGlobal("fetch", fake.fetch);
    await createGatewayClient(config).health();
    expect(fake.calls).toHaveLength(1);
  });
});

describe("createGatewayClient 정상 응답", () => {
  for (const endpoint of endpoints) {
    it(`${endpoint.name} 200 정상 응답은 검증한 본문과 attempts 1 을 돌려준다`, async () => {
      const fake = fakeFetch(jsonReply(200, endpoint.body));
      const result = await endpoint.call(createGatewayClient(config, { fetch: fake.fetch }));
      expect(result).toEqual({ ok: true, value: endpoint.body, attempts: 1 });
    });
  }

  it("현재 gateway 의 /health 본문(qwen·kev null)도 ok 로 받는다", async () => {
    const phase0 = { ...healthBody, qwen: null, kev: null, questionSets: [], parsers: [] };
    const fake = fakeFetch(jsonReply(200, phase0));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(result).toEqual({ ok: true, value: phase0, attempts: 1 });
  });

  it("KEV_ENABLED=false 의 /kev 본문(kev.enabled=false)도 ok 로 받는다", async () => {
    const disabled = {
      kev: {
        enabled: false,
        provider: null,
        model: null,
        suggestedOption: null,
        disclaimer: "참고",
      },
      stateHash: null,
      requirements: null,
      wire: null,
      timings: { kevMs: 0 },
      errorCode: null,
    };
    const fake = fakeFetch(jsonReply(200, disabled));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).kev(kevRequest);
    expect(result).toEqual({ ok: true, value: disabled, attempts: 1 });
  });
});

describe("createGatewayClient 실패와 재시도", () => {
  it("연결 거부는 재시도하지 않는다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(fake.calls).toHaveLength(1);
  });

  it("연결 거부는 UNREACHABLE 과 오류 코드, attempts 1 을 돌려준다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(result).toEqual({
      ok: false,
      failure: { kind: "UNREACHABLE", code: "ECONNREFUSED" },
      attempts: 1,
    });
  });

  it("timeout 은 한 번만 재시도하고 두 번째도 timeout 이면 TIMEOUT, attempts 2", async () => {
    const fake = fakeFetch(rejectReply(timedOut()));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(fake.calls).toHaveLength(2);
    expect(result).toEqual({ ok: false, failure: { kind: "TIMEOUT" }, attempts: 2 });
  });

  it("timeout 뒤 두 번째 시도가 성공하면 ok, attempts 2", async () => {
    const fake = fakeFetch(rejectReply(timedOut()), jsonReply(200, extractBody));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(result).toEqual({ ok: true, value: extractBody, attempts: 2 });
  });

  it("재시도는 첫 시도와 다른 새 signal 로 보낸다", async () => {
    const fake = fakeFetch(rejectReply(timedOut()), jsonReply(200, extractBody));
    await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(fake.calls[1].init?.signal).toBeInstanceOf(AbortSignal);
    expect(fake.calls[1].init?.signal).not.toBe(fake.calls[0].init?.signal);
  });

  it("재시도 요청에도 redirect: error 를 준다", async () => {
    const fake = fakeFetch(rejectReply(timedOut()), jsonReply(200, extractBody));
    await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(fake.calls[1].init?.redirect).toBe("error");
  });

  it("5xx 는 한 번만 재시도하고 두 번째도 5xx 면 HTTP_ERROR, attempts 2", async () => {
    const fake = fakeFetch(jsonReply(500, {}));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(fake.calls).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 500, errorCode: null },
      attempts: 2,
    });
  });

  it("5xx 뒤 두 번째 시도가 성공하면 ok, attempts 2", async () => {
    const fake = fakeFetch(jsonReply(502, {}), jsonReply(200, healthBody));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(result).toEqual({ ok: true, value: healthBody, attempts: 2 });
  });

  it("503 AI_UNAVAILABLE 이 두 번이면 HTTP_ERROR 503 과 그 코드, attempts 2", async () => {
    const fake = fakeFetch(
      jsonReply(503, { errorCode: "AI_UNAVAILABLE", message: "gateway down 주입" }),
    );
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" },
      attempts: 2,
    });
  });

  it("4xx 는 재시도하지 않는다", async () => {
    const fake = fakeFetch(jsonReply(422, { errorCode: "KO_STATE_NOT_ALLOWED", message: "x" }));
    await createGatewayClient(config, { fetch: fake.fetch }).kev(kevRequest);
    expect(fake.calls).toHaveLength(1);
  });

  it("422 KO_STATE_NOT_ALLOWED 는 HTTP_ERROR 422 와 그 코드, attempts 1", async () => {
    const fake = fakeFetch(
      jsonReply(422, {
        errorCode: "KO_STATE_NOT_ALLOWED",
        message: "stateLanguage=ko 는 허용되지 않습니다",
      }),
    );
    const result = await createGatewayClient(config, { fetch: fake.fetch }).kev(kevRequest);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 422, errorCode: "KO_STATE_NOT_ALLOWED" },
      attempts: 1,
    });
  });

  it("요청 형식 오류 422(FastAPI detail 배열)는 errorCode null 이고 재시도하지 않는다", async () => {
    const fake = fakeFetch(
      jsonReply(422, { detail: [{ loc: ["body"], msg: "x", type: "missing" }] }),
    );
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(fake.calls).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 422, errorCode: null },
      attempts: 1,
    });
  });

  it("JSON 이 아닌 오류 본문은 errorCode null", async () => {
    const fake = fakeFetch(textReply(404, "<html>Not Found</html>"));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 404, errorCode: null },
      attempts: 1,
    });
  });

  it("200 이 아닌 2xx(201)도 HTTP_ERROR 이고 재시도하지 않는다", async () => {
    const fake = fakeFetch(jsonReply(201, healthBody));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(result).toEqual({
      ok: false,
      failure: { kind: "HTTP_ERROR", httpStatus: 201, errorCode: null },
      attempts: 1,
    });
  });

  it("200 인데 JSON 이 아니면 INVALID_RESPONSE(invalid_json)이고 재시도하지 않는다", async () => {
    const fake = fakeFetch(textReply(200, "<html>proxy</html>"));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(fake.calls).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "INVALID_RESPONSE", issues: ["(root): invalid_json"] },
      attempts: 1,
    });
  });

  it("200 인데 스키마를 어기면 INVALID_RESPONSE 이고 재시도하지 않는다", async () => {
    const fake = fakeFetch(jsonReply(200, { ...extractBody, status: "DONE" }));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(fake.calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(!result.ok && result.failure.kind).toBe("INVALID_RESPONSE");
  });

  it("스키마 위반의 issues 는 '경로: 코드' 로 적는다", async () => {
    const fake = fakeFetch(jsonReply(200, { ...extractBody, status: "DONE" }));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    const issues =
      !result.ok && result.failure.kind === "INVALID_RESPONSE" ? result.failure.issues : [];
    expect(issues).toContain("status: invalid_value");
  });

  it("/kev 200 본문에 errorCode 필드가 없으면 INVALID_RESPONSE", async () => {
    const fake = fakeFetch(jsonReply(200, omit(kevBody, "errorCode")));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).kev(kevRequest);
    expect(!result.ok && result.failure.kind).toBe("INVALID_RESPONSE");
  });

  it("본문을 읽는 중의 timeout 도 TIMEOUT 으로 분류하고 한 번 재시도한다", async () => {
    const fake = fakeFetch(bodyErrorReply(200, timedOut()));
    const result = await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest);
    expect(result).toEqual({ ok: false, failure: { kind: "TIMEOUT" }, attempts: 2 });
  });

  it("fetch 가 동기로 던져도 던지지 않고 분류해 돌려준다", async () => {
    const fake = fakeFetch(throwSyncReply(refused()));
    await expect(createGatewayClient(config, { fetch: fake.fetch }).health()).resolves.toEqual({
      ok: false,
      failure: { kind: "UNREACHABLE", code: "ECONNREFUSED" },
      attempts: 1,
    });
  });

  it("fetch 가 Error 가 아닌 값으로 거부해도 던지지 않는다", async () => {
    const fake = fakeFetch(rejectReply("boom"));
    await expect(createGatewayClient(config, { fetch: fake.fetch }).health()).resolves.toEqual({
      ok: false,
      failure: { kind: "UNREACHABLE", code: null },
      attempts: 1,
    });
  });

  it("리다이렉트 거부 오류는 UNREACHABLE 이고 재시도하지 않는다", async () => {
    const fake = fakeFetch(
      rejectReply(new TypeError("fetch failed", { cause: new Error("unexpected redirect") })),
    );
    const result = await createGatewayClient(config, { fetch: fake.fetch }).health();
    expect(fake.calls).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "UNREACHABLE", code: null },
      attempts: 1,
    });
  });
});

describe("createGatewayClient 결과에 싣지 않는 것", () => {
  it("연결 오류 결과에 오류 메시지와 주소를 싣지 않는다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const serialized = JSON.stringify(
      await createGatewayClient(config, { fetch: fake.fetch }).health(),
    );
    expect(serialized).not.toContain("10.0.0.5");
    expect(serialized).not.toContain("gw.test");
    expect(serialized).not.toContain("fetch failed");
  });

  it("HTTP 오류 결과에 본문 message 를 싣지 않는다", async () => {
    const fake = fakeFetch(
      jsonReply(422, { errorCode: "KO_STATE_NOT_ALLOWED", message: "SECRET-MESSAGE" }),
    );
    const serialized = JSON.stringify(
      await createGatewayClient(config, { fetch: fake.fetch }).kev(kevRequest),
    );
    expect(serialized).not.toContain("SECRET-MESSAGE");
  });

  it("스키마 위반 결과에 응답 값을 싣지 않는다", async () => {
    const fake = fakeFetch(jsonReply(200, { ...extractBody, warnings: "공고원문-SECRET-TEXT" }));
    const serialized = JSON.stringify(
      await createGatewayClient(config, { fetch: fake.fetch }).extract(extractRequest),
    );
    expect(serialized).not.toContain("SECRET-TEXT");
  });
});

describe("createGatewayClient circuit breaker", () => {
  /** 실패 호출 n 번을 차례로 보낸다. */
  async function failTimes(client: GatewayClient, times: number) {
    for (let index = 0; index < times; index += 1) {
      await client.health();
    }
  }

  it("처음 breaker 는 실패 0회인 CLOSED", () => {
    const client = createGatewayClient(config, {
      fetch: fakeFetch(jsonReply(200, healthBody)).fetch,
    });
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("실패 호출 2번 뒤에는 아직 닫혀 있어 세 번째 요청을 보낸다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    expect(fake.calls).toHaveLength(3);
  });

  it("실패 호출 3번이면 그 시각으로 OPEN 한다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    expect(client.breakerState()).toEqual({ kind: "OPEN", openedAt: 1_000 });
  });

  it("실패 호출 3번 뒤 4번째는 fetch 를 부르지 않고 CIRCUIT_OPEN, attempts 0", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    const result = await client.health();
    expect(fake.calls).toHaveLength(3);
    expect(result).toEqual({ ok: false, failure: { kind: "CIRCUIT_OPEN" }, attempts: 0 });
  });

  it("열린 뒤 15초가 지나기 전에는 요청을 보내지 않는다", async () => {
    let now = 1_000;
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 1_000 + 14_999;
    const result = await client.health();
    expect(fake.calls).toHaveLength(3);
    expect(!result.ok && result.failure.kind).toBe("CIRCUIT_OPEN");
  });

  it("열린 뒤 15초가 지나면 시험 요청 1건을 보낸다", async () => {
    let now = 1_000;
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      rejectReply(refused()),
      jsonReply(200, healthBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 1_000 + 15_000;
    const result = await client.health();
    expect(fake.calls).toHaveLength(4);
    expect(result).toEqual({ ok: true, value: healthBody, attempts: 1 });
  });

  it("시험 요청이 성공하면 실패 0회인 CLOSED 로 닫힌다", async () => {
    let now = 1_000;
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      rejectReply(refused()),
      jsonReply(200, healthBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 16_000;
    await client.health();
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("시험 요청이 실패하면 그 시각으로 다시 연다", async () => {
    let now = 1_000;
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 16_000;
    await client.health();
    expect(client.breakerState()).toEqual({ kind: "OPEN", openedAt: 16_000 });
  });

  it("시험 요청이 실패한 뒤의 다음 호출은 보내지 않는다", async () => {
    let now = 1_000;
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 16_000;
    await client.health();
    const result = await client.health();
    expect(fake.calls).toHaveLength(4);
    expect(!result.ok && result.failure.kind).toBe("CIRCUIT_OPEN");
  });

  it("시험 요청이 나가 있는 동안 다른 요청은 보내지 않고 CIRCUIT_OPEN", async () => {
    let now = 1_000;
    const trialReply = deferredReply();
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      rejectReply(refused()),
      trialReply.reply,
      // 동시 요청이 잘못 나가면 여기서 바로 답해 시험이 멈추지 않고 실패하게 한다.
      jsonReply(200, extractBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 16_000;
    const trial = client.health();
    await vi.waitFor(() => expect(fake.calls).toHaveLength(4));
    const concurrent = await client.extract(extractRequest);
    expect(fake.calls).toHaveLength(4);
    expect(concurrent).toEqual({ ok: false, failure: { kind: "CIRCUIT_OPEN" }, attempts: 0 });
    trialReply.resolve(
      new Response(JSON.stringify(healthBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await trial;
  });

  it("거부된 호출은 열린 시각을 미루지 않는다", async () => {
    let now = 1_000;
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      rejectReply(refused()),
      jsonReply(200, healthBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => now });
    await failTimes(client, 3);
    now = 5_000;
    await client.health();
    now = 16_000;
    const result = await client.health();
    expect(result.ok).toBe(true);
  });

  it("네 엔드포인트가 breaker 하나를 함께 쓴다", async () => {
    const fake = fakeFetch(rejectReply(refused()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await client.health();
    await client.extract(extractRequest);
    await client.kev(kevRequest);
    const result = await client.explain(explainRequest);
    expect(fake.calls).toHaveLength(3);
    expect(result).toEqual({ ok: false, failure: { kind: "CIRCUIT_OPEN" }, attempts: 0 });
  });

  it("클라이언트 인스턴스마다 breaker 가 따로다", async () => {
    const broken = createGatewayClient(config, {
      fetch: fakeFetch(rejectReply(refused())).fetch,
      now: () => 1_000,
    });
    await failTimes(broken, 3);
    const healthy = fakeFetch(jsonReply(200, healthBody));
    const other = createGatewayClient(config, { fetch: healthy.fetch, now: () => 1_000 });
    const result = await other.health();
    expect(healthy.calls).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("4xx 는 세 번 이어져도 breaker 를 열지 않는다", async () => {
    const fake = fakeFetch(jsonReply(422, { errorCode: "KO_STATE_NOT_ALLOWED", message: "x" }));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    for (let index = 0; index < 3; index += 1) await client.kev(kevRequest);
    const result = await client.kev(kevRequest);
    expect(fake.calls).toHaveLength(4);
    expect(!result.ok && result.failure.kind).toBe("HTTP_ERROR");
  });

  it("INVALID_RESPONSE 는 세 번 이어져도 breaker 를 열지 않는다", async () => {
    const fake = fakeFetch(textReply(200, "<html>proxy</html>"));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    const result = await client.health();
    expect(fake.calls).toHaveLength(4);
    expect(!result.ok && result.failure.kind).toBe("INVALID_RESPONSE");
  });

  it("4xx 응답은 연속 실패 수를 0 으로 되돌린다", async () => {
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      jsonReply(422, { errorCode: "KO_STATE_NOT_ALLOWED", message: "x" }),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await client.kev(kevRequest);
    await client.kev(kevRequest);
    await client.kev(kevRequest);
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("성공 응답은 연속 실패 수를 0 으로 되돌린다", async () => {
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      jsonReply(200, healthBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 0 });
  });

  it("timeout 재시도를 포함한 실패 호출 하나는 실패 1회로 센다", async () => {
    const fake = fakeFetch(rejectReply(timedOut()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await client.health();
    expect(fake.calls).toHaveLength(2);
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 1 });
  });

  it("5xx 재시도를 포함한 실패 호출 하나는 실패 1회로 센다", async () => {
    const fake = fakeFetch(jsonReply(503, { errorCode: "AI_UNAVAILABLE", message: "x" }));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await client.health();
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 1 });
  });

  it("재시도까지 실패한 호출 3번(시도 6번)이면 열려 4번째는 보내지 않는다", async () => {
    const fake = fakeFetch(rejectReply(timedOut()));
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    const result = await client.health();
    expect(fake.calls).toHaveLength(6);
    expect(!result.ok && result.failure.kind).toBe("CIRCUIT_OPEN");
  });

  it("재시도 끝에 성공한 호출은 실패로 세지 않는다", async () => {
    const fake = fakeFetch(
      rejectReply(refused()),
      rejectReply(refused()),
      rejectReply(timedOut()),
      jsonReply(200, healthBody),
    );
    const client = createGatewayClient(config, { fetch: fake.fetch, now: () => 1_000 });
    await failTimes(client, 3);
    expect(client.breakerState()).toEqual({ kind: "CLOSED", failures: 0 });
  });
});
