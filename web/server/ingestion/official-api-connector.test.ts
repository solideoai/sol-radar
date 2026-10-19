import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchPageInput, FetchPageOutcome, G2bItem } from "./connector.model";
import { isInfoBizNoticeStrict } from "./g2b-filter";
import {
  createOfficialApiConnector,
  type FetchLike,
  type OfficialApiConnectorOptions,
} from "./official-api-connector";

// OfficialApiConnector(나라장터 입찰공고 목록) 계약 시험. 실제 호출은 없다.
// 응답 모양은 2026-10-19 실측 응답을 본떴고, 값은 모두 가상이다.

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [
  SERVICE_KEY,
  encodeURIComponent(SERVICE_KEY),
  new URLSearchParams({ k: SERVICE_KEY }).toString().slice("k=".length),
];

// KST 2026-10-18 00:00 ~ 2026-10-20 00:00 → 1일 조각 두 개
const TWO_DAYS = { from: "2026-10-17T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
const inputAt = (cursor: string | null): FetchPageInput => ({ ...TWO_DAYS, cursor });

// 담당자 필드마다 눈에 띄는 가짜 값.
const CONTACT: G2bItem = {
  ntceInsttOfclNm: "가짜담당자-1",
  ntceInsttOfclTelNo: "000-0000-0001",
  ntceInsttOfclEmailAdrs: "fake1@contact.invalid",
  exctvNm: "가짜집행관-1",
  crdtrNm: "가짜채권자-1",
  dminsttOfclEmailAdrs: "fake2@contact.invalid",
  ofclNm: "가짜담당자-2",
  ofclTelNo: "000-0000-0002",
  telNo: "000-0000-0003",
};

// 정보화사업 판정 조건별 행(broad 의 세 조건 중 하나만 맞거나, 하나도 안 맞는다).
const PUBLIC_Y: G2bItem = {
  bidNtceNo: "R26BK00000001",
  bidNtceOrd: "000",
  ntceKindNm: "등록공고",
  bidNtceNm: "가상 정보화 용역(infoBizYn Y)",
  ntceInsttNm: "가상공고기관",
  dminsttNm: "가상수요기관",
  infoBizYn: "Y",
  sucsfbidMthdNm: "적격심사",
  pubPrcrmntClsfcNm: "기타서비스",
};
const PUBLIC_SW: G2bItem = {
  ...PUBLIC_Y,
  bidNtceNo: "R26BK00000002",
  bidNtceNm: "가상 SW사업 표기 용역",
  infoBizYn: "",
  sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정(SW사업)",
};
const PUBLIC_NONE: G2bItem = {
  ...PUBLIC_Y,
  bidNtceNo: "R26BK00000003",
  bidNtceNm: "가상 연구조사 용역",
  infoBizYn: "N",
  pubPrcrmntClsfcNm: "과학기술연구조사서비스",
};
const withContact = (item: G2bItem): G2bItem => ({ ...item, ...CONTACT });

const okEnvelope = (items: G2bItem[], totalCount: number, pageNo = 1, numOfRows = 100) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, numOfRows, pageNo, totalCount },
  },
});
const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

type FetchCall = { url: string; signal: AbortSignal; redirect: string | undefined };

// 받은 요청을 기록하고 정해 둔 응답을 돌려주는 가짜 fetch. 응답은 부를 때마다 새로 만든다.
const recordingFetch = (
  respond: (url: string) => Response = () => jsonResponse(okEnvelope([], 0)),
) => {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, signal: init.signal, redirect: init.redirect });
    return respond(url);
  };
  return { calls, fetch };
};

const connectorWith = (fetch: FetchLike, options: Partial<OfficialApiConnectorOptions> = {}) =>
  createOfficialApiConnector({ endpoint: ENDPOINT, serviceKey: SERVICE_KEY, fetch, ...options });

const pageOf = (outcome: FetchPageOutcome) => {
  if (!outcome.ok) throw new Error(`성공을 기대했다: ${outcome.failure.kind}`);
  return outcome.page;
};

const paramsOf = (url: string): Record<string, string> =>
  Object.fromEntries(new URL(url).searchParams.entries());

const errorMessageOf = (create: () => unknown): string => {
  try {
    create();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  throw new Error("생성 시 던지기를 기대했다");
};

// 동기 throw 와 비동기 reject 를 모두 reject 로 받는다.
const settle = (run: () => Promise<unknown>): Promise<unknown> => Promise.resolve().then(run);

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

describe("createOfficialApiConnector — 생성 검증", () => {
  it("source 는 g2b 다", () => {
    expect(connectorWith(recordingFetch().fetch).source).toBe("g2b");
  });

  it("https 와 apis.data.go.kr endpoint 면 만들어진다", () => {
    expect(() => connectorWith(recordingFetch().fetch)).not.toThrow();
  });

  it.each([
    ["http(서비스키가 평문으로 나간다)", "http://apis.data.go.kr/1230000/ad/BidPublicInfoService"],
    ["다른 host", "https://example.com/1230000/ad/BidPublicInfoService"],
    [
      "apis.data.go.kr 뒤에 다른 도메인",
      "https://apis.data.go.kr.example.com/1230000/ad/BidPublicInfoService",
    ],
    [
      "userinfo 로 위장한 다른 host",
      "https://apis.data.go.kr@example.com/1230000/ad/BidPublicInfoService",
    ],
    ["URL 이 아님", "apis.data.go.kr/1230000/ad/BidPublicInfoService"],
  ])("endpoint 가 %s 면 생성 시 던진다", (_label, endpoint) => {
    expect(() => connectorWith(recordingFetch().fetch, { endpoint })).toThrow();
  });

  it("serviceKey 가 비면 생성 시 던진다", () => {
    expect(() => connectorWith(recordingFetch().fetch, { serviceKey: "" })).toThrow();
  });

  it.each([0, 1000, 1.5, -1])("numOfRows 가 %s 면 생성 시 던진다", (numOfRows) => {
    expect(() => connectorWith(recordingFetch().fetch, { numOfRows })).toThrow();
  });

  it.each([1, 999])("numOfRows 경계값 %s 는 받는다", (numOfRows) => {
    expect(() => connectorWith(recordingFetch().fetch, { numOfRows })).not.toThrow();
  });

  it.each([
    ["http endpoint", { endpoint: "http://apis.data.go.kr/1230000/ad/BidPublicInfoService" }],
    ["다른 host", { endpoint: "https://example.com/1230000/ad/BidPublicInfoService" }],
    ["numOfRows 0", { numOfRows: 0 }],
    ["numOfRows 1000", { numOfRows: 1000 }],
  ])("생성 오류 메시지에 서비스키가 없다: %s", (_label, options) => {
    const message = errorMessageOf(() => connectorWith(recordingFetch().fetch, options));

    for (const form of SECRET_FORMS) expect(message).not.toContain(form);
    expect(message).not.toContain("TESTKEY");
  });
});

describe("OfficialApiConnector.fetchPage — 요청", () => {
  it("cursor 가 null 이면 첫 조각 1쪽을 기본 100행으로 요청한다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt(null));

    expect(paramsOf(calls[0].url)).toEqual({
      serviceKey: SERVICE_KEY,
      type: "json",
      pageNo: "1",
      numOfRows: "100",
      inqryDiv: "1",
      inqryBgnDt: "202610180000",
      inqryEndDt: "202610190000",
    });
  });

  it("요청 경로는 endpoint 뒤의 목록 오퍼레이션이다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt(null));

    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(`${ENDPOINT}/getBidPblancListInfoServc`);
  });

  it("fetchPage 한 번에 fetch 를 한 번 부른다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt(null));

    expect(calls).toHaveLength(1);
  });

  it("fetch 에 아직 끊기지 않은 AbortSignal 을 넘긴다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt(null));

    expect([calls[0].signal instanceof AbortSignal, calls[0].signal.aborted]).toEqual([
      true,
      false,
    ]);
  });

  it("numOfRows 옵션을 요청에 쓴다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch, { numOfRows: 50 }).fetchPage(inputAt(null));

    expect(paramsOf(calls[0].url).numOfRows).toBe("50");
  });

  it("cursor '0:2' 는 첫 조각 2쪽을 요청한다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt("0:2"));

    const params = paramsOf(calls[0].url);
    expect([params.pageNo, params.inqryBgnDt, params.inqryEndDt]).toEqual([
      "2",
      "202610180000",
      "202610190000",
    ]);
  });

  it("cursor '1:1' 은 둘째 조각 1쪽을 요청한다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt("1:1"));

    const params = paramsOf(calls[0].url);
    expect([params.pageNo, params.inqryBgnDt, params.inqryEndDt]).toEqual([
      "1",
      "202610190000",
      "202610200000",
    ]);
  });

  it("from 이 to 이후면 빈 페이지를 돌려준다", async () => {
    const { fetch } = recordingFetch();

    const outcome = await connectorWith(fetch).fetchPage({
      from: TWO_DAYS.to,
      to: TWO_DAYS.from,
      cursor: null,
    });

    expect(outcome).toEqual({
      ok: true,
      page: { records: [], nextCursor: null, rateLimitInfo: null },
    });
  });

  it("from 이 to 이후면 fetch 를 부르지 않는다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage({ from: TWO_DAYS.to, to: TWO_DAYS.from, cursor: null });

    expect(calls).toHaveLength(0);
  });

  it.each([
    ["from 이 null", { from: null, to: TWO_DAYS.to, cursor: null }],
    ["to 가 null", { from: TWO_DAYS.from, to: null, cursor: null }],
    ["from 이 날짜가 아님", { from: "어제", to: TWO_DAYS.to, cursor: null }],
  ])("from·to 가 ISO 문자열이 아니면 던진다: %s", async (_label, input) => {
    const { fetch } = recordingFetch();

    await expect(settle(() => connectorWith(fetch).fetchPage(input))).rejects.toThrow();
  });

  it.each(["", "abc", "0", "0:0", "2:1", "-1:1", "0:1.5", "0:x", "0:1:1"])(
    "잘못된 cursor(%j)는 던진다",
    async (cursor) => {
      const { fetch } = recordingFetch();

      await expect(settle(() => connectorWith(fetch).fetchPage(inputAt(cursor)))).rejects.toThrow();
    },
  );

  it("잘못된 cursor 면 fetch 를 부르지 않는다", async () => {
    const { calls, fetch } = recordingFetch();

    await settle(() => connectorWith(fetch).fetchPage(inputAt("2:1"))).catch(() => undefined);

    expect(calls).toHaveLength(0);
  });
});

describe("OfficialApiConnector.fetchPage — 페이지네이션", () => {
  const nextCursorAfter = async (
    cursor: string | null,
    totalCount: number,
    options: Partial<OfficialApiConnectorOptions> = {},
    bodyPageNo = 1,
  ) => {
    const { fetch } = recordingFetch(() => jsonResponse(okEnvelope([], totalCount, bodyPageNo)));
    return pageOf(await connectorWith(fetch, options).fetchPage(inputAt(cursor))).nextCursor;
  };

  it("같은 조각에 남은 쪽이 있으면 nextCursor 는 같은 조각의 다음 쪽이다", async () => {
    expect(await nextCursorAfter(null, 250)).toBe("0:2");
  });

  it("그 조각의 마지막 쪽 다음은 다음 조각 1쪽이다", async () => {
    expect(await nextCursorAfter("0:3", 250)).toBe("1:1");
  });

  it("pageNo×numOfRows 가 totalCount 와 같으면 다음 조각으로 넘어간다", async () => {
    expect(await nextCursorAfter("0:2", 200)).toBe("1:1");
  });

  it("totalCount 가 0 이면 다음 조각으로 넘어간다", async () => {
    expect(await nextCursorAfter(null, 0)).toBe("1:1");
  });

  it("마지막 조각의 마지막 쪽이면 nextCursor 는 null 이다", async () => {
    expect(await nextCursorAfter("1:1", 50)).toBeNull();
  });

  it("마지막 조각에 남은 쪽이 있으면 같은 조각의 다음 쪽이다", async () => {
    expect(await nextCursorAfter("1:1", 150)).toBe("1:2");
  });

  it("nextCursor 는 numOfRows 옵션으로 계산한다", async () => {
    expect(await nextCursorAfter(null, 80, { numOfRows: 50 })).toBe("0:2");
  });

  it("nextCursor 는 응답 본문의 pageNo 가 아니라 요청한 pageNo 로 계산한다", async () => {
    expect(await nextCursorAfter("0:2", 250, {}, 1)).toBe("0:3");
  });
});

describe("OfficialApiConnector.fetchPage — 레코드", () => {
  const ITEMS = [withContact(PUBLIC_Y), withContact(PUBLIC_SW), withContact(PUBLIC_NONE)];
  const respondItems = () => jsonResponse(okEnvelope(ITEMS, ITEMS.length));
  const noticeNosOf = (outcome: FetchPageOutcome) =>
    pageOf(outcome).records.map((record) =>
      record.kind === "g2b-bid-notice" ? record.item.bidNtceNo : null,
    );

  it("isInfoBizNotice 를 주지 않으면 broad 필터로 거른다(결정 C3-1)", async () => {
    const { fetch } = recordingFetch(respondItems);

    const outcome = await connectorWith(fetch).fetchPage(inputAt(null));

    expect(noticeNosOf(outcome)).toEqual(["R26BK00000001", "R26BK00000002"]);
  });

  it("isInfoBizNotice 로 strict 를 주면 infoBizYn Y 행만 담는다", async () => {
    const { fetch } = recordingFetch(respondItems);

    const outcome = await connectorWith(fetch, {
      isInfoBizNotice: isInfoBizNoticeStrict,
    }).fetchPage(inputAt(null));

    expect(noticeNosOf(outcome)).toEqual(["R26BK00000001"]);
  });

  it("필터는 담당자 필드가 있는 원본 행으로 판정한다", async () => {
    const seen: G2bItem[] = [];
    const { fetch } = recordingFetch(respondItems);

    await connectorWith(fetch, {
      isInfoBizNotice: (item) => {
        seen.push(item);
        return true;
      },
    }).fetchPage(inputAt(null));

    expect(seen.map((item) => item.ntceInsttOfclNm)).toEqual([
      CONTACT.ntceInsttOfclNm,
      CONTACT.ntceInsttOfclNm,
      CONTACT.ntceInsttOfclNm,
    ]);
  });

  it("레코드 종류는 g2b-bid-notice 다", async () => {
    const { fetch } = recordingFetch(respondItems);

    const page = pageOf(await connectorWith(fetch).fetchPage(inputAt(null)));

    expect(page.records.map((record) => record.kind)).toEqual(["g2b-bid-notice", "g2b-bid-notice"]);
  });

  it("레코드 item 은 담당자 필드만 뺀 원본 행이다", async () => {
    const { fetch } = recordingFetch(respondItems);

    const page = pageOf(await connectorWith(fetch).fetchPage(inputAt(null)));

    expect(page.records).toEqual([
      { kind: "g2b-bid-notice", item: PUBLIC_Y },
      { kind: "g2b-bid-notice", item: PUBLIC_SW },
    ]);
  });

  it("레코드 어디에도 담당자 필드 값이 없다", async () => {
    const { fetch } = recordingFetch(respondItems);

    const json = JSON.stringify(
      pageOf(await connectorWith(fetch).fetchPage(inputAt(null))).records,
    );

    for (const value of Object.values(CONTACT)) expect(json).not.toContain(String(value));
  });

  it("rateLimitInfo.remaining 은 x-ratelimit-remaining 헤더의 정수다", async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(okEnvelope([], 0), { "x-ratelimit-remaining": "42" }),
    );

    const page = pageOf(await connectorWith(fetch).fetchPage(inputAt(null)));

    expect(page.rateLimitInfo).toEqual({ limit: null, remaining: 42, retryAfterSec: null });
  });

  it("x-ratelimit-remaining 헤더가 없으면 remaining 은 null 이다", async () => {
    const { fetch } = recordingFetch();

    const page = pageOf(await connectorWith(fetch).fetchPage(inputAt(null)));

    expect(page.rateLimitInfo).toEqual({ limit: null, remaining: null, retryAfterSec: null });
  });

  it.each(["abc", "4.5", ""])(
    "x-ratelimit-remaining 이 정수가 아니면(%j) remaining 은 null 이다",
    async (remaining) => {
      const { fetch } = recordingFetch(() =>
        jsonResponse(okEnvelope([], 0), { "x-ratelimit-remaining": remaining }),
      );

      const page = pageOf(await connectorWith(fetch).fetchPage(inputAt(null)));

      expect(page.rateLimitInfo?.remaining).toBeNull();
    },
  );
});

describe("OfficialApiConnector — 네트워크", () => {
  it("주입한 fetch 만 부르고 전역 fetch 는 부르지 않는다", async () => {
    const { calls, fetch } = recordingFetch(() =>
      jsonResponse(okEnvelope([withContact(PUBLIC_Y)], 1)),
    );

    await connectorWith(fetch).fetchPage(inputAt(null));

    expect([calls.length, globalFetch.mock.calls.length]).toEqual([1, 0]);
  });
});

// 계약 7-3: 공공 API 리다이렉트 금지·응답 크기 상한(G2B_RESPONSE_MAX_BYTES = 20 MiB, UTF-8 바이트 기준)
describe("OfficialApiConnector — 리다이렉트·응답 크기(7-3)", () => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

  // 읽을 때만 pull 이 불리는 본문(highWaterMark 0). pull 횟수로 본문을 읽었는지 본다(cancel 은 pull 을 부르지 않는다).
  const streamResponse = (bytes: Uint8Array, headers: Record<string, string> = {}) => {
    const reads = { pulls: 0 };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads.pulls += 1;
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
    return { response, reads };
  };

  // 글자 수는 상한보다 작지만 UTF-8 바이트(한글 3바이트)는 상한을 넘는 정상 봉투
  const oversizedEnvelope = () =>
    encode(okEnvelope([{ ...PUBLIC_Y, bidNtceNm: "가".repeat(Math.ceil(MAX_BYTES / 3) + 1) }], 1));
  // UTF-8 바이트가 상한과 정확히 같은 정상 봉투
  const exactlyMaxEnvelope = () => {
    const baseBytes = encode(okEnvelope([{ ...PUBLIC_Y, bidNtceNm: "" }], 1)).length;
    return encode(okEnvelope([{ ...PUBLIC_Y, bidNtceNm: "a".repeat(MAX_BYTES - baseBytes) }], 1));
  };

  const failureOf = (outcome: FetchPageOutcome) => {
    if (outcome.ok) throw new Error("실패를 기대했는데 성공했다");
    return outcome.failure;
  };

  it("fetch 에 redirect: 'error' 를 넘긴다", async () => {
    const { calls, fetch } = recordingFetch();

    await connectorWith(fetch).fetchPage(inputAt(null));

    expect(calls[0]?.redirect).toBe("error");
  });

  it("리다이렉트로 fetch 가 던지면 status 없는 HTTP_ERROR 다", async () => {
    // redirect: "error" 면 fetch 가 3xx 에서 던진다. 옵션 없이 따라가면 다른 곳의 정상 응답을 받게 된다.
    const fetch: FetchLike = async (_url, init) => {
      if (init.redirect === "error") {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      }
      return jsonResponse(okEnvelope([withContact(PUBLIC_Y)], 1));
    };

    const failure = failureOf(await connectorWith(fetch).fetchPage(inputAt(null)));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", undefined]);
  });

  it("content-length 가 상한을 넘으면 본문을 읽지 않는다", async () => {
    const { response, reads } = streamResponse(encode(okEnvelope([], 0)), {
      "content-length": String(MAX_BYTES + 1),
    });

    await connectorWith(async () => response).fetchPage(inputAt(null));

    expect(reads.pulls).toBe(0);
  });

  it("content-length 가 상한을 넘으면 status 를 담은 HTTP_ERROR 다", async () => {
    const { response } = streamResponse(encode(okEnvelope([], 0)), {
      "content-length": String(MAX_BYTES + 1),
    });

    const failure = failureOf(await connectorWith(async () => response).fetchPage(inputAt(null)));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 200]);
  });

  it("content-length 가 상한과 같으면 읽어서 처리한다(경계)", async () => {
    const { response } = streamResponse(encode(okEnvelope([withContact(PUBLIC_Y)], 1)), {
      "content-length": String(MAX_BYTES),
    });

    const outcome = await connectorWith(async () => response).fetchPage(inputAt(null));

    expect(outcome.ok).toBe(true);
  });

  it("content-length 없이 읽은 본문의 UTF-8 바이트가 상한을 넘으면 HTTP_ERROR 다", async () => {
    const { response } = streamResponse(oversizedEnvelope());

    const failure = failureOf(await connectorWith(async () => response).fetchPage(inputAt(null)));

    expect([failure.kind, failure.status]).toEqual(["HTTP_ERROR", 200]);
  });

  it("읽은 본문의 UTF-8 바이트가 상한과 같으면 처리한다(경계)", async () => {
    const { response } = streamResponse(exactlyMaxEnvelope());

    const outcome = await connectorWith(async () => response).fetchPage(inputAt(null));

    expect(outcome.ok).toBe(true);
  });

  const SIZE_FAILURES: [string, () => Response][] = [
    [
      "content-length 초과",
      () =>
        streamResponse(encode(okEnvelope([], 0)), { "content-length": String(MAX_BYTES + 1) })
          .response,
    ],
    ["읽은 본문 초과", () => streamResponse(oversizedEnvelope()).response],
  ];

  it.each(SIZE_FAILURES)(
    "%s 의 detail 은 '응답이 너무 크다' 를 담는다",
    async (_label, respond) => {
      const failure = failureOf(
        await connectorWith(async () => respond()).fetchPage(inputAt(null)),
      );

      expect(failure.detail).toContain("응답이 너무 크다");
    },
  );

  it.each(SIZE_FAILURES)("%s 실패 결과에 서비스키·URL 이 없다", async (_label, respond) => {
    const json = JSON.stringify(
      await connectorWith(async () => respond()).fetchPage(inputAt(null)),
    );

    for (const form of SECRET_FORMS) expect(json).not.toContain(form);
    expect(json).not.toContain("TESTKEY");
    expect(json).not.toMatch(/servicekey/i);
    expect(json).not.toContain("apis.data.go.kr");
  });
});
