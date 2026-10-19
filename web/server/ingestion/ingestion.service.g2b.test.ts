import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { G2bItem } from "./connector.model";
import type { IngestSummary, StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createOfficialApiConnector, type FetchLike } from "./official-api-connector";
import type { RetryDeps } from "./retry";

// 수집 흐름의 g2b 경로(C3 계약 Stage 3 ingestion.service 확장, 07 §3.1·§5, 15 §6, V2-03·V2-11).
// OfficialApiConnector 에 가짜 fetch 를 꽂고 메모리 저장소에 쌓는다. 실제 네트워크·Supabase 는 부르지 않는다.
// 응답 모양은 2026-10-19 실측 응답을 본떴고, 값은 모두 가상이다.

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [
  SERVICE_KEY,
  encodeURIComponent(SERVICE_KEY),
  encodeURIComponent(encodeURIComponent(SERVICE_KEY)),
];
const NOTICE_NO = "R26BK00000001";
// KST 2026-10-19 하루 = 조각 하나
const ONE_DAY = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
// KST 2026-10-18 00:00 ~ 2026-10-20 00:00 = 조각 둘
const TWO_DAYS = { from: "2026-10-17T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
const FIRST_NOW = new Date("2026-10-19T01:00:00.000Z");
const LATER_NOW = new Date("2026-10-19T07:00:00.000Z");
const ZERO: IngestSummary = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

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

const noticeRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  ntceKindNm: "등록공고",
  bidNtceDt: "2026-10-19 09:10:00",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  ntceInsttNm: "가상공고기관",
  dminsttNm: "가상수요기관",
  bidClseDt: "2026-11-23 12:00:00",
  asignBdgtAmt: "1264200000",
  presmptPrce: "1149272727",
  bidNtceDtlUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
  bidNtceUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
  ntceSpecDocUrl1: `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${NOTICE_NO}&fileSeq=1`,
  ntceSpecFileNm1: "1.제안요청서.pdf",
  infoBizYn: "Y",
  ...CONTACT,
  ...overrides,
});

const okEnvelope = (items: G2bItem[], totalCount = items.length) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, numOfRows: 100, pageNo: 1, totalCount },
  },
});
const errorEnvelope = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});
const respondWith =
  (body: unknown): FetchLike =>
  async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

const g2bRun = (jobKey: string, window: { from: string; to: string } = ONE_DAY): StartRunInput => ({
  source: "g2b",
  runMode: "LIVE",
  jobKey,
  trigger: "MANUAL",
  batch: null,
  params: { window },
});

const deps = () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  const retry: RetryDeps = { sleep, random: () => 0 };
  return { sleep, retry };
};

const ingestG2b = (
  repo: MemoryIngestionRepo,
  fetch: FetchLike,
  options: { jobKey: string; now?: Date; window?: { from: string; to: string }; retry?: RetryDeps },
) =>
  runIngest({
    connector: createOfficialApiConnector({ endpoint: ENDPOINT, serviceKey: SERVICE_KEY, fetch }),
    repo,
    run: g2bRun(options.jobKey, options.window),
    // anchor 는 fixture 에만 쓴다. g2b 경로가 쓰지 않는지 드러나게 동떨어진 값을 준다.
    anchor: new Date("2000-01-01T00:00:00.000Z"),
    now: () => options.now ?? FIRST_NOW,
    retry: options.retry ?? deps().retry,
    secrets: [SERVICE_KEY],
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

describe("runIngest — g2b 신규 공고", () => {
  it("새 g2b 공고를 CREATED 로 저장한다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), {
      jobKey: "g2b:1",
    });

    // 계약 5-D: checksum 은 저장한 revision 의 checksum, g2b 레코드의 fixtureId 는 null.
    // 계약 6-2: attachmentCount 는 중복 제거한 첨부 url 수(noticeRow 는 ntceSpecDocUrl1 하나).
    const [stored] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(result.saved).toEqual([
      {
        bidId: expect.any(String),
        revisionId: expect.any(String),
        noticeId: NOTICE_NO,
        kind: "CREATED",
        reanalyze: true,
        checksum: stored?.checksum,
        fixtureId: null,
        attachmentCount: 1,
      },
    ]);
  });

  it("새 g2b 공고 한 건의 요약은 created 1 이고 run 은 SUCCEEDED 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), {
      jobKey: "g2b:1",
    });

    expect([result.status, result.summary]).toEqual(["SUCCEEDED", { ...ZERO, created: 1 }]);
  });

  it("g2b 레코드는 g2b 정규화를 거쳐 source g2b-bid-notice·isDemo false 로 저장된다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([revision?.normalized.source, revision?.normalized.isDemo, revision?.revision]).toEqual([
      "g2b-bid-notice",
      false,
      1,
    ]);
  });

  it("g2b 공고의 fetchedAt 은 fixture anchor 가 아니라 now() 시각이다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), {
      jobKey: "g2b:1",
      now: LATER_NOW,
    });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(revision?.normalized.fetchedAt).toBe(LATER_NOW.toISOString());
  });

  it("g2b 공고의 deadlineAt 은 원문 KST 마감을 UTC 로 바꾼 값이다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(revision?.normalized.deadlineAt).toBe("2026-11-23T03:00:00.000Z");
  });

  it("rawPayload 에 담당자 필드가 없다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    const raw = JSON.stringify(revision?.rawPayload);
    for (const [key, value] of Object.entries(CONTACT)) {
      expect(raw).not.toContain(`"${key}"`);
      expect(raw).not.toContain(String(value));
    }
  });

  it("rawPayload 는 담당자 필드 말고는 원본 행을 그대로 담는다(ntceInsttNm 포함)", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    const publicFields = Object.fromEntries(
      Object.entries(noticeRow()).filter(([key]) => !(key in CONTACT)),
    );
    expect(revision?.rawPayload).toEqual(publicFields);
  });

  it("저장한 공고(normalized) 어디에도 담당자 필드 값이 없다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const stored = JSON.stringify(memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO));
    for (const value of Object.values(CONTACT)) expect(stored).not.toContain(String(value));
  });
});

describe("runIngest — g2b 재수집·취소", () => {
  it("같은 페이지를 다른 run 으로 다시 받으면 fetchedAt 이 달라도 DUPLICATE 로 건너뛴다", async () => {
    const repo = createMemoryIngestionRepo();
    const fetch = respondWith(okEnvelope([noticeRow()]));
    await ingestG2b(repo, fetch, { jobKey: "g2b:1", now: FIRST_NOW });

    const second = await ingestG2b(repo, fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([second.summary, second.saved]).toEqual([{ ...ZERO, skippedDuplicate: 1 }, []]);
  });

  it("같은 페이지를 다시 받아도 revision 은 하나뿐이다", async () => {
    const repo = createMemoryIngestionRepo();
    const fetch = respondWith(okEnvelope([noticeRow()]));
    await ingestG2b(repo, fetch, { jobKey: "g2b:1", now: FIRST_NOW });

    await ingestG2b(repo, fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect(memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO)).toHaveLength(1);
  });

  it("두 조각 경계에서 같은 행이 두 번 오면 한 번만 저장하고 하나는 DUPLICATE 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), {
      jobKey: "g2b:1",
      window: TWO_DAYS,
    });

    expect(result.summary).toEqual({ ...ZERO, created: 1, skippedDuplicate: 1 });
  });

  it("취소공고 행이 이전 revision 다음에 오면 CANCELLED 로 저장하고 재분석하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const second = await ingestG2b(
      repo,
      respondWith(okEnvelope([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      { jobKey: "g2b:2", now: LATER_NOW },
    );

    // 계약 5-D: checksum 은 저장한 revision 2 의 checksum, g2b 레코드의 fixtureId 는 null.
    // 계약 6-2: attachmentCount 는 중복 제거한 첨부 url 수(취소공고 행도 ntceSpecDocUrl1 하나).
    const [, cancelledRevision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(second.saved).toEqual([
      {
        bidId: expect.any(String),
        revisionId: expect.any(String),
        noticeId: NOTICE_NO,
        kind: "CANCELLED",
        reanalyze: false,
        checksum: cancelledRevision?.checksum,
        fixtureId: null,
        attachmentCount: 1,
      },
    ]);
  });

  it("취소공고는 같은 bid 의 revision 2 이고 status CANCELLED 다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    await ingestG2b(
      repo,
      respondWith(okEnvelope([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      { jobKey: "g2b:2", now: LATER_NOW },
    );

    expect(
      memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO).map((revision) => [
        revision.revision,
        revision.normalized.status,
      ]),
    ).toEqual([
      [1, "OPEN"],
      [2, "CANCELLED"],
    ]);
  });

  it("취소공고를 받은 run 의 요약은 cancelled 1 이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    const second = await ingestG2b(
      repo,
      respondWith(okEnvelope([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      { jobKey: "g2b:2", now: LATER_NOW },
    );

    expect(second.summary).toEqual({ ...ZERO, cancelled: 1 });
  });
});

describe("runIngest — g2b 공공 API 실패", () => {
  const RESULT_07 = errorEnvelope("07", "입력범위값 초과 에러");

  it("RESULT_CODE 실패는 errorCode API_RESULT_CODE 로 기록한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:1" });

    expect(repo.state.errors.map((error) => error.errorCode)).toEqual(["API_RESULT_CODE"]);
  });

  it("RESULT_CODE 실패는 resultCode 원문 07 을 기록한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:1" });

    expect(repo.state.errors.map((error) => error.resultCode)).toEqual(["07"]);
  });

  it("첫 페이지 실패의 sourceKey 는 g2b:page:start 다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:1" });

    expect(repo.state.errors.map((error) => error.sourceKey)).toEqual(["g2b:page:start"]);
  });

  it("첫 페이지부터 실패하면 run 은 FAILED 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:1" });

    expect(result.status).toBe("FAILED");
  });

  it("RESULT_CODE 는 재시도하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const { sleep, retry } = deps();

    const result = await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:1", retry });

    expect([sleep.mock.calls.length, result.summary.retried]).toEqual([0, 0]);
  });

  it("에러코드 22 는 errorCode API_QUOTA_EXCEEDED·resultCode 22 로 기록한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(errorEnvelope("22", "서비스 요청제한횟수 초과에러")), {
      jobKey: "g2b:1",
    });

    expect(repo.state.errors.map((error) => [error.errorCode, error.resultCode])).toEqual([
      ["API_QUOTA_EXCEEDED", "22"],
    ]);
  });

  it("오류 메시지가 서비스키를 되돌려 줘도 기록한 detail 에 키가 없다", async () => {
    const repo = createMemoryIngestionRepo();
    // 서버가 요청 값을 resultMsg 에 되돌려 주는 최악의 경우. connector detail 에 resultMsg 가 들어가므로 서비스가 가려야 한다.
    const echoed = errorEnvelope(
      "07",
      `입력범위값 초과 에러 serviceKey=${SERVICE_KEY} ${encodeURIComponent(SERVICE_KEY)}`,
    );

    await ingestG2b(repo, respondWith(echoed), { jobKey: "g2b:1" });

    const detail = repo.state.errors.map((error) => error.redactedDetail).join("\n");
    for (const form of SECRET_FORMS) expect(detail).not.toContain(form);
  });

  it("실패한 run 은 이미 저장한 공고를 건드리지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });
    const before = structuredClone(memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO));

    await ingestG2b(repo, respondWith(RESULT_07), { jobKey: "g2b:2", now: LATER_NOW });

    expect(memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO)).toEqual(before);
  });

  it("g2b 수집은 전역 fetch 를 부르지 않는다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, respondWith(okEnvelope([noticeRow()])), { jobKey: "g2b:1" });

    expect(globalFetch).not.toHaveBeenCalled();
  });
});
