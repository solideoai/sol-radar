import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { G2bItem } from "./connector.model";
import {
  EMPTY_AUX_ROWS,
  G2B_AUX_MAX_PAGES,
  auxRowsForNotice,
  createG2bAuxFetcher,
} from "./g2b-aux";
import type { FetchLike } from "./g2b-http";
import { G2B_AUX_OPERATIONS } from "./g2b.model";
import {
  RECORDED_REPLAY_SERVICE_KEY,
  createRecordedAuxFetcher,
  loadRecordedResponse,
  type RecordedResponse,
} from "./recorded-api";
import type { RetryDeps } from "./retry";

// G2bAuxFetcher(07 §2.2 보조 조회 3종, C1 증거 §5·§10-3). 가짜 fetch 와 녹음 재생만 쓴다. 실제 네트워크는 부르지 않는다.
// 응답 모양은 2026-10-19 실측 응답을 본떴고, 가짜 응답의 값은 모두 가상이다.

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [
  SERVICE_KEY,
  encodeURIComponent(SERVICE_KEY),
  encodeURIComponent(encodeURIComponent(SERVICE_KEY)),
];
const NOTICE_NO = "R26BK00000001";
const OTHER_NOTICE_NO = "R26BK00000002";
// 등록일시 KST 2026-10-12 09:00:22
const REGISTERED_AT = new Date("2026-10-12T00:00:22.000Z");
const REQUEST = { noticeId: NOTICE_NO, amendmentNo: "000", registeredAt: REGISTERED_AT };
const [LICENSE_OP, REGION_OP, EORDER_OP] = G2B_AUX_OPERATIONS.map(({ operation }) => operation);

const RECORDED_DIR = fileURLToPath(
  new URL("../../../fixtures/recorded/15129394/", import.meta.url),
);
const RECORDED_NOTICE_NO = "R26BK01756112";
const AUX_RECORDINGS = [
  "getBidPblancListInfoLicenseLimit.20261019.masked.json",
  "getBidPblancListInfoLicenseLimit.20261019.window.masked.json",
  "getBidPblancListInfoPrtcptPsblRgn.20261019.masked.json",
  "getBidPblancListInfoEorderAtchFileInfo.20261019.masked.json",
];

const CONTACT: G2bItem = {
  ntceInsttOfclNm: "가짜담당자-1",
  ntceInsttOfclTelNo: "000-0000-0001",
  ofclNm: "가짜담당자-2",
};
const licenseRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtGrpNo: "1",
  lmtSno: "1",
  lcnsLmtNm: "정보통신공사업/0036",
  permsnIndstrytyList: "",
  indstrytyMfrcFldList: "",
  rgstDt: "2026-10-12 09:00:22",
  bsnsDivNm: "용역",
  ...overrides,
});
const regionRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtSno: "1",
  prtcptPsblRgnNm: "대구광역시",
  rgstDt: "2026-10-12 09:00:22",
  bsnsDivNm: "용역",
  ...overrides,
});
const eorderRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  atchSno: "1",
  eorderDocDivNm: "제안요청서",
  eorderAtchFileNm: "제안요청서.hwpx",
  eorderAtchFileUrl: `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?rfpNo=R26DH00000001&rfpOrd=000&rfpUntyAtchFileNo=1`,
  ...overrides,
});

const okBody = (items: G2bItem[], totalCount = items.length, numOfRows = 999, pageNo = 1) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, numOfRows, pageNo, totalCount },
  },
});
// 2026-10-20 실측: 보조 조회 0건은 items 키가 없다.
const emptyBody = () => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { numOfRows: 999, pageNo: 1, totalCount: 0 },
  },
});
const errorBody = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

type Call = { operation: string; params: Record<string, string>; redirect: string | undefined };
type Responder = (call: Call, nth: number) => Response;

// 오퍼레이션별 응답기. nth 는 그 오퍼레이션을 몇 번째 부르는지(1부터)다. 받은 URL 은 파라미터로만 남긴다(키 포함 URL 은 쓰지 않는다).
const routedFetch = (routes: Partial<Record<string, Responder>>) => {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const operation = parsed.pathname.split("/").at(-1) ?? "";
    const call: Call = {
      operation,
      params: Object.fromEntries(parsed.searchParams.entries()),
      redirect: init.redirect,
    };
    calls.push(call);
    const nth = (counts.get(operation) ?? 0) + 1;
    counts.set(operation, nth);
    const respond = routes[operation];
    if (!respond) throw new Error(`시험에 없는 오퍼레이션: ${operation}`);
    return respond(call, nth);
  };
  return { calls, fetch };
};

const ALL_OK: Partial<Record<string, Responder>> = {
  [LICENSE_OP]: () => json(okBody([licenseRow()])),
  [REGION_OP]: () => json(okBody([regionRow()])),
  [EORDER_OP]: () => json(okBody([eorderRow()])),
};

const deps = () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  const retry: RetryDeps = { sleep, random: () => 0 };
  return { sleep, retry };
};

const fetcherWith = (fetch: FetchLike, options: { retry?: RetryDeps; numOfRows?: number } = {}) =>
  createG2bAuxFetcher({
    endpoint: ENDPOINT,
    serviceKey: SERVICE_KEY,
    fetch,
    retry: options.retry ?? deps().retry,
    ...(options.numOfRows === undefined ? {} : { numOfRows: options.numOfRows }),
  });

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

describe("createG2bAuxFetcher — 생성 검증", () => {
  it("endpoint 가 apis.data.go.kr 의 https 가 아니면 던진다", () => {
    expect(() =>
      createG2bAuxFetcher({
        endpoint: "https://example.invalid/x",
        serviceKey: SERVICE_KEY,
        fetch: routedFetch({}).fetch,
        retry: deps().retry,
      }),
    ).toThrow("G2bAuxFetcher");
  });

  it("serviceKey 가 비어 있으면 던지고 메시지에 endpoint 값이 없다", () => {
    let message = "";
    try {
      createG2bAuxFetcher({
        endpoint: ENDPOINT,
        serviceKey: " ",
        fetch: routedFetch({}).fetch,
        retry: deps().retry,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("serviceKey");
    expect(message).not.toContain(ENDPOINT);
  });

  it("numOfRows 가 1~999 정수가 아니면 던진다", () => {
    expect(() => fetcherWith(routedFetch({}).fetch, { numOfRows: 1000 })).toThrow("numOfRows");
  });
});

describe("G2bAuxFetcher.fetchAux — 요청", () => {
  it("면허제한 → 참가가능지역 → e발주 첨부 순서로 세 번 부른다", async () => {
    const { calls, fetch } = routedFetch(ALL_OK);

    await fetcherWith(fetch).fetchAux(REQUEST);

    expect(calls.map((call) => call.operation)).toEqual([LICENSE_OP, REGION_OP, EORDER_OP]);
  });

  it("각 요청은 inqryDiv=2 + bidNtceNo + bidNtceOrd + 등록일 −1일~+6일 기간 + type=json 이다", async () => {
    const { calls, fetch } = routedFetch(ALL_OK);

    await fetcherWith(fetch).fetchAux(REQUEST);

    for (const call of calls) {
      expect(call.params).toEqual({
        serviceKey: SERVICE_KEY,
        type: "json",
        pageNo: "1",
        numOfRows: "999",
        inqryDiv: "2",
        inqryBgnDt: "202610110000",
        inqryEndDt: "202610182359",
        bidNtceNo: NOTICE_NO,
        bidNtceOrd: "000",
      });
    }
  });

  it("차수가 없으면 bidNtceOrd 를 보내지 않는다", async () => {
    const { calls, fetch } = routedFetch(ALL_OK);

    await fetcherWith(fetch).fetchAux({ ...REQUEST, amendmentNo: null });

    expect(calls.every((call) => !("bidNtceOrd" in call.params))).toBe(true);
  });

  it("redirect 는 error 다(서비스키가 실린 요청이 다른 곳으로 가지 않게)", async () => {
    const { calls, fetch } = routedFetch(ALL_OK);

    await fetcherWith(fetch).fetchAux(REQUEST);

    expect(calls.map((call) => call.redirect)).toEqual(["error", "error", "error"]);
  });

  it("전역 fetch 를 부르지 않는다", async () => {
    await fetcherWith(routedFetch(ALL_OK).fetch).fetchAux(REQUEST);

    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("G2bAuxFetcher.fetchAux — 결과", () => {
  it("세 오퍼레이션의 행을 종류별로 담고 실패 0·호출 3 이다", async () => {
    const outcome = await fetcherWith(routedFetch(ALL_OK).fetch).fetchAux(REQUEST);

    expect(outcome).toEqual({
      rows: { licenseLimit: [licenseRow()], region: [regionRow()], eorderAttach: [eorderRow()] },
      failures: [],
      calls: 3,
      retried: 0,
    });
  });

  it("0건 응답(items 키 없음)은 빈 배열이고 실패가 아니다", async () => {
    const { fetch } = routedFetch({
      [LICENSE_OP]: () => json(emptyBody()),
      [REGION_OP]: () => json(emptyBody()),
      [EORDER_OP]: () => json(emptyBody()),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect([outcome.rows, outcome.failures, outcome.calls]).toEqual([EMPTY_AUX_ROWS, [], 3]);
  });

  it("다른 공고의 행은 버린다(inqryDiv=1 처럼 bidNtceNo 가 무시돼 섞여 와도)", async () => {
    const foreign = licenseRow({ bidNtceNo: OTHER_NOTICE_NO, lcnsLmtNm: "가스난방공사업/6203" });
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () => json(okBody([foreign, licenseRow(), foreign])),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect(outcome.rows.licenseLimit).toEqual([licenseRow()]);
  });

  it("auxRowsForNotice 는 bidNtceNo 가 같은 행만 남긴다", () => {
    const rows = [licenseRow({ bidNtceNo: OTHER_NOTICE_NO }), licenseRow(), { lcnsLmtNm: "x" }];
    expect(auxRowsForNotice(rows, NOTICE_NO)).toEqual([licenseRow()]);
  });

  it("행에서 담당자 필드를 뺀다", async () => {
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () => json(okBody([{ ...licenseRow(), ...CONTACT }])),
      [EORDER_OP]: () => json(okBody([{ ...eorderRow(), ...CONTACT }])),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    const stored = JSON.stringify(outcome);
    for (const [key, value] of Object.entries(CONTACT)) {
      expect(stored).not.toContain(`"${key}"`);
      expect(stored).not.toContain(String(value));
    }
    expect(outcome.rows.licenseLimit).toEqual([licenseRow()]);
  });

  it("totalCount 가 한 쪽보다 크면 다음 쪽을 더 받아 합친다(호출 수도 더한다)", async () => {
    const rows = [
      licenseRow({ lmtSno: "1" }),
      licenseRow({ lmtSno: "2" }),
      licenseRow({ lmtSno: "3" }),
    ];
    const { calls, fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: (_call, nth) => json(okBody(rows.slice((nth - 1) * 2, nth * 2), 3, 2, nth)),
    });

    const outcome = await fetcherWith(fetch, { numOfRows: 2 }).fetchAux(REQUEST);

    expect(outcome.rows.licenseLimit).toEqual(rows);
    expect(
      calls.filter((call) => call.operation === LICENSE_OP).map((call) => call.params.pageNo),
    ).toEqual(["1", "2"]);
    expect(outcome.calls).toBe(4);
  });

  it(`totalCount 를 못 채워도 쪽 상한(${G2B_AUX_MAX_PAGES})에서 멈춘다`, async () => {
    const { calls, fetch } = routedFetch({
      ...ALL_OK,
      // 서버가 totalCount 는 크게 주면서 매 쪽 같은 한 행만 주는 경우
      [LICENSE_OP]: (_call, nth) =>
        json(okBody([licenseRow({ lmtSno: String(nth) })], 100, 1, nth)),
    });

    const outcome = await fetcherWith(fetch, { numOfRows: 1 }).fetchAux(REQUEST);

    expect(calls.filter((call) => call.operation === LICENSE_OP)).toHaveLength(G2B_AUX_MAX_PAGES);
    expect(outcome.rows.licenseLimit).toHaveLength(G2B_AUX_MAX_PAGES);
  });

  it("빈 쪽이 오면 totalCount 와 상관없이 멈춘다", async () => {
    const { calls, fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: (_call, nth) =>
        json(nth === 1 ? okBody([licenseRow()], 5, 1, 1) : okBody([], 5, 1, nth)),
    });

    await fetcherWith(fetch, { numOfRows: 1 }).fetchAux(REQUEST);

    expect(calls.filter((call) => call.operation === LICENSE_OP)).toHaveLength(2);
  });
});

describe("G2bAuxFetcher.fetchAux — 실패는 오퍼레이션마다 따로", () => {
  it("한 오퍼레이션이 결과 코드로 실패해도 나머지 행은 담고 실패를 값으로 돌려준다", async () => {
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () => json(errorBody("07", "입력범위값 초과 에러")),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect(outcome.rows).toEqual({
      licenseLimit: [],
      region: [regionRow()],
      eorderAttach: [eorderRow()],
    });
    expect(outcome.failures).toEqual([
      {
        operation: LICENSE_OP,
        registryKey: "g2b-bid-license-limit",
        failure: {
          kind: "RESULT_CODE",
          resultCode: "07",
          detail: `나라장터 ${LICENSE_OP} resultCode 07: 입력범위값 초과 에러`,
        },
      },
    ]);
    expect(outcome.calls).toBe(3);
  });

  it("결과 코드는 재시도하지 않는다", async () => {
    const { sleep, retry } = deps();
    const { calls, fetch } = routedFetch({
      ...ALL_OK,
      [REGION_OP]: () => json(errorBody("07", "입력범위값 초과 에러")),
    });

    const outcome = await fetcherWith(fetch, { retry }).fetchAux(REQUEST);

    expect([calls.length, sleep.mock.calls.length, outcome.retried]).toEqual([3, 0, 0]);
  });

  it("HTTP 500 은 1·2·4초 backoff 로 최대 3회 재시도하고, 네 번 모두 실패하면 그 실패를 돌려준다", async () => {
    const { sleep, retry } = deps();
    const { calls, fetch } = routedFetch({
      ...ALL_OK,
      [EORDER_OP]: () => json({}, 500),
    });

    const outcome = await fetcherWith(fetch, { retry }).fetchAux(REQUEST);

    expect(calls.filter((call) => call.operation === EORDER_OP)).toHaveLength(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect([outcome.calls, outcome.retried]).toEqual([6, 3]);
    expect(
      outcome.failures.map(({ registryKey, failure }) => [
        registryKey,
        failure.kind,
        failure.status,
      ]),
    ).toEqual([["g2b-bid-eorder-attach", "HTTP_ERROR", 500]]);
  });

  it("HTTP 500 뒤 성공하면 그 행을 담고 호출 수는 재시도까지 센다", async () => {
    const { retry } = deps();
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: (_call, nth) => (nth === 1 ? json({}, 503) : json(okBody([licenseRow()]))),
    });

    const outcome = await fetcherWith(fetch, { retry }).fetchAux(REQUEST);

    expect([outcome.rows.licenseLimit, outcome.failures, outcome.calls, outcome.retried]).toEqual([
      [licenseRow()],
      [],
      4,
      1,
    ]);
  });

  it("429 는 Retry-After 초만큼 기다린 뒤 다시 부른다", async () => {
    const { sleep, retry } = deps();
    const { fetch } = routedFetch({
      ...ALL_OK,
      [REGION_OP]: (_call, nth) =>
        nth === 1 ? json("", 429, { "retry-after": "2" }) : json(okBody([regionRow()])),
    });

    const outcome = await fetcherWith(fetch, { retry }).fetchAux(REQUEST);

    expect([sleep.mock.calls.map(([ms]) => ms), outcome.rows.region, outcome.calls]).toEqual([
      [2000],
      [regionRow()],
      4,
    ]);
  });

  it("네트워크 오류(fetch 가 던짐)는 HTTP_ERROR 실패이고 run 을 깨지 않는다", async () => {
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () => {
        throw new TypeError("fetch failed");
      },
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect(outcome.failures.map(({ failure }) => [failure.kind, failure.detail])).toEqual([
      ["HTTP_ERROR", `나라장터 ${LICENSE_OP} 요청 실패(네트워크)`],
    ]);
    expect(outcome.rows.region).toEqual([regionRow()]);
  });

  it("세 오퍼레이션이 모두 실패하면 행은 모두 비고 실패 3 이다", async () => {
    const { fetch } = routedFetch({
      [LICENSE_OP]: () => json(errorBody("07", "x")),
      [REGION_OP]: () => json(errorBody("07", "x")),
      [EORDER_OP]: () => json(errorBody("07", "x")),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect([outcome.rows, outcome.failures.length, outcome.calls]).toEqual([EMPTY_AUX_ROWS, 3, 3]);
  });

  it("오류 메시지가 서비스키를 되돌려 줘도 detail 에 키가 없다", async () => {
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () =>
        json(errorBody("07", `serviceKey=${SERVICE_KEY} ${encodeURIComponent(SERVICE_KEY)}`)),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    const detail = outcome.failures.map(({ failure }) => failure.detail).join("\n");
    for (const form of SECRET_FORMS) expect(detail).not.toContain(form);
  });

  it("실패 detail 어디에도 요청 URL 이 없다", async () => {
    const { fetch } = routedFetch({
      ...ALL_OK,
      [LICENSE_OP]: () => json({}, 500),
    });

    const outcome = await fetcherWith(fetch).fetchAux(REQUEST);

    expect(JSON.stringify(outcome.failures)).not.toContain("apis.data.go.kr");
  });
});

// 녹음 재생(07 §2.3): fixtures/recorded/15129394 의 보조 조회 4파일. 복사·수정하지 않고 읽기만 한다.
// 기대 수의 출처: 녹음 파일을 구현과 따로 파이썬으로 세었다(C1 증거 §5 와 같다).
describe("G2bAuxFetcher — 녹음 재생(R26BK01756112)", () => {
  const load = async (): Promise<RecordedResponse[]> =>
    Promise.all(AUX_RECORDINGS.map((file) => loadRecordedResponse(join(RECORDED_DIR, file))));
  const recordedFetcher = async () =>
    createRecordedAuxFetcher({ recordings: await load(), retry: deps().retry });
  const recordedRequest = {
    noticeId: RECORDED_NOTICE_NO,
    amendmentNo: "000",
    registeredAt: new Date("2026-10-12T00:00:22.000Z"),
  };

  it("면허제한은 inqryDiv=2 녹음(4행), 참가가능지역 0행, e발주 첨부 3행이고 실패 0·호출 3 이다", async () => {
    const outcome = await (await recordedFetcher()).fetchAux(recordedRequest);

    expect([
      outcome.rows.licenseLimit.length,
      outcome.rows.region.length,
      outcome.rows.eorderAttach.length,
      outcome.failures,
      outcome.calls,
    ]).toEqual([4, 0, 3, [], 3]);
  });

  it("면허제한 4행은 모두 이 공고의 행이고 lcnsLmtNm 은 정보통신공사업/0036 ×2·소프트웨어사업자 ×2 다", async () => {
    const outcome = await (await recordedFetcher()).fetchAux(recordedRequest);

    expect(outcome.rows.licenseLimit.map((row) => row.bidNtceNo)).toEqual(
      Array.from({ length: 4 }, () => RECORDED_NOTICE_NO),
    );
    expect(outcome.rows.licenseLimit.map((row) => row.lcnsLmtNm).sort()).toEqual([
      "소프트웨어사업자(컴퓨터관련서비스사업)/1468",
      "소프트웨어사업자(패키지소프트웨어개발.공급사업)/1426",
      "정보통신공사업/0036",
      "정보통신공사업/0036",
    ]);
  });

  it("e발주 첨부 3행의 URL 은 모두 www.g2b.go.kr 의 downloadRfpFile.do 다", async () => {
    const outcome = await (await recordedFetcher()).fetchAux(recordedRequest);

    for (const row of outcome.rows.eorderAttach) {
      const url = new URL(String(row.eorderAtchFileUrl));
      expect([url.hostname, url.pathname]).toEqual([
        "www.g2b.go.kr",
        "/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do",
      ]);
    }
  });

  it("inqryDiv=2 녹음이 없는 공고는 창 녹음(inqryDiv=1)에서 그 공고의 행만 고른다(R26BK01764257 면허제한 2행)", async () => {
    const outcome = await (
      await recordedFetcher()
    ).fetchAux({
      ...recordedRequest,
      noticeId: "R26BK01764257",
    });

    expect(outcome.rows.licenseLimit.map((row) => [row.lmtGrpNo, row.lcnsLmtNm])).toEqual([
      ["1", "제작자 등(자동차-국내 제작·조립)/5898"],
      ["2", "자동차관리사업(자동차매매업)/5814"],
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it("재생 결과 어디에도 담당자 필드 키가 없다", async () => {
    const outcome = await (await recordedFetcher()).fetchAux(recordedRequest);

    const stored = JSON.stringify(outcome.rows);
    for (const field of [
      "ntceInsttOfclNm",
      "ntceInsttOfclTelNo",
      "ntceInsttOfclEmailAdrs",
      "ofclNm",
    ]) {
      expect(stored).not.toContain(`"${field}"`);
    }
  });

  it("재생은 전역 fetch 를 부르지 않고 재생용 가짜 키를 쓴다", async () => {
    await (await recordedFetcher()).fetchAux(recordedRequest);

    expect(globalFetch).not.toHaveBeenCalled();
    expect(RECORDED_REPLAY_SERVICE_KEY).not.toContain("%");
  });
});
