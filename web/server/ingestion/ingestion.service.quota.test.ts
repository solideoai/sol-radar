import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { G2bItem } from "./connector.model";
import { createG2bAuxFetcher } from "./g2b-aux";
import type { FetchLike } from "./g2b-http";
import { G2B_AUX_OPERATIONS, G2B_BID_NOTICE_LIST_OPERATION } from "./g2b.model";
import type { IngestSummary, StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createOfficialApiConnector } from "./official-api-connector";
import { quotaKey } from "./quota";
import { createMemoryQuotaStore, type IngestQuota, type MemoryQuotaStore } from "./quota-store";
import type { RetryDeps } from "./retry";

// C8 M1·M2(07 §2.2 "호출 예산"·"확인 필요", §2.6 cursor 보존): 수집 흐름의 호출 예산과 보조 조회 표시.
// - 쪽을 부르기 전에 EXHAUSTED 면 목록 호출 0, run FAILED + ingest_errors QUOTA_EXCEEDED(g2b:quota).
// - 공고 앞에서 한도의 90% 이상이면 보조 조회를 부르지 않고 auxLookup SKIPPED_QUOTA 로 저장한다.
// - 어느 호출이든 결과코드 22 를 받으면 markExhausted 뒤 같은 run 의 남은 호출(남은 보조·다음 공고·다음 쪽)을 멈춘다.
//   저장한 공고는 그대로, run 은 FAILED(cursor 보존), 기록은 QUOTA_EXCEEDED 1건.
// - auxLookup 이 FAILED·SKIPPED_QUOTA 인 공고는 목록이 같아도 보조를 다시 불러 CHANGED 로 저장한다(또 실패하면 revision 없음).
// 목록·보조 조회 모두 가짜 fetch 로 받고 메모리 저장소·메모리 예산에 쌓는다. 실제 네트워크·Redis·Supabase 는 부르지 않는다.

const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const SERVICE_KEY = "TESTKEY+fake/value==";
const SERVICE_ID = "15129394";
const LIMIT = 1000;
const NOTICE_NO = "R26BK00000001";
const OTHER_NO = "R26BK00000002";
const ONE_DAY = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
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
const LIST_OP = G2B_BID_NOTICE_LIST_OPERATION;
const [LICENSE_OP, REGION_OP, EORDER_OP] = G2B_AUX_OPERATIONS.map(({ operation }) => operation);
const AUX_KEYS = G2B_AUX_OPERATIONS.map(({ registryKey }) => registryKey);
const RFP_URL = `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?rfpNo=R26DH00000001&rfpOrd=000&rfpUntyAtchFileNo=1`;
const LIST_DOC_URL = (noticeNo: string): string =>
  `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${noticeNo}&fileSeq=1`;

const noticeRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  ntceKindNm: "등록공고",
  bidNtceDt: "2026-10-19 09:10:00",
  rgstDt: "2026-10-19 09:10:03",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  dminsttNm: "가상수요기관",
  bidClseDt: "2026-11-23 12:00:00",
  asignBdgtAmt: "1264200000",
  bidNtceDtlUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
  ntceSpecDocUrl1: LIST_DOC_URL(NOTICE_NO),
  ntceSpecFileNm1: "1.제안요청서.pdf",
  infoBizYn: "Y",
  ...overrides,
});
const otherRow = (): G2bItem =>
  noticeRow({ bidNtceNo: OTHER_NO, ntceSpecDocUrl1: LIST_DOC_URL(OTHER_NO) });
const licenseRow = (bidNtceNo = NOTICE_NO): G2bItem => ({
  bidNtceNo,
  bidNtceOrd: "000",
  lmtGrpNo: "1",
  lmtSno: "1",
  lcnsLmtNm: "정보통신공사업/0036",
  permsnIndstrytyList: "",
  rgstDt: "2026-10-19 09:10:03",
  bsnsDivNm: "용역",
});
const regionRow = (bidNtceNo = NOTICE_NO): G2bItem => ({
  bidNtceNo,
  bidNtceOrd: "000",
  lmtSno: "1",
  prtcptPsblRgnNm: "대구광역시",
  rgstDt: "2026-10-19 09:10:03",
  bsnsDivNm: "용역",
});
const eorderRow = (bidNtceNo = NOTICE_NO): G2bItem => ({
  bidNtceNo,
  bidNtceOrd: "000",
  atchSno: "1",
  eorderDocDivNm: "제안요청서",
  eorderAtchFileNm: "제안요청서.hwpx",
  eorderAtchFileUrl: RFP_URL,
});

const okBody = (items: G2bItem[], totalCount = items.length, numOfRows = 100) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, numOfRows, pageNo: 1, totalCount },
  },
});
const errorBody = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});
const QUOTA_22 = () => json(errorBody("22", "서비스 요청제한횟수 초과에러"));
const RESULT_07 = () => json(errorBody("07", "입력범위값 초과 에러"));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Responder = (nth: number) => Response;
type Routes = Partial<Record<string, Responder>>;

// 오퍼레이션별 응답기와 호출 기록. 기록에는 URL(키 포함)을 남기지 않는다.
const routedFetch = (routes: Routes) => {
  const operations: string[] = [];
  const counts = new Map<string, number>();
  const fetch: FetchLike = async (url) => {
    const operation = new URL(url).pathname.split("/").at(-1) ?? "";
    operations.push(operation);
    const nth = (counts.get(operation) ?? 0) + 1;
    counts.set(operation, nth);
    const respond = routes[operation];
    if (!respond) throw new Error(`시험에 없는 오퍼레이션: ${operation}`);
    return respond(nth);
  };
  const listCalls = () => operations.filter((operation) => operation === LIST_OP).length;
  const auxCalls = () => operations.filter((operation) => operation !== LIST_OP).length;
  return { operations, listCalls, auxCalls, fetch };
};

const routesWith = (overrides: Routes = {}): Routes => ({
  [LIST_OP]: () => json(okBody([noticeRow()])),
  [LICENSE_OP]: () => json(okBody([licenseRow()])),
  [REGION_OP]: () => json(okBody([regionRow()])),
  [EORDER_OP]: () => json(okBody([eorderRow()])),
  ...overrides,
});
// 한 쪽에 공고 두 건. 보조 응답은 두 공고의 행이 섞여 온다(공고마다 자기 행만 남는다).
const twoNoticeRoutes = (overrides: Routes = {}): Routes =>
  routesWith({
    [LIST_OP]: () => json(okBody([noticeRow(), otherRow()])),
    [LICENSE_OP]: () => json(okBody([licenseRow(), licenseRow(OTHER_NO)])),
    [REGION_OP]: () => json(okBody([regionRow(), regionRow(OTHER_NO)])),
    [EORDER_OP]: () => json(okBody([eorderRow(), eorderRow(OTHER_NO)])),
    ...overrides,
  });

const retryDeps = (): RetryDeps => ({ sleep: vi.fn(async () => undefined), random: () => 0 });

const quotaWith = (used = 0): IngestQuota & { store: MemoryQuotaStore } => {
  const store = createMemoryQuotaStore({ dailyLimit: LIMIT });
  if (used > 0) void store.add(SERVICE_ID, FIRST_NOW, used);
  return { store, serviceId: SERVICE_ID, dailyLimit: LIMIT };
};

const g2bRun = (jobKey: string): StartRunInput => ({
  source: "g2b",
  runMode: "LIVE",
  jobKey,
  trigger: "SCHEDULED",
  batch: null,
  params: { window: ONE_DAY },
});

const ingestG2b = (
  repo: MemoryIngestionRepo,
  fetch: FetchLike,
  options: { jobKey: string; now?: Date; quota?: IngestQuota; numOfRows?: number },
) => {
  const retry = retryDeps();
  return runIngest({
    connector: createOfficialApiConnector({
      endpoint: ENDPOINT,
      serviceKey: SERVICE_KEY,
      fetch,
      ...(options.numOfRows === undefined ? {} : { numOfRows: options.numOfRows }),
    }),
    repo,
    run: g2bRun(options.jobKey),
    now: () => options.now ?? FIRST_NOW,
    retry,
    secrets: [SERVICE_KEY],
    aux: createG2bAuxFetcher({ endpoint: ENDPOINT, serviceKey: SERVICE_KEY, fetch, retry }),
    ...(options.quota === undefined ? {} : { quota: options.quota }),
  });
};

const errorsOf = (repo: MemoryIngestionRepo) =>
  repo.state.errors.map(({ sourceKey, errorCode, resultCode }) => [
    sourceKey,
    errorCode,
    resultCode,
  ]);
const auxLookupsOf = (repo: MemoryIngestionRepo, noticeNo: string) =>
  memoryRevisionsOf(repo, "g2b-bid-notice", noticeNo).map(({ normalized }) => normalized.auxLookup);
const runOf = (repo: MemoryIngestionRepo, jobKey: string) => repo.state.runs.get(jobKey);
const usedOf = (quota: IngestQuota & { store: MemoryQuotaStore }) =>
  quota.store.used.get(quotaKey(SERVICE_ID, FIRST_NOW)) ?? 0;

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

describe("호출 수 집계 — 호출 직후마다 QuotaStore.add", () => {
  it("목록 1 + 보조 3 = 4 를 그날(KST) 키에 더하고 quota_used 도 4 다", async () => {
    const repo = createMemoryIngestionRepo();
    const quota = quotaWith();
    const add = vi.spyOn(quota.store, "add");

    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1", quota });

    expect([usedOf(quota), runOf(repo, "g2b:1")?.quotaUsed]).toEqual([4, 4]);
    // 목록 쪽 한 번, 공고 1건의 보조 묶음 한 번
    expect(add.mock.calls.map(([serviceId, at, calls]) => [serviceId, at, calls])).toEqual([
      [SERVICE_ID, FIRST_NOW, 1],
      [SERVICE_ID, FIRST_NOW, 3],
    ]);
  });

  it("예산을 주지 않으면(시험·녹음) 지금처럼 돈다: SUCCEEDED·보조 3", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(routesWith());

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1" });

    expect([result.status, fetched.auxCalls(), auxLookupsOf(repo, NOTICE_NO)]).toEqual([
      "SUCCEEDED",
      3,
      [{ status: "OK", failed: [] }],
    ]);
  });
});

describe("run 시작 전 EXHAUSTED — 목록을 부르지 않는다", () => {
  it("한도(1000/1000)에 닿았으면 목록 호출 0·run FAILED·g2b:quota QUOTA_EXCEEDED·revision 없음", async () => {
    const repo = createMemoryIngestionRepo();
    const quota = quotaWith(LIMIT);
    const markExhausted = vi.spyOn(quota.store, "markExhausted");
    const fetched = routedFetch(routesWith());

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota });

    expect([
      result.status,
      result.summary,
      fetched.operations,
      errorsOf(repo),
      repo.state.revisions.length,
      markExhausted.mock.calls.length,
      repo.state.finishes.map(({ status }) => status),
    ]).toEqual(["FAILED", ZERO, [], [["g2b:quota", "QUOTA_EXCEEDED", null]], 0, 0, ["FAILED"]]);
  });

  it("기록 detail 에 쓴 수와 한도가 있다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(LIMIT),
    });

    expect(repo.state.errors[0]?.redactedDetail).toContain("1000/1000");
  });

  it("소진된 run 을 이어 가면 cursor 가 그대로다(checkpoint 는 받은 cursor 를 남긴다)", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(LIMIT),
    });

    expect([result.resumedFromCursor, runOf(repo, "g2b:1")?.cursor]).toEqual([null, null]);
  });

  it("예산이 다시 생기면 같은 jobKey 로 이어 가 처음부터 받는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(LIMIT),
    });

    const resumed = await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
      now: LATER_NOW,
    });

    expect([resumed.status, resumed.summary.created]).toEqual(["SUCCEEDED", 1]);
  });

  it("90%(900/1000)는 목록은 부른다(소진이 아니다)", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(routesWith());

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota: quotaWith(900) });

    expect([result.status, fetched.listCalls()]).toEqual(["SUCCEEDED", 1]);
  });
});

describe("90% 도달 — 보조 조회를 건너뛰고 SKIPPED_QUOTA 로 저장한다", () => {
  it("보조 호출 0·created 1·auxLookup SKIPPED_QUOTA(세 키)·구조화 자격 빈 배열·첨부는 목록 것만", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(routesWith());

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota: quotaWith(900) });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      result.summary,
      fetched.auxCalls(),
      revision?.normalized.auxLookup,
      revision?.normalized.structuredQualifications,
      revision?.normalized.attachments.length,
      repo.state.errors,
    ]).toEqual([
      { ...ZERO, created: 1 },
      0,
      { status: "SKIPPED_QUOTA", failed: AUX_KEYS },
      [],
      1,
      [],
    ]);
  });

  it("쪽 안에서 90% 에 닿으면 그 뒤 공고부터 건너뛴다(첫 공고 OK, 둘째 SKIPPED_QUOTA)", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(twoNoticeRoutes());
    // 목록 1 + 첫 공고 보조 3 = 4 를 더하면 900 이 된다.
    const quota = quotaWith(896);

    await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota });

    expect([
      fetched.auxCalls(),
      auxLookupsOf(repo, NOTICE_NO),
      auxLookupsOf(repo, OTHER_NO),
      usedOf(quota),
    ]).toEqual([
      3,
      [{ status: "OK", failed: [] }],
      [{ status: "SKIPPED_QUOTA", failed: AUX_KEYS }],
      900,
    ]);
  });

  it("예산이 모자란 동안 재수집하면 DUPLICATE 이고 보조 호출 0 이다(다시 채우기는 미룬다)", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(900),
    });
    const second = routedFetch(routesWith());

    const result = await ingestG2b(repo, second.fetch, {
      jobKey: "g2b:2",
      quota: quotaWith(950),
      now: LATER_NOW,
    });

    expect([result.summary, second.auxCalls(), auxLookupsOf(repo, NOTICE_NO).length]).toEqual([
      { ...ZERO, skippedDuplicate: 1 },
      0,
      1,
    ]);
  });

  it("예산이 생기면 목록이 같아도 보조 3종을 불러 CHANGED 로 저장하고 auxLookup 은 OK 다(NEEDS_REVIEW 해소)", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(900),
    });
    const second = routedFetch(routesWith());

    const result = await ingestG2b(repo, second.fetch, {
      jobKey: "g2b:2",
      quota: quotaWith(),
      now: LATER_NOW,
    });

    const revisions = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      result.summary,
      second.auxCalls(),
      revisions.map(({ revision, kind, normalized }) => [
        revision,
        kind,
        normalized.auxLookup?.status,
        normalized.structuredQualifications.map(({ kind: requirementKind }) => requirementKind),
        normalized.attachments.length,
      ]),
    ]).toEqual([
      { ...ZERO, changed: 1 },
      3,
      [
        [1, "CREATED", "SKIPPED_QUOTA", [], 1],
        [2, "CHANGED", "OK", ["LICENSE_LIMIT", "PARTICIPATION_REGION"], 2],
      ],
    ]);
  });
});

describe("보조 실패 — auxLookup FAILED 와 다시 채우기", () => {
  it("면허제한만 실패하면 FAILED + failed [g2b-bid-license-limit] 이고 받은 행은 저장한다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(routesWith({ [LICENSE_OP]: RESULT_07 })).fetch, {
      jobKey: "g2b:1",
    });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      revision?.normalized.auxLookup,
      revision?.normalized.structuredQualifications.map(({ kind }) => kind),
    ]).toEqual([{ status: "FAILED", failed: ["g2b-bid-license-limit"] }, ["PARTICIPATION_REGION"]]);
  });

  it("셋 다 실패하면 failed 는 호출 순서(면허·지역·e발주)다", async () => {
    const repo = createMemoryIngestionRepo();
    const allFail = routesWith({
      [LICENSE_OP]: RESULT_07,
      [REGION_OP]: RESULT_07,
      [EORDER_OP]: RESULT_07,
    });

    await ingestG2b(repo, routedFetch(allFail).fetch, { jobKey: "g2b:1" });

    expect(auxLookupsOf(repo, NOTICE_NO)).toEqual([{ status: "FAILED", failed: AUX_KEYS }]);
  });

  it("다시 채우기가 또 실패하면 revision 을 늘리지 않고(DUPLICATE) 실패만 기록한다", async () => {
    const repo = createMemoryIngestionRepo();
    const failing = routesWith({ [LICENSE_OP]: RESULT_07 });
    await ingestG2b(repo, routedFetch(failing).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(failing);

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([
      result.summary,
      second.auxCalls(),
      auxLookupsOf(repo, NOTICE_NO).length,
      errorsOf(repo).filter(([, code]) => code === "API_RESULT_CODE").length,
    ]).toEqual([{ ...ZERO, skippedDuplicate: 1 }, 3, 1, 2]);
  });

  it("다시 채우기 run 의 quota_used 는 목록 1 + 보조 3 = 4 다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith({ [LICENSE_OP]: RESULT_07 })).fetch, {
      jobKey: "g2b:1",
    });

    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect(runOf(repo, "g2b:2")?.quotaUsed).toBe(4);
  });

  it("다시 채우기 CHANGED 는 재분석 대상이고 BID_CHANGED 이벤트를 revision 2 멱등키로 만든다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith({ [LICENSE_OP]: RESULT_07 })).fetch, {
      jobKey: "g2b:1",
    });

    const result = await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:2",
      now: LATER_NOW,
    });

    expect([
      result.saved.map(({ kind, reanalyze }) => [kind, reanalyze]),
      repo.state.outbox.map(({ idempotencyKey }) => idempotencyKey),
    ]).toEqual([
      [["CHANGED", true]],
      [`g2b-bid-notice:${NOTICE_NO}:1:BID_CREATED`, `g2b-bid-notice:${NOTICE_NO}:2:BID_CHANGED`],
    ]);
  });

  it("목록이 바뀐 공고는 다시 채우기와 무관하게 CHANGED 이고 보조 결과가 auxLookup 에 남는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith({ [LICENSE_OP]: RESULT_07 })).fetch, {
      jobKey: "g2b:1",
    });
    const changed = routesWith({
      [LIST_OP]: () =>
        json(okBody([noticeRow({ bidNtceNm: "가상 정보시스템 유지관리 용역(수정)" })])),
      [REGION_OP]: RESULT_07,
    });

    const result = await ingestG2b(repo, routedFetch(changed).fetch, {
      jobKey: "g2b:2",
      now: LATER_NOW,
    });

    expect([result.summary.changed, auxLookupsOf(repo, NOTICE_NO)]).toEqual([
      1,
      [
        { status: "FAILED", failed: ["g2b-bid-license-limit"] },
        { status: "FAILED", failed: ["g2b-bid-region"] },
      ],
    ]);
  });

  it("취소공고 revision 에는 auxLookup 이 없고 이전 revision 의 FAILED 를 다시 채우지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith({ [LICENSE_OP]: RESULT_07 })).fetch, {
      jobKey: "g2b:1",
    });
    const cancel = routedFetch(
      routesWith({
        [LIST_OP]: () => json(okBody([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      }),
    );

    const result = await ingestG2b(repo, cancel.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([result.summary.cancelled, cancel.auxCalls(), auxLookupsOf(repo, NOTICE_NO)]).toEqual([
      1,
      0,
      [{ status: "FAILED", failed: ["g2b-bid-license-limit"] }, undefined],
    ]);
  });
});

describe("결과코드 22 — 같은 run 의 남은 호출을 전부 멈춘다", () => {
  it("첫 공고의 면허제한이 22 면 지역·e발주·둘째 공고를 부르지 않고 run 은 FAILED 다", async () => {
    const repo = createMemoryIngestionRepo();
    const quota = quotaWith(266);
    const markExhausted = vi.spyOn(quota.store, "markExhausted");
    const fetched = routedFetch(twoNoticeRoutes({ [LICENSE_OP]: QUOTA_22 }));

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota });

    expect([
      result.status,
      result.summary,
      fetched.operations,
      markExhausted.mock.calls,
      usedOf(quota),
      errorsOf(repo),
    ]).toEqual([
      "FAILED",
      { ...ZERO, created: 1 },
      [LIST_OP, LICENSE_OP],
      [[SERVICE_ID, FIRST_NOW]],
      LIMIT,
      [
        [`g2b-bid-license-limit:${NOTICE_NO}`, "API_QUOTA_EXCEEDED", "22"],
        ["g2b:quota", "QUOTA_EXCEEDED", "22"],
      ],
    ]);
  });

  it("22 를 받은 공고는 보조 없이 저장되고 auxLookup FAILED 에 22 를 받은 키와 부르지 않은 키가 모두 있다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(twoNoticeRoutes({ [LICENSE_OP]: QUOTA_22 })).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
    });

    expect([
      auxLookupsOf(repo, NOTICE_NO),
      memoryRevisionsOf(repo, "g2b-bid-notice", OTHER_NO),
    ]).toEqual([[{ status: "FAILED", failed: AUX_KEYS }], []]);
  });

  it("e발주(마지막 오퍼레이션)가 22 면 앞의 행은 저장하고 다음 공고는 부르지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(twoNoticeRoutes({ [EORDER_OP]: QUOTA_22 }));

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota: quotaWith() });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      result.status,
      fetched.operations,
      revision?.normalized.auxLookup,
      revision?.normalized.structuredQualifications.map(({ kind }) => kind),
    ]).toEqual([
      "FAILED",
      [LIST_OP, LICENSE_OP, REGION_OP, EORDER_OP],
      { status: "FAILED", failed: ["g2b-bid-eorder-attach"] },
      ["LICENSE_LIMIT", "PARTICIPATION_REGION"],
    ]);
  });

  it("22 로 멈춘 run 은 그 쪽의 cursor 를 남긴다(처음 쪽이면 null). quota_used 는 실제 호출 수다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(twoNoticeRoutes({ [LICENSE_OP]: QUOTA_22 })).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
    });

    const run = runOf(repo, "g2b:1");
    expect([run?.status, run?.cursor, run?.quotaUsed]).toEqual(["FAILED", null, 2]);
  });

  it("둘째 쪽에서 22 를 받으면 둘째 쪽 cursor(0:2)를 남기고 셋째 쪽을 부르지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const pages = [noticeRow(), otherRow(), noticeRow({ bidNtceNo: "R26BK00000003" })];
    const fetched = routedFetch(
      routesWith({
        [LIST_OP]: (nth) => json(okBody([pages[nth - 1] ?? noticeRow()], 3, 1)),
        [LICENSE_OP]: (nth) => (nth === 2 ? QUOTA_22() : json(okBody([licenseRow()]))),
      }),
    );

    const result = await ingestG2b(repo, fetched.fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
      numOfRows: 1,
    });

    expect([
      result.status,
      result.summary.created,
      fetched.listCalls(),
      runOf(repo, "g2b:1")?.cursor,
      repo.state.checkpoints.map(({ cursor }) => cursor),
    ]).toEqual(["FAILED", 2, 2, "0:2", ["0:2", "0:2"]]);
  });

  it("다음 날(새 키) 같은 jobKey 로 이어 가면 그 쪽부터 다시 받아 저장한 공고는 다시 채우고 남은 공고는 새로 만든다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(twoNoticeRoutes({ [LICENSE_OP]: QUOTA_22 })).fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
    });
    const resumed = routedFetch(twoNoticeRoutes());

    const result = await ingestG2b(repo, resumed.fetch, {
      jobKey: "g2b:1",
      quota: quotaWith(),
      now: LATER_NOW,
    });

    expect([
      result.status,
      result.summary,
      resumed.auxCalls(),
      auxLookupsOf(repo, NOTICE_NO).map((lookup) => lookup?.status),
      auxLookupsOf(repo, OTHER_NO).map((lookup) => lookup?.status),
    ]).toEqual(["SUCCEEDED", { ...ZERO, created: 2, changed: 1 }, 6, ["FAILED", "OK"], ["OK"]]);
  });

  it("목록 쪽이 22 면 보조 호출 0·markExhausted·쪽 실패와 run 수준 기록·FAILED·cursor 보존", async () => {
    const repo = createMemoryIngestionRepo();
    const quota = quotaWith(5);
    const markExhausted = vi.spyOn(quota.store, "markExhausted");
    const fetched = routedFetch(routesWith({ [LIST_OP]: QUOTA_22 }));

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota });

    expect([
      result.status,
      fetched.operations,
      markExhausted.mock.calls.length,
      usedOf(quota),
      errorsOf(repo),
      runOf(repo, "g2b:1")?.cursor,
    ]).toEqual([
      "FAILED",
      [LIST_OP],
      1,
      LIMIT,
      [
        ["g2b:page:start", "API_QUOTA_EXCEEDED", "22"],
        ["g2b:quota", "QUOTA_EXCEEDED", "22"],
      ],
      null,
    ]);
  });

  it("22 를 받으면 예산이 없는 run(녹음·시험)도 남은 호출을 멈추고 QUOTA_EXCEEDED 를 남긴다", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(twoNoticeRoutes({ [REGION_OP]: QUOTA_22 }));

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1" });

    expect([result.status, fetched.operations, errorsOf(repo).at(-1)]).toEqual([
      "FAILED",
      [LIST_OP, LICENSE_OP, REGION_OP],
      ["g2b:quota", "QUOTA_EXCEEDED", "22"],
    ]);
  });

  it("한도가 아닌 결과 코드(07)는 멈추지 않는다: 다음 공고도 보조 3종을 부른다", async () => {
    const repo = createMemoryIngestionRepo();
    const fetched = routedFetch(twoNoticeRoutes({ [LICENSE_OP]: RESULT_07 }));

    const result = await ingestG2b(repo, fetched.fetch, { jobKey: "g2b:1", quota: quotaWith() });

    expect([result.status, result.summary.created, fetched.auxCalls()]).toEqual([
      "SUCCEEDED",
      2,
      6,
    ]);
  });
});
