import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_FAILURE_KINDS,
  ingestErrorCodeOf,
  isRetryableFailure,
  type ConnectorFailure,
  type FetchPageOutcome,
} from "./connector.model";
import { G2B_GATEWAY_KEY_ERROR_CODES, looksLikeXml, parseG2bGatewayError } from "./g2b.model";
import type { StartRunInput } from "./ingestion.repo";
import { createMemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createOfficialApiConnector, type FetchLike } from "./official-api-connector";
import { fetchPageWithRetry, type RetryDeps } from "./retry";

// C3 계약 Stage 5-A: data.go.kr 공통 XML 오류 봉투(게이트웨이 오류)를 분류한다(07 §2.6, V2-03·V2-11).
// XML 표본은 계약이 구성한 모양이다. 실제 응답을 받아 본 적이 없으므로 XML 표본을 쓰는 시험 이름에 "미검증 가정(실측 표본 없음)"을 붙인다(e8).
// 네트워크는 가짜 fetch 뿐이다. 전역 fetch 는 부르면 실패하게 막아 둔다.

const UNVERIFIED = "미검증 가정(실측 표본 없음)";

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
// 가짜 서비스키(디코딩형). +·/·= 가 있어 원문·인코딩형이 서로 다르다.
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [
  SERVICE_KEY,
  encodeURIComponent(SERVICE_KEY),
  encodeURIComponent(encodeURIComponent(SERVICE_KEY)),
];
// KST 2026-10-19 하루 = 조각 하나
const INPUT = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z", cursor: null };

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// 계약 5-A 의 구성 표본. errMsg 는 바꿔 넣을 수 있다(키·URL 이 되돌아오는 경우를 흉내 낸다).
const gatewayXml = (
  options: { code?: string | null; authMsg?: string | null; errMsg?: string; head?: string } = {},
) => {
  const code = options.code === undefined ? "30" : options.code;
  const authMsg =
    options.authMsg === undefined ? "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" : options.authMsg;
  return [
    options.head ?? "",
    "<OpenAPI_ServiceResponse><cmmMsgHeader>",
    `<errMsg>${options.errMsg ?? "SERVICE ERROR"}</errMsg>`,
    authMsg === null ? "" : `<returnAuthMsg>${authMsg}</returnAuthMsg>`,
    code === null ? "" : `<returnReasonCode>${code}</returnReasonCode>`,
    "</cmmMsgHeader></OpenAPI_ServiceResponse>",
  ].join("");
};

const textResponse = (body: string, status = 200, contentType = "text/xml;charset=UTF-8") =>
  new Response(body, { status, headers: { "content-type": contentType } });

const respond =
  (response: () => Response): FetchLike =>
  async () =>
    response();

const connectorWith = (fetch: FetchLike, serviceKey = SERVICE_KEY) =>
  createOfficialApiConnector({ endpoint: ENDPOINT, serviceKey, fetch });

const failureOf = async (fetch: FetchLike, serviceKey = SERVICE_KEY): Promise<ConnectorFailure> => {
  const outcome: FetchPageOutcome = await connectorWith(fetch, serviceKey).fetchPage(INPUT);
  if (outcome.ok) throw new Error("실패를 기대했는데 성공했다");
  return outcome.failure;
};

const okEnvelope = {
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 },
  },
};

const globalFetch = vi.fn(async () => {
  throw new Error("시험에서 실제 네트워크를 부르면 안 된다");
});

beforeEach(() => {
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalFetch.mockClear();
});

describe("looksLikeXml — 앞 공백(BOM 포함)을 뺀 첫 글자가 <", () => {
  it(`${UNVERIFIED}: 게이트웨이 오류 봉투는 XML 이다`, () => {
    expect(looksLikeXml(gatewayXml())).toBe(true);
  });

  it(`${UNVERIFIED}: <?xml 머리로 시작해도 XML 이다`, () => {
    expect(looksLikeXml(`${XML_HEAD}${gatewayXml()}`)).toBe(true);
  });

  it("BOM 뒤의 < 도 XML 이다", () => {
    expect(looksLikeXml(`﻿${XML_HEAD}<a/>`)).toBe(true);
  });

  it("앞 공백·줄바꿈·탭 뒤의 < 도 XML 이다", () => {
    expect(looksLikeXml(" \n\t <a/>")).toBe(true);
  });

  it("BOM 과 공백이 함께 있어도 XML 이다", () => {
    expect(looksLikeXml("﻿  \n<a/>")).toBe(true);
  });

  it.each([
    ["JSON 객체", '{"response":{"header":{"resultCode":"00"}}}'],
    ["JSON 배열", "[1,2]"],
    ["빈 문자열", ""],
    ["공백뿐", "  \n\t "],
    ["글자 뒤에 나오는 <", "SERVICE ERROR <returnReasonCode>30</returnReasonCode>"],
  ])("%s 는 XML 이 아니다", (_name, text) => {
    expect(looksLikeXml(text)).toBe(false);
  });
});

describe("parseG2bGatewayError — returnReasonCode·returnAuthMsg", () => {
  it("키 오류 코드는 30·31 이다", () => {
    expect(G2B_GATEWAY_KEY_ERROR_CODES).toEqual(["30", "31"]);
  });

  it(`${UNVERIFIED}: 구성 표본(30)에서 코드와 authMsg 를 꺼낸다`, () => {
    expect(parseG2bGatewayError(gatewayXml())).toEqual({
      returnReasonCode: "30",
      returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
    });
  });

  it(`${UNVERIFIED}: <?xml 머리가 있어도 같은 값을 꺼낸다`, () => {
    expect(parseG2bGatewayError(`${XML_HEAD}\n${gatewayXml({ code: "22" })}`)).toEqual({
      returnReasonCode: "22",
      returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
    });
  });

  it(`${UNVERIFIED}: 코드 앞뒤 공백·줄바꿈은 떼고 숫자만 돌려준다`, () => {
    expect(parseG2bGatewayError(gatewayXml({ code: " \n 22 \t" }))?.returnReasonCode).toBe("22");
  });

  it.each([
    ["숫자가 아닌 코드", "ABC"],
    ["숫자와 글자가 섞인 코드", "30A"],
    ["빈 코드", ""],
    ["공백뿐인 코드", "   "],
  ])(`${UNVERIFIED}: %s 는 null 이다`, (_name, code) => {
    expect(parseG2bGatewayError(gatewayXml({ code }))).toBeNull();
  });

  it(`${UNVERIFIED}: returnReasonCode 요소가 없으면 null 이다`, () => {
    expect(parseG2bGatewayError(gatewayXml({ code: null }))).toBeNull();
  });

  it("XML 이 아니면 안에 returnReasonCode 가 있어도 null 이다", () => {
    expect(parseG2bGatewayError('{"x":"<returnReasonCode>30</returnReasonCode>"}')).toBeNull();
  });

  it(`${UNVERIFIED}: authMsg 가 대문자·숫자·밑줄이면 그대로 둔다`, () => {
    expect(
      parseG2bGatewayError(
        gatewayXml({ code: "22", authMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR" }),
      )?.returnAuthMsg,
    ).toBe("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR");
  });

  it.each([
    ["소문자", "service_key_error"],
    ["공백", "SERVICE KEY ERROR"],
    ["한글", "등록되지_않은_키"],
    ["= 가 든 값(되돌아온 키처럼 보임)", "SERVICEKEY=ABC"],
    ["+ / 가 든 값", "TESTKEY+FAKE/VALUE"],
    ["빈 값", ""],
  ])(
    `${UNVERIFIED}: authMsg 에 %s 이 있으면 authMsg 는 null 이고 코드는 남는다`,
    (_name, authMsg) => {
      expect(parseG2bGatewayError(gatewayXml({ authMsg }))).toEqual({
        returnReasonCode: "30",
        returnAuthMsg: null,
      });
    },
  );

  it(`${UNVERIFIED}: returnAuthMsg 요소가 없으면 authMsg 는 null 이다`, () => {
    expect(parseG2bGatewayError(gatewayXml({ authMsg: null }))).toEqual({
      returnReasonCode: "30",
      returnAuthMsg: null,
    });
  });
});

describe("OfficialApiConnector — XML 게이트웨이 오류 분류", () => {
  it(`${UNVERIFIED}: HTTP 200 + XML 22 는 QUOTA_EXCEEDED(resultCode 22)다`, async () => {
    const failure = await failureOf(respond(() => textResponse(gatewayXml({ code: "22" }))));
    expect(failure).toMatchObject({ kind: "QUOTA_EXCEEDED", resultCode: "22" });
  });

  it.each(["30", "31"])(
    `${UNVERIFIED}: HTTP 200 + XML %s 는 SERVICE_KEY_INVALID(resultCode 그 값)다`,
    async (code) => {
      const failure = await failureOf(respond(() => textResponse(gatewayXml({ code }))));
      expect(failure).toMatchObject({ kind: "SERVICE_KEY_INVALID", resultCode: code });
    },
  );

  it.each(["20", "99", "12"])(
    `${UNVERIFIED}: HTTP 200 + XML %s 는 RESULT_CODE(resultCode 그 값)다`,
    async (code) => {
      const failure = await failureOf(respond(() => textResponse(gatewayXml({ code }))));
      expect(failure).toMatchObject({ kind: "RESULT_CODE", resultCode: code });
    },
  );

  it(`${UNVERIFIED}: 코드가 없는 XML 은 HTTP_ERROR(status 200)다`, async () => {
    const failure = await failureOf(respond(() => textResponse(gatewayXml({ code: null }))));
    expect(failure).toMatchObject({ kind: "HTTP_ERROR", status: 200 });
  });

  it(`${UNVERIFIED}: 코드가 숫자가 아닌 XML 은 HTTP_ERROR 다`, async () => {
    const failure = await failureOf(respond(() => textResponse(gatewayXml({ code: "ABC" }))));
    expect(failure).toMatchObject({ kind: "HTTP_ERROR", status: 200 });
  });

  it.each([401, 403, 500, 502])(
    `${UNVERIFIED}: HTTP %i 이어도 본문이 XML 30 이면 SERVICE_KEY_INVALID 다(2xx 아니어도 본문 판정)`,
    async (status) => {
      const failure = await failureOf(respond(() => textResponse(gatewayXml(), status)));
      expect(failure).toMatchObject({ kind: "SERVICE_KEY_INVALID", resultCode: "30" });
    },
  );

  it(`${UNVERIFIED}: HTTP 500 + 코드 없는 XML 은 HTTP_ERROR(status 500)다`, async () => {
    const failure = await failureOf(respond(() => textResponse(gatewayXml({ code: null }), 500)));
    expect(failure).toMatchObject({ kind: "HTTP_ERROR", status: 500 });
  });

  it(`${UNVERIFIED}: Content-Type 이 application/json 이어도 본문이 < 로 시작하면 XML 로 판정한다`, async () => {
    const failure = await failureOf(
      respond(() => textResponse(gatewayXml(), 200, "application/json;charset=UTF-8")),
    );
    expect(failure).toMatchObject({ kind: "SERVICE_KEY_INVALID", resultCode: "30" });
  });

  it(`${UNVERIFIED}: <?xml 머리와 앞 공백이 있어도 XML 로 판정한다`, async () => {
    const failure = await failureOf(
      respond(() => textResponse(`\n  ${XML_HEAD}\n${gatewayXml({ code: "31" })}`)),
    );
    expect(failure).toMatchObject({ kind: "SERVICE_KEY_INVALID", resultCode: "31" });
  });

  it("XML 이 아닌 HTTP 500 은 지금처럼 HTTP_ERROR(status 500)다", async () => {
    const failure = await failureOf(
      respond(() => textResponse("Internal Server Error", 500, "text/plain")),
    );
    expect(failure).toMatchObject({ kind: "HTTP_ERROR", status: 500 });
  });

  it(`${UNVERIFIED}: 429 는 본문이 XML 22 여도 먼저 RATE_LIMITED 다`, async () => {
    const failure = await failureOf(
      respond(
        () =>
          new Response(gatewayXml({ code: "22" }), {
            status: 429,
            headers: { "content-type": "text/xml", "retry-after": "3" },
          }),
      ),
    );
    expect(failure).toMatchObject({ kind: "RATE_LIMITED", status: 429, retryAfterSec: 3 });
  });

  it("JSON 정상 봉투는 지금처럼 성공이다", async () => {
    const outcome = await connectorWith(
      respond(() => textResponse(JSON.stringify(okEnvelope), 200, "application/json")),
    ).fetchPage(INPUT);
    expect(outcome).toMatchObject({ ok: true, page: { records: [], nextCursor: null } });
  });
});

describe("OfficialApiConnector — XML 게이트웨이 오류의 detail", () => {
  it(`${UNVERIFIED}: detail 은 게이트웨이 resultCode 와 authMsg 를 담는다`, async () => {
    const failure = await failureOf(respond(() => textResponse(gatewayXml())));
    expect(failure.detail).toContain(
      "게이트웨이 resultCode 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
    );
  });

  it(`${UNVERIFIED}: authMsg 가 없으면 detail 은 게이트웨이 resultCode 로 끝난다`, async () => {
    const failure = await failureOf(
      respond(() => textResponse(gatewayXml({ code: "99", authMsg: null }))),
    );
    expect(failure.detail).toMatch(/게이트웨이 resultCode 99$/);
  });

  it(`${UNVERIFIED}: errMsg 에 서비스키·요청 URL 이 되돌아와도 detail 에는 없다`, async () => {
    const url = `${ENDPOINT}/getBidPblancListInfoServc?serviceKey=${encodeURIComponent(SERVICE_KEY)}&pageNo=1`;
    const failure = await failureOf(
      respond(() => textResponse(gatewayXml({ errMsg: `${SERVICE_KEY} ${url}` }))),
    );
    for (const form of SECRET_FORMS) expect(failure.detail).not.toContain(form);
    expect(failure.detail).not.toContain("apis.data.go.kr");
    expect(failure.detail).not.toMatch(/servicekey/i);
  });

  // authMsg 형식(/^[A-Z0-9_]+$/)에 맞는 키라면 authMsg 로 되돌아올 수 있다. 계약 5-A "detail 에 키 없음"·V2-11 을 따른다.
  it(`${UNVERIFIED}: authMsg 형식에 맞는 서비스키가 authMsg 로 되돌아와도 detail 에는 없다`, async () => {
    const upperKey = "FAKEKEY_0123456789_ABCDEFGHIJ";
    const failure = await failureOf(
      respond(() => textResponse(gatewayXml({ authMsg: upperKey }))),
      upperKey,
    );
    expect(failure.kind).toBe("SERVICE_KEY_INVALID");
    expect(failure.detail).not.toContain(upperKey);
  });
});

describe("SERVICE_KEY_INVALID — 재시도·오류 코드", () => {
  const KEY_INVALID: ConnectorFailure = {
    kind: "SERVICE_KEY_INVALID",
    resultCode: "30",
    detail: "게이트웨이 resultCode 30",
  };

  it("CONNECTOR_FAILURE_KINDS 에 SERVICE_KEY_INVALID 가 있다", () => {
    expect(CONNECTOR_FAILURE_KINDS).toContain("SERVICE_KEY_INVALID");
  });

  it("SERVICE_KEY_INVALID 는 재시도하지 않는다", () => {
    expect(isRetryableFailure(KEY_INVALID)).toBe(false);
  });

  it("ingestErrorCodeOf(SERVICE_KEY_INVALID) 는 API_SERVICE_KEY_INVALID 다", () => {
    expect(ingestErrorCodeOf(KEY_INVALID)).toBe("API_SERVICE_KEY_INVALID");
  });

  it(`${UNVERIFIED}: XML 30 을 받은 fetchPageWithRetry 는 한 번만 부르고 기다리지 않는다`, async () => {
    const fetch = vi.fn<FetchLike>(async () => textResponse(gatewayXml()));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchPageWithRetry(connectorWith(fetch), INPUT, {
      sleep,
      random: () => 0,
    });
    expect(result.outcome).toMatchObject({ ok: false, failure: { kind: "SERVICE_KEY_INVALID" } });
    expect(result.retried).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("runIngest — g2b 게이트웨이 키 오류 기록", () => {
  const g2bRun: StartRunInput = {
    source: "g2b",
    runMode: "LIVE",
    jobKey: "g2b:key-invalid",
    trigger: "MANUAL",
    batch: null,
    params: { window: { from: INPUT.from, to: INPUT.to } },
  };
  const retry: RetryDeps = { sleep: async () => undefined, random: () => 0 };

  const ingestKeyInvalid = async () => {
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector: connectorWith(respond(() => textResponse(gatewayXml({ code: "31" }), 401))),
      repo,
      run: g2bRun,
      now: () => new Date("2026-10-19T01:00:00.000Z"),
      retry,
      secrets: [SERVICE_KEY],
    });
    return { repo, result };
  };

  it(`${UNVERIFIED}: 키 오류(XML 31)는 run 을 FAILED 로 끝낸다`, async () => {
    const { result } = await ingestKeyInvalid();
    expect(result.status).toBe("FAILED");
  });

  it(`${UNVERIFIED}: 키 오류는 API_SERVICE_KEY_INVALID 와 resultCode 원문 31 로 기록한다`, async () => {
    const { repo, result } = await ingestKeyInvalid();
    expect(
      repo.state.errors.map(({ runId, sourceKey, errorCode, resultCode }) => ({
        runId,
        sourceKey,
        errorCode,
        resultCode,
      })),
    ).toEqual([
      {
        runId: result.runId,
        sourceKey: "g2b:page:start",
        errorCode: "API_SERVICE_KEY_INVALID",
        resultCode: "31",
      },
    ]);
  });
});
