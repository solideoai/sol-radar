import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  classifyFetchError,
  explainResponseSchema,
  extractRequestSchema,
  extractResponseSchema,
  healthResponseSchema,
  isAvailabilityFailure,
  isRetryable,
  kevResponseSchema,
  readErrorCode,
  readGatewayConfig,
  toIssueList,
  type GatewayFailure,
} from "./gateway.model";

// ── 시험 도우미 ──

/** 함수가 던진 오류의 메시지. 던지지 않으면 시험을 실패시킨다. */
function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("예외가 나지 않았다");
}

/** 키 하나를 뺀 사본. "필드가 없다"는 경우를 만든다. */
function omit(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

/** safeParse 결과의 issue 경로 목록. 성공이면 빈 목록. */
function issuePaths(result: { error?: { issues: { path: PropertyKey[] }[] } }): PropertyKey[][] {
  return result.error?.issues.map((issue) => issue.path) ?? [];
}

// ── 정상 본문(03 §2.1 계약, 3b 가 통보한 mock 응답) ──

const completedExtract = {
  status: "COMPLETED",
  payload: { schemaVersion: "req-extraction/v0.1", fields: [] },
  translations: { "licenses[0]": "Information and communication construction" },
  errorCode: null,
  injectionSuspected: false,
  warnings: [],
  timings: { extractMs: 12 },
};

const enabledKev = {
  kev: { enabled: true, provider: "mock", model: "mock", questionSetVersion: "kev-qs/v0.1" },
  stateHash: "b".repeat(64),
  requirements: [
    {
      itemId: "REQ-01",
      qid: "Q1",
      distribution: { SATISFIED: 0.7, NOT_SATISFIED: 0.2, NEEDS_REVIEW: 0.1 },
      label: "SATISFIED",
    },
  ],
  wire: [{ id: "wire-1" }],
  timings: { kevMs: 3 },
  errorCode: null,
};

/** 3b 통보: KEV_ENABLED=false 인 mock /kev 본문. */
const disabledKev = {
  kev: {
    enabled: false,
    provider: null,
    model: null,
    suggestedOption: null,
    disclaimer: "Kev 는 참고 지표이며 판정을 바꾸지 않습니다.",
  },
  stateHash: null,
  requirements: null,
  wire: null,
  timings: { kevMs: 0 },
  errorCode: null,
};

/** 현재 gateway(services/ai/src/sol_ai/app.py)의 /health 본문. */
const phase0Health = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: null,
  kev: null,
  questionSets: [],
  parsers: [],
};

/** 3b 통보: mock /health 본문(KEV_ENABLED=true). */
const mockHealth = {
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

const validExtractRequest = {
  requestId: "req-1",
  bidId: "bid-1",
  revisionId: "rev-1",
  fixtureId: "FX-07",
  meta: { stage: "NOTICE", agency: "가상 기관", budgetKrw: "1200000000", deadlineAt: null },
  body: "가상 공고 본문",
  attachments: [{ documentId: "doc-1", text: "첨부 본문", pages: [{ page: 1, charOffset: 0 }] }],
};

describe("readGatewayConfig", () => {
  it("값이 없으면 정본 기본값을 쓴다(AI 60초+5초, Kev 5초+2초, health 5초)", () => {
    expect(readGatewayConfig({})).toEqual({
      baseUrl: "http://ai-gateway:8000",
      extractTimeoutMs: 65_000,
      explainTimeoutMs: 65_000,
      kevTimeoutMs: 7_000,
      healthTimeoutMs: 5_000,
    });
  });

  it("빈 값과 공백만 있는 값은 없는 것으로 보고 기본값을 쓴다", () => {
    expect(
      readGatewayConfig({ AI_GATEWAY_URL: "   ", AI_TIMEOUT_MS: "", KEV_TIMEOUT_MS: " " }),
    ).toEqual(readGatewayConfig({}));
  });

  it("AI_GATEWAY_URL 끝의 슬래시를 뗀다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "http://gw.internal:9000/" }).baseUrl).toBe(
      "http://gw.internal:9000",
    );
  });

  it("끝에 슬래시가 없는 AI_GATEWAY_URL 은 그대로 쓴다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "http://gw.internal:9000" }).baseUrl).toBe(
      "http://gw.internal:9000",
    );
  });

  it("https 주소도 받는다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "https://gw.example.test" }).baseUrl).toBe(
      "https://gw.example.test",
    );
  });

  it("/extract timeout 은 AI_TIMEOUT_MS 에 5초를 더한다", () => {
    expect(readGatewayConfig({ AI_TIMEOUT_MS: "30000" }).extractTimeoutMs).toBe(35_000);
  });

  it("/explain timeout 은 AI_TIMEOUT_MS 에 5초를 더한다", () => {
    expect(readGatewayConfig({ AI_TIMEOUT_MS: "30000" }).explainTimeoutMs).toBe(35_000);
  });

  it("/kev timeout 은 KEV_TIMEOUT_MS 에 2초를 더한다", () => {
    expect(readGatewayConfig({ KEV_TIMEOUT_MS: "1000" }).kevTimeoutMs).toBe(3_000);
  });

  it("/health timeout 은 AI_TIMEOUT_MS·KEV_TIMEOUT_MS 와 상관없이 5초다", () => {
    expect(
      readGatewayConfig({ AI_TIMEOUT_MS: "30000", KEV_TIMEOUT_MS: "1000" }).healthTimeoutMs,
    ).toBe(5_000);
  });

  it.each(["ftp://gw.internal:21", "not a url", "ai-gateway:8000", "javascript:alert(1)"])(
    "http·https 가 아닌 AI_GATEWAY_URL(%s)은 키 이름만 담은 오류를 던진다",
    (value) => {
      expect(thrownMessage(() => readGatewayConfig({ AI_GATEWAY_URL: value }))).toBe(
        "AI gateway 설정 오류: AI_GATEWAY_URL",
      );
    },
  );

  it("잘못된 AI_GATEWAY_URL 의 값은 오류 메시지에 싣지 않는다", () => {
    const message = thrownMessage(() =>
      readGatewayConfig({ AI_GATEWAY_URL: "ftp://secret-host.internal:21" }),
    );
    expect(message).not.toContain("secret-host");
  });

  it.each(["0", "-1", "1.5", "abc", "1e3", "0x10"])(
    "양의 10진 정수가 아닌 AI_TIMEOUT_MS(%s)는 키 이름만 담은 오류를 던진다",
    (value) => {
      expect(thrownMessage(() => readGatewayConfig({ AI_TIMEOUT_MS: value }))).toBe(
        "AI gateway 설정 오류: AI_TIMEOUT_MS",
      );
    },
  );

  it.each(["0", "-1", "1.5", "abc", "1e3", "0x10"])(
    "양의 10진 정수가 아닌 KEV_TIMEOUT_MS(%s)는 키 이름만 담은 오류를 던진다",
    (value) => {
      expect(thrownMessage(() => readGatewayConfig({ KEV_TIMEOUT_MS: value }))).toBe(
        "AI gateway 설정 오류: KEV_TIMEOUT_MS",
      );
    },
  );

  // ── readGatewayConfig 경계 ──

  it("AI_TIMEOUT_MS 의 앞뒤 공백은 지우고 읽는다", () => {
    expect(readGatewayConfig({ AI_TIMEOUT_MS: " 60000 " }).extractTimeoutMs).toBe(65_000);
  });

  it("KEV_TIMEOUT_MS 의 앞뒤 공백은 지우고 읽는다", () => {
    expect(readGatewayConfig({ KEV_TIMEOUT_MS: " 3000 " }).kevTimeoutMs).toBe(5_000);
  });

  it("AI_GATEWAY_URL 의 앞뒤 공백은 지우고 읽는다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "  http://gw.internal:9000  " }).baseUrl).toBe(
      "http://gw.internal:9000",
    );
  });

  it("AI_GATEWAY_URL 끝의 슬래시는 몇 개든 모두 뗀다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "http://gw.internal:9000///" }).baseUrl).toBe(
      "http://gw.internal:9000",
    );
  });

  it("경로가 붙은 AI_GATEWAY_URL 을 받는다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "http://gw.internal:8000/ai" }).baseUrl).toBe(
      "http://gw.internal:8000/ai",
    );
  });

  it("경로가 붙은 AI_GATEWAY_URL 도 끝 슬래시를 뗀다", () => {
    expect(readGatewayConfig({ AI_GATEWAY_URL: "http://gw.internal:8000/ai//" }).baseUrl).toBe(
      "http://gw.internal:8000/ai",
    );
  });

  it.each([
    ["사용자와 비밀번호", "http://admin:s3cret@gw.internal:8000"],
    ["사용자만", "http://admin@gw.internal:8000"],
    ["비밀번호만", "https://:s3cret@gw.internal:8000"],
  ])("계정 정보(%s)가 든 AI_GATEWAY_URL 은 키 이름만 담은 오류를 던진다", (_label, value) => {
    expect(thrownMessage(() => readGatewayConfig({ AI_GATEWAY_URL: value }))).toBe(
      "AI gateway 설정 오류: AI_GATEWAY_URL",
    );
  });

  it("계정 정보 URL 의 비밀번호는 오류 메시지에 싣지 않는다", () => {
    const message = thrownMessage(() =>
      readGatewayConfig({ AI_GATEWAY_URL: "http://admin:s3cret@gw.internal:8000" }),
    );
    expect(message).not.toContain("s3cret");
  });

  it("앞자리 0 이 붙은 AI_TIMEOUT_MS(007)는 7 로 읽는다", () => {
    expect(readGatewayConfig({ AI_TIMEOUT_MS: "007" }).extractTimeoutMs).toBe(5_007);
  });

  it("앞자리 0 이 붙은 KEV_TIMEOUT_MS(007)는 7 로 읽는다", () => {
    expect(readGatewayConfig({ KEV_TIMEOUT_MS: "007" }).kevTimeoutMs).toBe(2_007);
  });

  it("AI_TIMEOUT_MS 상한 3600000(1시간)은 받는다", () => {
    expect(readGatewayConfig({ AI_TIMEOUT_MS: "3600000" }).extractTimeoutMs).toBe(3_605_000);
  });

  it("KEV_TIMEOUT_MS 상한 3600000(1시간)은 받는다", () => {
    expect(readGatewayConfig({ KEV_TIMEOUT_MS: "3600000" }).kevTimeoutMs).toBe(3_602_000);
  });

  it.each(["3600001", "99999999999999999999"])(
    "상한을 넘는 AI_TIMEOUT_MS(%s)는 키 이름만 담은 오류를 던진다",
    (value) => {
      expect(thrownMessage(() => readGatewayConfig({ AI_TIMEOUT_MS: value }))).toBe(
        "AI gateway 설정 오류: AI_TIMEOUT_MS",
      );
    },
  );

  it.each(["3600001", "99999999999999999999"])(
    "상한을 넘는 KEV_TIMEOUT_MS(%s)는 키 이름만 담은 오류를 던진다",
    (value) => {
      expect(thrownMessage(() => readGatewayConfig({ KEV_TIMEOUT_MS: value }))).toBe(
        "AI gateway 설정 오류: KEV_TIMEOUT_MS",
      );
    },
  );

  it("숫자 키 두 개가 틀리면 둘 다 정해진 순서로 ', ' 로 이어 보고한다", () => {
    expect(
      thrownMessage(() => readGatewayConfig({ KEV_TIMEOUT_MS: "abc", AI_TIMEOUT_MS: "0" })),
    ).toBe("AI gateway 설정 오류: AI_TIMEOUT_MS, KEV_TIMEOUT_MS");
  });

  it("세 키가 모두 틀리면 AI_GATEWAY_URL, AI_TIMEOUT_MS, KEV_TIMEOUT_MS 순으로 보고한다", () => {
    expect(
      thrownMessage(() =>
        readGatewayConfig({
          KEV_TIMEOUT_MS: "1.5",
          AI_TIMEOUT_MS: "-1",
          AI_GATEWAY_URL: "ftp://gw.internal:21",
        }),
      ),
    ).toBe("AI gateway 설정 오류: AI_GATEWAY_URL, AI_TIMEOUT_MS, KEV_TIMEOUT_MS");
  });

  it("URL 과 KEV_TIMEOUT_MS 가 틀리면 틀린 둘만 보고한다", () => {
    expect(
      thrownMessage(() =>
        readGatewayConfig({
          AI_GATEWAY_URL: "not a url",
          AI_TIMEOUT_MS: "60000",
          KEV_TIMEOUT_MS: "0",
        }),
      ),
    ).toBe("AI gateway 설정 오류: AI_GATEWAY_URL, KEV_TIMEOUT_MS");
  });

  it("여러 키가 틀려도 값은 오류 메시지에 싣지 않는다", () => {
    const message = thrownMessage(() =>
      readGatewayConfig({
        AI_GATEWAY_URL: "http://admin:s3cret@gw.internal:8000",
        AI_TIMEOUT_MS: "1e3",
        KEV_TIMEOUT_MS: "3600001",
      }),
    );
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("1e3");
    expect(message).not.toContain("3600001");
  });
});

describe("extractResponseSchema", () => {
  it("COMPLETED 정상 본문을 통과시킨다", () => {
    expect(extractResponseSchema.safeParse(completedExtract).success).toBe(true);
  });

  it("PENDING_REVIEW 본문을 통과시킨다", () => {
    const body = { ...completedExtract, status: "PENDING_REVIEW", warnings: ["CITATION_MISMATCH"] };
    expect(extractResponseSchema.safeParse(body).success).toBe(true);
  });

  it("FAILED 이고 payload 가 null 이며 errorCode 가 있으면 통과시킨다", () => {
    const body = {
      ...completedExtract,
      status: "FAILED",
      payload: null,
      errorCode: "QWEN_UNAVAILABLE",
    };
    expect(extractResponseSchema.safeParse(body).success).toBe(true);
  });

  it("FAILED 인데 errorCode 가 null 이어도 통과시킨다", () => {
    const body = { ...completedExtract, status: "FAILED", payload: null, errorCode: null };
    expect(extractResponseSchema.safeParse(body).success).toBe(true);
  });

  it("translations 가 null 이어도 통과시킨다", () => {
    expect(
      extractResponseSchema.safeParse({ ...completedExtract, translations: null }).success,
    ).toBe(true);
  });

  it("FAILED 인데 payload 가 있으면 payload 경로로 거부한다", () => {
    const body = { ...completedExtract, status: "FAILED", errorCode: "EXTRACTION_FAILED" };
    expect(issuePaths(extractResponseSchema.safeParse(body))).toContainEqual(["payload"]);
  });

  it("COMPLETED 인데 payload 가 null 이면 payload 경로로 거부한다", () => {
    const body = { ...completedExtract, payload: null };
    expect(issuePaths(extractResponseSchema.safeParse(body))).toContainEqual(["payload"]);
  });

  it("COMPLETED 인데 payload 가 없으면 payload 경로로 거부한다", () => {
    const body = omit(completedExtract, "payload");
    expect(issuePaths(extractResponseSchema.safeParse(body))).toContainEqual(["payload"]);
  });

  it("FAILED 가 아닌데 errorCode 가 있으면 errorCode 경로로 거부한다", () => {
    const body = { ...completedExtract, errorCode: "EXTRACTION_FAILED" };
    expect(issuePaths(extractResponseSchema.safeParse(body))).toContainEqual(["errorCode"]);
  });

  it("모르는 status 는 거부한다", () => {
    expect(extractResponseSchema.safeParse({ ...completedExtract, status: "DONE" }).success).toBe(
      false,
    );
  });

  it("모르는 errorCode 는 거부한다", () => {
    const body = { ...completedExtract, status: "FAILED", payload: null, errorCode: "BOOM" };
    expect(extractResponseSchema.safeParse(body).success).toBe(false);
  });

  it("음수 extractMs 는 거부한다", () => {
    const body = { ...completedExtract, timings: { extractMs: -1 } };
    expect(extractResponseSchema.safeParse(body).success).toBe(false);
  });

  it("모르는 필드가 있어도 거부하지 않는다", () => {
    const body = { ...completedExtract, model: "Qwen/Qwen3.5-9B", promptHash: "c".repeat(64) };
    expect(extractResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("kevResponseSchema", () => {
  it("kev.enabled=true 정상 본문을 통과시킨다", () => {
    expect(kevResponseSchema.safeParse(enabledKev).success).toBe(true);
  });

  it("KEV_ENABLED=false mock 본문(errorCode null)을 통과시킨다", () => {
    expect(kevResponseSchema.safeParse(disabledKev).success).toBe(true);
  });

  it("Kev 장애 mock 본문(errorCode KEV_UNAVAILABLE)을 통과시킨다", () => {
    const body = { ...disabledKev, errorCode: "KEV_UNAVAILABLE" };
    expect(kevResponseSchema.safeParse(body).success).toBe(true);
  });

  it("인젝션 의심으로 Kev 를 부르지 않은 본문(errorCode INJECTION_SUSPECTED)을 통과시킨다", () => {
    const body = { ...disabledKev, errorCode: "INJECTION_SUSPECTED" };
    expect(kevResponseSchema.safeParse(body).success).toBe(true);
  });

  it("errorCode 필드가 없으면 거부한다", () => {
    expect(kevResponseSchema.safeParse(omit(disabledKev, "errorCode")).success).toBe(false);
  });

  it("모르는 errorCode 는 거부한다", () => {
    expect(kevResponseSchema.safeParse({ ...disabledKev, errorCode: "KEV_DOWN" }).success).toBe(
      false,
    );
  });

  it("kev.enabled 가 없으면 거부한다", () => {
    const body = { ...enabledKev, kev: { provider: "mock" } };
    expect(kevResponseSchema.safeParse(body).success).toBe(false);
  });

  it("모르는 label 은 거부한다", () => {
    const body = {
      ...enabledKev,
      requirements: [{ ...enabledKev.requirements[0], label: "MAYBE" }],
    };
    expect(kevResponseSchema.safeParse(body).success).toBe(false);
  });

  it("kev 안쪽의 나머지 필드를 버리지 않고 보존한다", () => {
    const result = kevResponseSchema.safeParse(disabledKev);
    expect(result.data?.kev).toEqual(disabledKev.kev);
  });

  it("최상위의 모르는 필드가 있어도 거부하지 않는다", () => {
    expect(kevResponseSchema.safeParse({ ...enabledKev, stateTrace: [] }).success).toBe(true);
  });
});

describe("explainResponseSchema", () => {
  it("fallback=true mock 본문을 통과시킨다", () => {
    const body = { text: "규칙 판정 결과 입찰 권고입니다.", usedNumbers: ["94"], fallback: true };
    expect(explainResponseSchema.safeParse(body).success).toBe(true);
  });

  it("fallback 이 없으면 거부한다", () => {
    expect(explainResponseSchema.safeParse({ text: "설명", usedNumbers: [] }).success).toBe(false);
  });

  it("모르는 필드가 있어도 거부하지 않는다", () => {
    const body = { text: "설명", usedNumbers: [], fallback: false, model: "qwen" };
    expect(explainResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("healthResponseSchema", () => {
  it("현재 gateway 의 /health 본문(qwen·kev null, 빈 목록)을 통과시킨다", () => {
    expect(healthResponseSchema.safeParse(phase0Health).success).toBe(true);
  });

  it("mock /health 본문(registryMatch null, 파서 3종)을 통과시킨다", () => {
    expect(healthResponseSchema.safeParse(mockHealth).success).toBe(true);
  });

  it("KEV_ENABLED=false mock /health 본문(kev null)을 통과시킨다", () => {
    const body = { ...mockHealth, kevEnabled: false, kev: null };
    expect(healthResponseSchema.safeParse(body).success).toBe(true);
  });

  it("registryMatch 가 true 인 본문을 통과시킨다", () => {
    const body = { ...mockHealth, kev: { modelId: "kev-9b-v1.0", registryMatch: true } };
    expect(healthResponseSchema.safeParse(body).success).toBe(true);
  });

  it("status 가 ok 가 아니면 거부한다", () => {
    expect(healthResponseSchema.safeParse({ ...phase0Health, status: "degraded" }).success).toBe(
      false,
    );
  });

  it("모르는 provider 는 거부한다", () => {
    expect(healthResponseSchema.safeParse({ ...phase0Health, provider: "weird" }).success).toBe(
      false,
    );
  });

  it("모르는 runMode 는 거부한다", () => {
    expect(healthResponseSchema.safeParse({ ...phase0Health, runMode: "demo" }).success).toBe(
      false,
    );
  });

  it("모르는 필드가 있어도 거부하지 않는다", () => {
    expect(healthResponseSchema.safeParse({ ...mockHealth, uptimeSec: 12 }).success).toBe(true);
  });
});

describe("extractRequestSchema", () => {
  it("정상 요청을 통과시킨다", () => {
    expect(extractRequestSchema.safeParse(validExtractRequest).success).toBe(true);
  });

  it("fixtureId 가 없어도 통과시킨다", () => {
    const request = omit(validExtractRequest, "fixtureId");
    expect(extractRequestSchema.safeParse(request).success).toBe(true);
  });

  it("revision 이 붙은 fixtureId(FX-07.r01)를 통과시킨다", () => {
    const request = { ...validExtractRequest, fixtureId: "FX-07.r01" };
    expect(extractRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each(["FX-7", "fx-07", "FX-07.r1", "FX-007", "FX-07.r01x"])(
    "형식이 틀린 fixtureId(%s)는 거부한다",
    (fixtureId) => {
      const request = { ...validExtractRequest, fixtureId };
      expect(extractRequestSchema.safeParse(request).success).toBe(false);
    },
  );

  it("빈 requestId 는 거부한다", () => {
    const request = { ...validExtractRequest, requestId: "" };
    expect(extractRequestSchema.safeParse(request).success).toBe(false);
  });

  it("0쪽은 거부한다", () => {
    const request = {
      ...validExtractRequest,
      attachments: [{ documentId: "doc-1", text: "본문", pages: [{ page: 0, charOffset: 0 }] }],
    };
    expect(extractRequestSchema.safeParse(request).success).toBe(false);
  });

  it("음수 charOffset 은 거부한다", () => {
    const request = {
      ...validExtractRequest,
      attachments: [{ documentId: "doc-1", text: "본문", pages: [{ page: 1, charOffset: -1 }] }],
    };
    expect(extractRequestSchema.safeParse(request).success).toBe(false);
  });

  it("모르는 stage 는 거부한다", () => {
    const request = {
      ...validExtractRequest,
      meta: { ...validExtractRequest.meta, stage: "AWARD" },
    };
    expect(extractRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe("classifyFetchError", () => {
  it("AbortSignal.timeout 의 TimeoutError 는 TIMEOUT", () => {
    expect(classifyFetchError(new DOMException("timed out", "TimeoutError"))).toEqual({
      kind: "TIMEOUT",
    });
  });

  it("name 이 TimeoutError 인 Error 는 TIMEOUT", () => {
    expect(classifyFetchError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toEqual({
      kind: "TIMEOUT",
    });
  });

  it("AbortError 는 TIMEOUT", () => {
    expect(classifyFetchError(new DOMException("aborted", "AbortError"))).toEqual({
      kind: "TIMEOUT",
    });
  });

  it.each(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])(
    "undici 의 %s 는 TIMEOUT",
    (code) => {
      expect(classifyFetchError(new TypeError("fetch failed", { cause: { code } }))).toEqual({
        kind: "TIMEOUT",
      });
    },
  );

  it("연결 거부(cause.code ECONNREFUSED)는 UNREACHABLE 과 그 코드", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:8000"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: "ECONNREFUSED" });
  });

  it("오류 자체의 code(ENOTFOUND)도 읽는다", () => {
    const error = Object.assign(new Error("getaddrinfo ENOTFOUND ai-gateway"), {
      code: "ENOTFOUND",
    });
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: "ENOTFOUND" });
  });

  // ── cause.code → error.code, 형식에 맞는 첫 값 ──

  it("cause.code 와 error.code 가 둘 다 맞으면 cause.code 를 쓴다", () => {
    const error = Object.assign(
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      { code: "OUTER_CODE" },
    );
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: "ECONNREFUSED" });
  });

  it("cause.code 형식이 틀리면 error.code 로 넘어간다", () => {
    const error = Object.assign(
      new TypeError("fetch failed", { cause: { code: "connect ECONNREFUSED 10.0.0.5" } }),
      { code: "ENOTFOUND" },
    );
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: "ENOTFOUND" });
  });

  it("cause.code 와 error.code 가 둘 다 형식에 안 맞으면 null", () => {
    const error = Object.assign(new TypeError("fetch failed", { cause: { code: "bad code" } }), {
      code: "also bad",
    });
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: null });
  });

  it("redirect: error 로 막힌 리다이렉트(cause 에 code 없음)는 UNREACHABLE 이고 code null", () => {
    const error = new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    expect(classifyFetchError(error)).toEqual({ kind: "UNREACHABLE", code: null });
  });

  it("40자 code 는 싣는다", () => {
    const code = "A".repeat(40);
    expect(classifyFetchError(new TypeError("fetch failed", { cause: { code } }))).toEqual({
      kind: "UNREACHABLE",
      code,
    });
  });

  it.each([
    ["공백이 든 code", "ECONN REFUSED"],
    ["41자 code", "A".repeat(41)],
    ["주소가 든 code", "http://secret-host:8000"],
    ["빈 code", ""],
    ["숫자 code", 111],
  ])("형식에 맞지 않는 code(%s)는 null", (_label, code) => {
    expect(classifyFetchError(new TypeError("fetch failed", { cause: { code } }))).toEqual({
      kind: "UNREACHABLE",
      code: null,
    });
  });

  it("code 가 없는 오류는 UNREACHABLE 이고 code null", () => {
    expect(classifyFetchError(new Error("boom"))).toEqual({ kind: "UNREACHABLE", code: null });
  });

  it.each([
    ["문자열", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["숫자", 42],
  ])("Error 가 아닌 값(%s)도 던지지 않고 UNREACHABLE 이고 code null", (_label, value) => {
    expect(classifyFetchError(value)).toEqual({ kind: "UNREACHABLE", code: null });
  });

  it("결과에 오류 메시지를 싣지 않는다", () => {
    const error = new TypeError("fetch failed http://secret-host:8000", {
      cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.5:8000" },
    });
    const serialized = JSON.stringify(classifyFetchError(error));
    expect(serialized).not.toContain("secret-host");
    expect(serialized).not.toContain("10.0.0.5");
  });
});

const failureTable: [string, GatewayFailure, boolean, boolean][] = [
  // [이름, 실패, isRetryable, isAvailabilityFailure]
  ["UNREACHABLE", { kind: "UNREACHABLE", code: "ECONNREFUSED" }, false, true],
  ["TIMEOUT", { kind: "TIMEOUT" }, true, true],
  ["HTTP 500", { kind: "HTTP_ERROR", httpStatus: 500, errorCode: null }, true, true],
  ["HTTP 503", { kind: "HTTP_ERROR", httpStatus: 503, errorCode: "AI_UNAVAILABLE" }, true, true],
  ["HTTP 599", { kind: "HTTP_ERROR", httpStatus: 599, errorCode: null }, true, true],
  ["HTTP 400", { kind: "HTTP_ERROR", httpStatus: 400, errorCode: null }, false, false],
  ["HTTP 404", { kind: "HTTP_ERROR", httpStatus: 404, errorCode: null }, false, false],
  [
    "HTTP 422",
    { kind: "HTTP_ERROR", httpStatus: 422, errorCode: "KO_STATE_NOT_ALLOWED" },
    false,
    false,
  ],
  ["HTTP 499", { kind: "HTTP_ERROR", httpStatus: 499, errorCode: null }, false, false],
  [
    "INVALID_RESPONSE",
    { kind: "INVALID_RESPONSE", issues: ["status: invalid_value"] },
    false,
    false,
  ],
  ["CIRCUIT_OPEN", { kind: "CIRCUIT_OPEN" }, false, false],
];

describe("isRetryable", () => {
  it.each(failureTable)("%s 의 재시도 여부", (_label, failure, retryable) => {
    expect(isRetryable(failure)).toBe(retryable);
  });
});

describe("isAvailabilityFailure", () => {
  it.each(failureTable)("%s 가 gateway 불가 신호인지", (_label, failure, _retryable, down) => {
    expect(isAvailabilityFailure(failure)).toBe(down);
  });
});

describe("readErrorCode", () => {
  it("errorCode 를 읽고 message 는 버린다", () => {
    expect(
      readErrorCode({
        errorCode: "KO_STATE_NOT_ALLOWED",
        message: "stateLanguage=ko 는 허용되지 않음",
      }),
    ).toBe("KO_STATE_NOT_ALLOWED");
  });

  it("errorCode 가 없으면 detail.errorCode 를 읽는다", () => {
    expect(readErrorCode({ detail: { errorCode: "AI_UNAVAILABLE" } })).toBe("AI_UNAVAILABLE");
  });

  it("detail 이 문자열 코드면 그것을 읽는다", () => {
    expect(readErrorCode({ detail: "AI_UNAVAILABLE" })).toBe("AI_UNAVAILABLE");
  });

  it("errorCode 가 detail 보다 먼저다", () => {
    expect(readErrorCode({ errorCode: "FIRST_CODE", detail: { errorCode: "SECOND_CODE" } })).toBe(
      "FIRST_CODE",
    );
  });

  it("errorCode 형식이 틀리면 형식에 맞는 다음 값을 읽는다", () => {
    expect(readErrorCode({ errorCode: "not a code", detail: "AI_UNAVAILABLE" })).toBe(
      "AI_UNAVAILABLE",
    );
  });

  it("message 에만 코드가 있으면 null", () => {
    expect(readErrorCode({ message: "AI_UNAVAILABLE" })).toBeNull();
  });

  it("FastAPI 요청 형식 오류(detail 배열)는 null", () => {
    expect(readErrorCode({ detail: [{ loc: ["body"], msg: "x", type: "missing" }] })).toBeNull();
  });

  it("FastAPI 기본 문장 detail(Not Found)은 null", () => {
    expect(readErrorCode({ detail: "Not Found" })).toBeNull();
  });

  it("64자 코드는 읽는다", () => {
    const code = `A${"B".repeat(63)}`;
    expect(readErrorCode({ errorCode: code })).toBe(code);
  });

  it("65자 코드는 null", () => {
    expect(readErrorCode({ errorCode: `A${"B".repeat(64)}` })).toBeNull();
  });

  it.each([
    ["소문자로 시작", "ai_unavailable"],
    ["숫자로 시작", "1_CODE"],
    ["숫자 값", 503],
  ])("형식에 맞지 않는 errorCode(%s)는 null", (_label, errorCode) => {
    expect(readErrorCode({ errorCode })).toBeNull();
  });

  it.each([
    ["null", null],
    ["문자열", "AI_UNAVAILABLE"],
    ["숫자", 503],
    ["배열", []],
  ])("객체가 아닌 본문(%s)은 null", (_label, body) => {
    expect(readErrorCode(body)).toBeNull();
  });
});

describe("toIssueList", () => {
  const schema = z.object({
    status: z.enum(["COMPLETED"]),
    timings: z.object({ extractMs: z.number() }),
  });

  it("issue 를 '경로: 코드' 로 바꾼다", () => {
    const result = schema.safeParse({ status: "DONE", timings: { extractMs: "slow" } });
    expect(result.error && toIssueList(result.error)).toEqual([
      "status: invalid_value",
      "timings.extractMs: invalid_type",
    ]);
  });

  it("경로가 비면 (root) 로 적는다", () => {
    const result = z.string().safeParse(1);
    expect(result.error && toIssueList(result.error)).toEqual(["(root): invalid_type"]);
  });

  it("입력 값은 싣지 않는다", () => {
    const result = schema.safeParse({ status: "공고원문-SECRET-TEXT", timings: { extractMs: 1 } });
    const issues = result.error ? toIssueList(result.error) : [];
    expect(issues.join("\n")).not.toContain("SECRET-TEXT");
  });

  it("최대 10개까지만 싣는다", () => {
    const result = z.array(z.string()).safeParse(Array.from({ length: 15 }, () => 1));
    expect(result.error && toIssueList(result.error)).toHaveLength(10);
  });

  it("배열 색인이 든 경로도 '.' 로 잇는다", () => {
    const result = z
      .object({ items: z.array(z.object({ id: z.string() })) })
      .safeParse({ items: [{ id: "ok" }, { id: 1 }] });
    expect(result.error && toIssueList(result.error)).toEqual(["items.1.id: invalid_type"]);
  });
});

// 경로 조각은 받은 객체의 키일 수 있다(record·느슨한 객체). 키에 공고 원문·값이 섞여 진단·로그로 새지 않게,
// 숫자와 영문·숫자·_ 40자까지의 이름만 그대로 싣고 그 밖은 '*' 로 바꾼다.
describe("toIssueList · 경로 조각", () => {
  /** 경로가 path 인 issue 하나의 결과 줄. */
  const lineFor = (path: PropertyKey[]): string | undefined =>
    toIssueList(
      new z.ZodError([{ code: "custom", path, message: "값-SECRET-메시지", input: undefined }]),
    )[0];

  it.each<[string, PropertyKey[], string]>([
    ["숫자", [0, 12], "0.12: custom"],
    ["영문 이름", ["timings", "extractMs"], "timings.extractMs: custom"],
    ["영문·숫자·_", ["kev_assist", "q1"], "kev_assist.q1: custom"],
    ["40자 이름", ["a".repeat(40)], `${"a".repeat(40)}: custom`],
  ])("%s 조각은 그대로 싣는다", (_label, path, expected) => {
    expect(lineFor(path)).toBe(expected);
  });

  it.each<[string, PropertyKey[], string]>([
    ["41자 이름", ["a".repeat(41)], "*: custom"],
    ["공백", ["has space"], "*: custom"],
    ["점", ["a.b"], "*: custom"],
    ["한글", ["공고원문"], "*: custom"],
    ["기호", ["kebab-key"], "*: custom"],
    ["빈 이름", [""], "*: custom"],
    ["symbol", [Symbol("secret")], "*: custom"],
  ])("%s 조각은 '*' 로 바꾼다", (_label, path, expected) => {
    expect(lineFor(path)).toBe(expected);
  });

  it("안전한 조각과 바꾼 조각이 섞이면 조각마다 판정해 '.' 로 잇는다", () => {
    expect(lineFor(["items", 1, "공고 제목 키", "id"])).toBe("items.1.*.id: custom");
  });

  it("record 키로 들어온 공고 원문은 경로에 싣지 않는다", () => {
    const result = z
      .record(z.string(), z.number())
      .safeParse({ "세종특별자치시 차세대 행정정보시스템": "x" });
    const issues = result.error ? toIssueList(result.error) : [];
    expect(issues).toEqual(["*: invalid_type"]);
  });
});
