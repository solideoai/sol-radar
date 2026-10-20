import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchPageInput, FetchPageOutcome, G2bItem } from "./connector.model";
import { isInfoBizNoticeStrict } from "./g2b-filter";
import { G2B_CONTACT_FIELDS, parseG2bEnvelope } from "./g2b.model";
import { createMemoryIngestionRepo, type MemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import {
  RECORDED_REPLAY_SERVICE_KEY,
  createRecordedApiConnector,
  createRecordedFetch,
  findRecording,
  loadRecordedResponse,
  parseRecordedResponse,
  toG2bEnvelopeBody,
  type RecordedResponse,
} from "./recorded-api";
import type { RetryDeps } from "./retry";

// RecordedApiConnector(C3 계약 Stage 4, 07 §2.1·§2.3, 11 §3.3 ①).
// fixtures/recorded/ 의 녹음 파일은 2026-10-19 실제 응답을 담당자 필드만 가린 사본이다. 복사·수정하지 않고 읽기만 한다.
//
// 기대 수의 출처: 녹음 파일을 구현과 따로 파이썬으로 세었다(2026-10-19, worktree cef039e 의 fixtures/recorded).
// 필터·정규화 규칙은 계약 Stage 3 문구 그대로 옮겨 셌다(구현을 돌려 얻은 값이 아니다).

const RECORDED_DIR = fileURLToPath(new URL("../../../fixtures/recorded/", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

const LIST_10 = "15129394/getBidPblancListInfoServc.20261019.masked.json";
const LIST_7D = "15129394/getBidPblancListInfoServc.20261019.7d-p1.masked.json";
const LIST_ERROR_07 = "15129394/getBidPblancListInfoServc.20261019.error07.masked.json";
const INDUSTRY_PAGES = [1, 2, 3].map(
  (page) => `15129467/getIndstrytyBaseLawrgltInfoList.20261019.p${page}.masked.json`,
);

// 녹음 파일 14개와 봉투 요약(파일의 envelope·resultCode·items 길이·totalCount 를 직접 센 값).
type EnvelopeExpectation =
  | { file: string; envelope: "response"; resultCode: "00"; items: number; totalCount: number }
  | { file: string; envelope: "error"; resultCode: string; resultMsg: string };
const RECORDINGS: EnvelopeExpectation[] = [
  {
    file: "15129394/getBidPblancListInfoChgHstryServc.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 0,
    totalCount: 0,
  },
  {
    file: "15129394/getBidPblancListInfoEorderAtchFileInfo.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 19,
    totalCount: 19,
  },
  {
    file: "15129394/getBidPblancListInfoLicenseLimit.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 4,
    totalCount: 4,
  },
  {
    file: "15129394/getBidPblancListInfoLicenseLimit.20261019.window.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 219,
    totalCount: 219,
  },
  {
    file: "15129394/getBidPblancListInfoPrtcptPsblRgn.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 323,
    totalCount: 323,
  },
  { file: LIST_7D, envelope: "response", resultCode: "00", items: 100, totalCount: 3555 },
  { file: LIST_ERROR_07, envelope: "error", resultCode: "07", resultMsg: "입력범위값 초과 에러" },
  { file: LIST_10, envelope: "response", resultCode: "00", items: 10, totalCount: 84 },
  {
    file: "15129437/getPublicPrcureThngInfoServc.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 10,
    totalCount: 44,
  },
  {
    file: "15129462/getOrderPlanSttusListServc.20261019.error08.masked.json",
    envelope: "error",
    resultCode: "08",
    resultMsg: "필수값 입력 에러",
  },
  {
    file: "15129462/getOrderPlanSttusListServc.20261019.masked.json",
    envelope: "response",
    resultCode: "00",
    items: 10,
    totalCount: 82,
  },
  { file: INDUSTRY_PAGES[0], envelope: "response", resultCode: "00", items: 999, totalCount: 2916 },
  { file: INDUSTRY_PAGES[1], envelope: "response", resultCode: "00", items: 999, totalCount: 2916 },
  { file: INDUSTRY_PAGES[2], envelope: "response", resultCode: "00", items: 918, totalCount: 2916 },
];
const RECORDING_FILES = RECORDINGS.map((recording) => recording.file);

// LIST_10(10건, totalCount 84, numOfRows 10)을 센 값.
// - broad 필터 통과 1건: R26BK01748897 차수 001 취소공고(infoBizYn "", 낙찰방법 "(SW사업)", 분류 정보시스템유지관리서비스). strict(infoBizYn Y) 통과 0건
// - 그 1건: 필수 필드·ntceKindNm·https sourceUrl 모두 있어 격리 0건. bidClseDt 2026-10-15 10:00:00 < bidNtceDt 2026-10-19 08:14:29 → DATE_ORDER 1건
const LIST_10_BROAD_NOTICE_NO = "R26BK01748897";
const LIST_10_BROAD = 1;
const LIST_10_STRICT = 0;

// LIST_7D(100건, totalCount 3555, numOfRows 100)를 센 값. 필터를 끄면 100건 모두 정규화되고 격리 0건.
// - ntceKindNm: 등록공고 82·재공고 9·변경공고 7·취소공고 2 → status OPEN 91·AMENDED 7·CANCELLED 2
// - bidClseDt 빈 문자열 19건(나머지 81건은 모두 "YYYY-MM-DD HH:mm:ss") → deadlineAt null 19, DATE_UNPARSED 0
// - asignBdgtAmt 100건 모두 숫자 문자열 → 메모 "budgetKrw: asignBdgtAmt 사용" 100, presmptPrce 메모 0
// - orderPlanUntyNo 비어 있지 않음 76건, bfSpecRgstNo 비어 있지 않음 64건
// - broad 통과 15건(infoBizYn Y 6 + SW사업 표기 6 + 분류 키워드만 3), strict 통과 6건
// - broad 15건 안에서 R26BK01749267 이 차수 000 등록공고(13번째 행) → 차수 001 변경공고(51번째 행)로 두 번 나온다 → 공고 14개
const LIST_7D_TOTAL = 100;
const LIST_7D_KIND_COUNTS = { 등록공고: 82, 재공고: 9, 변경공고: 7, 취소공고: 2 };
const LIST_7D_STATUS_COUNTS = { OPEN: 91, AMENDED: 7, CANCELLED: 2 };
const LIST_7D_DEADLINE_NULL = 19;
const LIST_7D_ASIGN_NOTES = 100;
const LIST_7D_PLAN_REF = 76;
const LIST_7D_PRE_SPEC_REF = 64;
const LIST_7D_BROAD = 15;
const LIST_7D_STRICT = 6;

// KST 2026-10-19 하루 = 조각 하나
const ONE_DAY = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
const FIRST_PAGE: FetchPageInput = { ...ONE_DAY, cursor: null };
const NORMALIZED_AT = new Date("2026-10-19T09:00:00.000Z");
const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const ASIGN_NOTE = "budgetKrw: asignBdgtAmt 사용";
const PRESMPT_NOTE = "budgetKrw: presmptPrce 사용(asignBdgtAmt 없음)";
const REPLAY_KEY_FORMS = [
  RECORDED_REPLAY_SERVICE_KEY,
  encodeURIComponent(RECORDED_REPLAY_SERVICE_KEY),
  new URLSearchParams({ k: RECORDED_REPLAY_SERVICE_KEY }).toString().slice("k=".length),
];

const pathOf = (file: string): string => join(RECORDED_DIR, file);
const load = (file: string): Promise<RecordedResponse> => loadRecordedResponse(pathOf(file));
// 시험 쪽 기대값 계산용 원문. 대상 모듈을 거치지 않고 파일을 그대로 읽는다.
const readRaw = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(pathOf(file), "utf8")) as Record<string, unknown>;

const pageOf = (outcome: FetchPageOutcome) => {
  if (!outcome.ok) throw new Error(`재생 성공을 기대했다: ${outcome.failure.kind}`);
  return outcome.page;
};
const itemsOf = (outcome: FetchPageOutcome): G2bItem[] =>
  pageOf(outcome).records.flatMap((record) =>
    record.kind === "g2b-bid-notice" ? [record.item] : [],
  );

const replayItems = async (
  file: string,
  isInfoBizNotice?: (item: G2bItem) => boolean,
): Promise<G2bItem[]> => {
  const connector = createRecordedApiConnector({
    recordings: [await load(file)],
    ...(isInfoBizNotice ? { isInfoBizNotice } : {}),
  });
  return itemsOf(await connector.fetchPage(FIRST_PAGE));
};
const normalizeAll = (items: readonly G2bItem[]) =>
  items.map((item) => normalizeG2bBidNotice(item, { fetchedAt: NORMALIZED_AT }));
const draftsOf = (outcomes: ReturnType<typeof normalizeAll>) =>
  outcomes.flatMap((outcome) => (outcome.ok ? [outcome.draft] : []));
const countBy = (values: readonly string[]): Record<string, number> =>
  values.reduce<Record<string, number>>(
    (counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }),
    {},
  );
const contactKeysIn = (json: string): string[] =>
  G2B_CONTACT_FIELDS.filter((field) => json.includes(`"${field}"`));

const requestUrl = (operation: string, pageNo: number): string =>
  `${ENDPOINT}/${operation}?${new URLSearchParams({ serviceKey: RECORDED_REPLAY_SERVICE_KEY, type: "json", pageNo: String(pageNo), numOfRows: "10" })}`;
const replayInit = () => ({ signal: new AbortController().signal });

const deps = (): RetryDeps => ({ sleep: vi.fn(async () => undefined), random: () => 0 });
const ingestRecorded = async (repo: MemoryIngestionRepo, file: string, jobKey: string, now: Date) =>
  runIngest({
    connector: createRecordedApiConnector({ recordings: [await load(file)] }),
    repo,
    run: {
      source: "g2b",
      runMode: "MOCK",
      jobKey,
      trigger: "MANUAL",
      batch: null,
      params: { window: ONE_DAY },
    },
    anchor: new Date("2026-10-19T03:00:00.000Z"),
    now: () => now,
    retry: deps(),
    secrets: [RECORDED_REPLAY_SERVICE_KEY],
  });

const globalFetch = vi.fn(async () => {
  throw new Error("녹음 재생은 실제 네트워크를 부르면 안 된다");
});

beforeEach(() => {
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalFetch.mockClear();
});

describe("녹음 파일", () => {
  it("fixtures/recorded 에는 녹음 파일 14개가 있다", () => {
    // train/ 은 X6a 학습용 녹음이다. 저장소에 넣지 않으므로(.gitignore) 로컬에 있어도 세지 않는다
    const files = readdirSync(RECORDED_DIR, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.split("\\").join("/"))
      .filter((file) => !file.startsWith("train/"))
      .sort();

    expect(files).toEqual([...RECORDING_FILES].sort());
  });

  it.each(RECORDING_FILES)("%s 는 parseRecordedResponse 를 통과한다", (file) => {
    expect(() => parseRecordedResponse(readRaw(file))).not.toThrow();
  });

  it.each(RECORDING_FILES)("%s 는 loadRecordedResponse 로 읽힌다", async (file) => {
    await expect(load(file)).resolves.toMatchObject({ schemaVersion: "sol-recorded/v0.1" });
  });

  it.each(RECORDING_FILES)("%s 의 params 에 servicekey 이름의 키가 없다", async (file) => {
    const recording = await load(file);

    expect(
      Object.keys(recording.params).filter((key) => key.toLowerCase() === "servicekey"),
    ).toEqual([]);
  });

  it.each(RECORDINGS)(
    "$file 는 toG2bEnvelopeBody → parseG2bEnvelope 결과가 녹음의 resultCode·items 수와 맞다",
    async (expected) => {
      const envelope = parseG2bEnvelope(toG2bEnvelopeBody(await load(expected.file)));

      if (expected.envelope === "response") {
        expect(envelope.ok && [envelope.items.length, envelope.totalCount]).toEqual([
          expected.items,
          expected.totalCount,
        ]);
      } else {
        expect(envelope).toEqual({
          ok: false,
          kind: "RESULT_CODE",
          resultCode: expected.resultCode,
          resultMsg: expected.resultMsg,
        });
      }
    },
  );
});

describe("parseRecordedResponse — 거부", () => {
  const base = (): Record<string, unknown> => structuredClone(readRaw(LIST_10));
  const withParams = (params: Record<string, unknown>): Record<string, unknown> => {
    const recording = base();
    return {
      ...recording,
      params: { ...(recording.params as Record<string, unknown>), ...params },
    };
  };
  const messageOf = (json: unknown): string => {
    try {
      parseRecordedResponse(json);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("거부를 기대했는데 통과했다");
  };

  it("모르는 키가 있으면 던진다", () => {
    expect(() => parseRecordedResponse({ ...base(), extra: true })).toThrow();
  });

  it("필수 키(rawSha256)가 없으면 던진다", () => {
    const { rawSha256: _omitted, ...rest } = base();
    void _omitted;

    expect(() => parseRecordedResponse(rest)).toThrow();
  });

  it("params 값이 문자열이 아니면 던진다", () => {
    expect(() => parseRecordedResponse(withParams({ pageNo: 1 }))).toThrow();
  });

  it.each(["serviceKey", "ServiceKey", "SERVICEKEY"])("params 에 %s 가 있으면 던진다", (key) => {
    expect(() => parseRecordedResponse(withParams({ [key]: "leaked-key-value" }))).toThrow();
  });

  it("response 봉투인데 totalCount 가 null 이면 던진다", () => {
    expect(() => parseRecordedResponse({ ...base(), totalCount: null })).toThrow();
  });

  it("envelope 가 두 가지 밖이면 던진다", () => {
    expect(() => parseRecordedResponse({ ...base(), envelope: "xml" })).toThrow();
  });

  it("거부 메시지에 params 의 서비스키 값을 넣지 않는다", () => {
    expect(messageOf(withParams({ serviceKey: "LEAKED-KEY-1234" }))).not.toContain(
      "LEAKED-KEY-1234",
    );
  });

  it("거부 메시지에 잘못된 필드 값을 넣지 않는다", () => {
    expect(messageOf({ ...base(), httpStatus: "WRONG-VALUE-5678" })).not.toContain(
      "WRONG-VALUE-5678",
    );
  });
});

describe("loadRecordedResponse — 실패", () => {
  it("파일이 없으면 reject 한다", async () => {
    await expect(loadRecordedResponse(pathOf("15129394/없는-파일.masked.json"))).rejects.toThrow();
  });

  it("JSON 이 아닌 파일이면 reject 한다", async () => {
    await expect(loadRecordedResponse(join(FIXTURES_DIR, "manifest.yaml"))).rejects.toThrow();
  });

  it("녹음 형식이 아닌 JSON 이면 reject 한다", async () => {
    await expect(loadRecordedResponse(join(FIXTURES_DIR, "bids", "FX-01.json"))).rejects.toThrow();
  });
});

describe("toG2bEnvelopeBody", () => {
  it("response 녹음은 params 의 pageNo·numOfRows 를 숫자로 담은 정상 봉투가 된다", async () => {
    const raw = readRaw(LIST_10);

    expect(toG2bEnvelopeBody(await load(LIST_10))).toEqual({
      response: {
        header: { resultCode: "00", resultMsg: "정상" },
        body: { items: raw.items, numOfRows: 10, pageNo: 1, totalCount: 84 },
      },
    });
  });

  it("오류 녹음은 nkoneps 오류 봉투가 된다", async () => {
    expect(toG2bEnvelopeBody(await load(LIST_ERROR_07))).toEqual({
      "nkoneps.com.response.ResponseError": {
        header: { resultCode: "07", resultMsg: "입력범위값 초과 에러" },
      },
    });
  });
});

describe("createRecordedFetch", () => {
  it("오퍼레이션과 pageNo 가 같은 녹음을 toG2bEnvelopeBody JSON 으로 돌려준다", async () => {
    const recording = await load(LIST_10);
    const fetch = createRecordedFetch([recording]);

    const response = await fetch(requestUrl("getBidPblancListInfoServc", 1), replayInit());

    expect(await response.json()).toEqual(toG2bEnvelopeBody(recording));
  });

  it("응답 status 는 녹음의 httpStatus 이고 content-type 은 application/json 이다", async () => {
    const fetch = createRecordedFetch([await load(LIST_10)]);

    const response = await fetch(requestUrl("getBidPblancListInfoServc", 1), replayInit());

    expect([
      response.status,
      response.headers.get("content-type")?.includes("application/json"),
    ]).toEqual([200, true]);
  });

  it("pageNo 쿼리로 같은 오퍼레이션의 녹음을 고른다", async () => {
    const fetch = createRecordedFetch(await Promise.all(INDUSTRY_PAGES.map(load)));

    const response = await fetch(requestUrl("getIndstrytyBaseLawrgltInfoList", 3), replayInit());

    // p3 녹음은 918건이다(p1·p2 는 999건).
    const envelope = parseG2bEnvelope(await response.json());
    expect(envelope.ok ? envelope.items.length : null).toBe(918);
  });

  it("pageNo 가 맞는 녹음이 없으면 404 다", async () => {
    const fetch = createRecordedFetch([await load(LIST_10)]);

    const response = await fetch(requestUrl("getBidPblancListInfoServc", 2), replayInit());

    expect(response.status).toBe(404);
  });

  it("오퍼레이션이 맞는 녹음이 없으면 404 다", async () => {
    const fetch = createRecordedFetch([await load(LIST_10)]);

    const response = await fetch(requestUrl("getBidPblancListInfoChgHstryServc", 1), replayInit());

    expect(response.status).toBe(404);
  });

  it("받은 URL(키 포함)을 콘솔에 쓰지 않는다", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const fetch = createRecordedFetch([await load(LIST_10)]);

    await fetch(requestUrl("getBidPblancListInfoServc", 1), replayInit());
    await fetch(requestUrl("getBidPblancListInfoServc", 2), replayInit());

    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });

  it("전역 fetch 를 부르지 않는다", async () => {
    const fetch = createRecordedFetch([await load(LIST_10)]);

    await fetch(requestUrl("getBidPblancListInfoServc", 1), replayInit());

    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("RecordedApiConnector — 입찰공고 목록 10건 녹음", () => {
  it("source 는 g2b 다", async () => {
    expect(createRecordedApiConnector({ recordings: [await load(LIST_10)] }).source).toBe("g2b");
  });

  it("첫 페이지를 재생하면 ok 이고 nextCursor 는 0:2 다(84 > 1×10)", async () => {
    const connector = createRecordedApiConnector({ recordings: [await load(LIST_10)] });

    expect(pageOf(await connector.fetchPage(FIRST_PAGE)).nextCursor).toBe("0:2");
  });

  it("numOfRows 를 100 으로 주면 1×100 ≥ 84 라 nextCursor 는 null 이다", async () => {
    const connector = createRecordedApiConnector({
      recordings: [await load(LIST_10)],
      numOfRows: 100,
    });

    expect(pageOf(await connector.fetchPage(FIRST_PAGE)).nextCursor).toBeNull();
  });

  it(`기본(broad) 필터를 통과한 레코드는 ${LIST_10_BROAD}건(${LIST_10_BROAD_NOTICE_NO})이다`, async () => {
    const items = await replayItems(LIST_10);

    expect(items.map((item) => item.bidNtceNo)).toEqual([LIST_10_BROAD_NOTICE_NO]);
  });

  it(`strict 필터를 통과한 레코드는 ${LIST_10_STRICT}건이다`, async () => {
    expect(await replayItems(LIST_10, isInfoBizNoticeStrict)).toHaveLength(LIST_10_STRICT);
  });

  it("broad 레코드는 normalizeG2bBidNotice 로 1건 통과·0건 격리된다", async () => {
    const outcomes = normalizeAll(await replayItems(LIST_10));

    expect(countBy(outcomes.map((outcome) => (outcome.ok ? "ok" : "quarantined")))).toEqual({
      ok: 1,
    });
  });

  it("broad 레코드(취소공고)는 status CANCELLED 로 정규화된다", async () => {
    const [draft] = draftsOf(normalizeAll(await replayItems(LIST_10)));

    expect(draft?.status).toBe("CANCELLED");
  });

  it("broad 레코드는 마감이 공고일보다 일러 DATE_ORDER 경고 하나를 낸다", async () => {
    const [outcome] = normalizeAll(await replayItems(LIST_10));

    expect(outcome?.ok && outcome.warnings.map((warning) => warning.code)).toEqual(["DATE_ORDER"]);
  });

  it("필터를 끄면 10건 모두 정규화되고 DATE_ORDER 경고는 1건이다", async () => {
    const outcomes = normalizeAll(await replayItems(LIST_10, () => true));

    expect([
      draftsOf(outcomes).length,
      outcomes
        .flatMap((outcome) => (outcome.ok ? outcome.warnings : []))
        .filter((warning) => warning.code === "DATE_ORDER").length,
    ]).toEqual([10, 1]);
  });

  it("레코드 item 에 담당자 필드 키가 없다", async () => {
    expect(contactKeysIn(JSON.stringify(await replayItems(LIST_10, () => true)))).toEqual([]);
  });

  it("재생은 전역 fetch 를 부르지 않는다", async () => {
    await replayItems(LIST_10);

    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("RecordedApiConnector — 입찰공고 목록 7일 100건 녹음", () => {
  const allDrafts = async () => draftsOf(normalizeAll(await replayItems(LIST_7D, () => true)));

  it(`필터를 끄면 ${LIST_7D_TOTAL}건 모두 정규화되고 격리는 0건이다`, async () => {
    const outcomes = normalizeAll(await replayItems(LIST_7D, () => true));

    expect(countBy(outcomes.map((outcome) => (outcome.ok ? "ok" : "quarantined")))).toEqual({
      ok: LIST_7D_TOTAL,
    });
  });

  it("ntceKindNm 원문 분포는 등록 82·재공고 9·변경 7·취소 2 다", async () => {
    expect(countBy((await allDrafts()).map((draft) => draft.original.status ?? "없음"))).toEqual(
      LIST_7D_KIND_COUNTS,
    );
  });

  it("status 는 OPEN 91(등록 82 + 재공고 9)·AMENDED 7·CANCELLED 2 다", async () => {
    expect(countBy((await allDrafts()).map((draft) => draft.status))).toEqual(
      LIST_7D_STATUS_COUNTS,
    );
  });

  it(`bidClseDt 가 빈 ${LIST_7D_DEADLINE_NULL}건은 deadlineAt 이 null 이다`, async () => {
    expect((await allDrafts()).filter((draft) => draft.deadlineAt === null)).toHaveLength(
      LIST_7D_DEADLINE_NULL,
    );
  });

  it("빈 bidClseDt 는 DATE_UNPARSED 경고를 내지 않는다", async () => {
    const outcomes = normalizeAll(await replayItems(LIST_7D, () => true));

    expect(
      outcomes
        .flatMap((outcome) => (outcome.ok ? outcome.warnings : []))
        .filter((warning) => warning.code === "DATE_UNPARSED"),
    ).toEqual([]);
  });

  it(`asignBdgtAmt 메모는 ${LIST_7D_ASIGN_NOTES}건, presmptPrce 메모는 0건이다`, async () => {
    const notes = (await allDrafts()).flatMap((draft) => draft.normalizationNotes ?? []);

    expect([
      notes.filter((note) => note === ASIGN_NOTE).length,
      notes.filter((note) => note === PRESMPT_NOTE).length,
    ]).toEqual([LIST_7D_ASIGN_NOTES, 0]);
  });

  it(`planRef 는 ${LIST_7D_PLAN_REF}건, preSpecRef 는 ${LIST_7D_PRE_SPEC_REF}건에 있다`, async () => {
    const drafts = await allDrafts();

    expect([
      drafts.filter((draft) => "planRef" in draft).length,
      drafts.filter((draft) => "preSpecRef" in draft).length,
    ]).toEqual([LIST_7D_PLAN_REF, LIST_7D_PRE_SPEC_REF]);
  });

  it("정규화 결과 JSON 에 담당자 필드 키가 0회다", async () => {
    expect(
      contactKeysIn(JSON.stringify(normalizeAll(await replayItems(LIST_7D, () => true)))),
    ).toEqual([]);
  });

  it(`기본(broad) 필터 통과는 ${LIST_7D_BROAD}건이다`, async () => {
    expect(await replayItems(LIST_7D)).toHaveLength(LIST_7D_BROAD);
  });

  it(`strict 필터 통과는 ${LIST_7D_STRICT}건이다`, async () => {
    expect(await replayItems(LIST_7D, isInfoBizNoticeStrict)).toHaveLength(LIST_7D_STRICT);
  });

  it("재생 레코드 JSON 에 담당자 필드 키가 0회다", async () => {
    expect(contactKeysIn(JSON.stringify(await replayItems(LIST_7D, () => true)))).toEqual([]);
  });
});

describe("RecordedApiConnector — 오류 07 녹음", () => {
  const replayError = async () => {
    const outcome = await createRecordedApiConnector({
      recordings: [await load(LIST_ERROR_07)],
    }).fetchPage(FIRST_PAGE);
    if (outcome.ok) throw new Error("오류 재생을 기대했는데 성공했다");
    return outcome.failure;
  };

  it("RESULT_CODE 이고 resultCode 는 07 이다", async () => {
    const failure = await replayError();

    expect([failure.kind, failure.resultCode]).toEqual(["RESULT_CODE", "07"]);
  });

  it("실패 결과에 재생용 키·URL 이 없다", async () => {
    const json = JSON.stringify(await replayError());

    for (const form of REPLAY_KEY_FORMS) expect(json).not.toContain(form);
    expect(json).not.toMatch(/servicekey/i);
    expect(json).not.toContain("apis.data.go.kr");
  });
});

describe("runIngest — 녹음 Connector", () => {
  const FIRST_NOW = new Date("2026-10-19T09:00:00.000Z");
  const LATER_NOW = new Date("2026-10-19T10:00:00.000Z");

  it(`10건 녹음을 처음 수집하면 created 는 정규화 통과 수 ${LIST_10_BROAD} 다`, async () => {
    const result = await ingestRecorded(
      createMemoryIngestionRepo(),
      LIST_10,
      "recorded:1",
      FIRST_NOW,
    );

    expect(result.summary).toMatchObject({ created: LIST_10_BROAD, changed: 0, quarantined: 0 });
  });

  it(`같은 10건 녹음을 다른 jobKey 로 다시 수집하면 skippedDuplicate ${LIST_10_BROAD}·created 0 이다`, async () => {
    const repo = createMemoryIngestionRepo();
    await ingestRecorded(repo, LIST_10, "recorded:1", FIRST_NOW);

    const second = await ingestRecorded(repo, LIST_10, "recorded:2", LATER_NOW);

    expect(second.summary).toMatchObject({
      created: 0,
      changed: 0,
      skippedDuplicate: LIST_10_BROAD,
    });
  });

  it("녹음에 없는 다음 쪽(0:2)은 404 라 run 은 FAILED 다", async () => {
    const result = await ingestRecorded(
      createMemoryIngestionRepo(),
      LIST_10,
      "recorded:1",
      FIRST_NOW,
    );

    expect(result.status).toBe("FAILED");
  });

  it("녹음에 없는 다음 쪽은 API_HTTP_ERROR 로 기록한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestRecorded(repo, LIST_10, "recorded:1", FIRST_NOW);

    expect(repo.state.errors.map((error) => error.errorCode)).toContain("API_HTTP_ERROR");
  });

  it("10건 녹음의 DATE_ORDER 경고를 기록한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestRecorded(repo, LIST_10, "recorded:1", FIRST_NOW);

    expect(repo.state.errors.map((error) => error.errorCode)).toContain("DATE_ORDER");
  });

  it("7일 녹음을 처음 수집하면 공고 14개 created, 같은 페이지의 변경공고 1건 changed 다", async () => {
    const result = await ingestRecorded(
      createMemoryIngestionRepo(),
      LIST_7D,
      "recorded:1",
      FIRST_NOW,
    );

    expect(result.summary).toMatchObject({ created: 14, changed: 1, cancelled: 0, quarantined: 0 });
  });

  // 07 §5: 동일 payload 재수신은 revision 도 이벤트도 만들지 않는다. 같은 페이지에 원공고(000)와 변경공고(001)가 함께 있어도
  // 다시 받은 15건은 모두 이미 받은 payload 다.
  it(`같은 7일 녹음을 다른 jobKey 로 다시 수집하면 skippedDuplicate ${LIST_7D_BROAD}·created 0·changed 0 이다`, async () => {
    const repo = createMemoryIngestionRepo();
    await ingestRecorded(repo, LIST_7D, "recorded:1", FIRST_NOW);

    const second = await ingestRecorded(repo, LIST_7D, "recorded:2", LATER_NOW);

    expect(second.summary).toMatchObject({
      created: 0,
      changed: 0,
      skippedDuplicate: LIST_7D_BROAD,
    });
  });

  it("녹음 수집은 전역 fetch 를 부르지 않는다", async () => {
    await ingestRecorded(createMemoryIngestionRepo(), LIST_10, "recorded:1", FIRST_NOW);

    expect(globalFetch).not.toHaveBeenCalled();
  });
});

// 보조 조회 재생: 같은 bidNtceNo 로 녹음한 것(inqryDiv=2)을 먼저, 없으면 창 녹음(inqryDiv=1, bidNtceNo 없음)을 돌려준다.
describe("findRecording — 보조 조회의 bidNtceNo 매칭", () => {
  const LICENSE_EXACT = "15129394/getBidPblancListInfoLicenseLimit.20261019.masked.json";
  const LICENSE_WINDOW = "15129394/getBidPblancListInfoLicenseLimit.20261019.window.masked.json";
  const REGION_WINDOW = "15129394/getBidPblancListInfoPrtcptPsblRgn.20261019.masked.json";
  const licenseRequest = (bidNtceNo: string | null) => ({
    operation: "getBidPblancListInfoLicenseLimit",
    pageNo: "1",
    bidNtceNo,
  });
  const auxUrl = (operation: string, bidNtceNo: string): string =>
    `${ENDPOINT}/${operation}?${new URLSearchParams({ serviceKey: RECORDED_REPLAY_SERVICE_KEY, type: "json", pageNo: "1", numOfRows: "999", inqryDiv: "2", bidNtceNo })}`;

  it("같은 bidNtceNo 로 녹음한 것이 있으면 그것이다(창 녹음이 앞에 있어도)", async () => {
    const recordings = [await load(LICENSE_WINDOW), await load(LICENSE_EXACT)];

    expect(findRecording(recordings, licenseRequest("R26BK01756112"))?.params.inqryDiv).toBe("2");
  });

  it("같은 bidNtceNo 녹음이 없으면 bidNtceNo 없는 창 녹음이다", async () => {
    const recordings = [await load(LICENSE_EXACT), await load(LICENSE_WINDOW)];

    expect(findRecording(recordings, licenseRequest("R26BK01764257"))?.params.inqryDiv).toBe("1");
  });

  it("bidNtceNo 없는 요청(목록)은 bidNtceNo 로 녹음한 것을 고르지 않는다", async () => {
    const recordings = [await load(LICENSE_EXACT)];

    expect(findRecording(recordings, licenseRequest(null))).toBeUndefined();
  });

  it("오퍼레이션이 다르면 bidNtceNo 가 같아도 고르지 않는다", async () => {
    const recordings = [await load(LICENSE_EXACT)];

    expect(
      findRecording(recordings, {
        ...licenseRequest("R26BK01756112"),
        operation: "getBidPblancListInfoPrtcptPsblRgn",
      }),
    ).toBeUndefined();
  });

  it("createRecordedFetch 는 bidNtceNo 요청에 inqryDiv=2 녹음(4행)을 돌려준다", async () => {
    const fetch = createRecordedFetch([await load(LICENSE_WINDOW), await load(LICENSE_EXACT)]);

    const response = await fetch(
      auxUrl("getBidPblancListInfoLicenseLimit", "R26BK01756112"),
      replayInit(),
    );

    expect(parseG2bEnvelope(await response.json())).toMatchObject({ ok: true, totalCount: 4 });
  });

  it("createRecordedFetch 는 녹음에 없는 공고의 지역 요청에 창 녹음(323행)을 돌려준다(받는 쪽이 거른다)", async () => {
    const fetch = createRecordedFetch([await load(REGION_WINDOW)]);

    const response = await fetch(
      auxUrl("getBidPblancListInfoPrtcptPsblRgn", "R26BK01756112"),
      replayInit(),
    );

    expect(parseG2bEnvelope(await response.json())).toMatchObject({ ok: true, totalCount: 323 });
  });

  it("오퍼레이션 녹음이 아예 없으면 404 다", async () => {
    const fetch = createRecordedFetch([await load(LICENSE_EXACT)]);

    const response = await fetch(
      auxUrl("getBidPblancListInfoEorderAtchFileInfo", "R26BK01756112"),
      replayInit(),
    );

    expect(response.status).toBe(404);
  });
});
