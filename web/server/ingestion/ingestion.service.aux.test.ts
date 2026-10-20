import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { G2bItem } from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureManifest } from "./fixture.model";
import { createG2bAuxFetcher, type G2bAuxFetcher } from "./g2b-aux";
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
import type { RetryDeps } from "./retry";

// 수집 흐름의 보조 조회(07 §2.2 "새 revision 일 때만", §2.6 실패 격리, 04 ingest_runs.quota_used).
// 목록·보조 조회 모두 가짜 fetch 로 받고 메모리 저장소에 쌓는다. 실제 네트워크·Supabase 는 부르지 않는다.
// 응답 모양은 2026-10-19 실측을 본떴고, 값은 모두 가상이다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const SERVICE_KEY = "TESTKEY+fake/value==";
const SECRET_FORMS = [SERVICE_KEY, encodeURIComponent(SERVICE_KEY)];
const NOTICE_NO = "R26BK00000001";
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
const RFP_URL = `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?rfpNo=R26DH00000001&rfpOrd=000&rfpUntyAtchFileNo=1`;
const LIST_DOC_URL = `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${NOTICE_NO}&fileSeq=1`;

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
  ntceSpecDocUrl1: LIST_DOC_URL,
  ntceSpecFileNm1: "1.제안요청서.pdf",
  infoBizYn: "Y",
  ...overrides,
});
const licenseRow = (overrides: G2bItem = {}): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtGrpNo: "1",
  lmtSno: "1",
  lcnsLmtNm: "정보통신공사업/0036",
  permsnIndstrytyList: "",
  indstrytyMfrcFldList: "",
  rgstDt: "2026-10-19 09:10:03",
  bsnsDivNm: "용역",
  ...overrides,
});
const regionRow = (): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  lmtSno: "1",
  prtcptPsblRgnNm: "대구광역시",
  rgstDt: "2026-10-19 09:10:03",
  bsnsDivNm: "용역",
});
const eorderRow = (): G2bItem => ({
  bidNtceNo: NOTICE_NO,
  bidNtceOrd: "000",
  atchSno: "1",
  eorderDocDivNm: "제안요청서",
  eorderAtchFileNm: "제안요청서.hwpx",
  eorderAtchFileUrl: RFP_URL,
});

const okBody = (items: G2bItem[]) => ({
  response: {
    header: { resultCode: "00", resultMsg: "정상" },
    body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length },
  },
});
const errorBody = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});
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
  const auxCalls = () => operations.filter((operation) => operation !== LIST_OP).length;
  return { operations, auxCalls, fetch };
};

const routesWith = (overrides: Routes = {}): Routes => ({
  [LIST_OP]: () => json(okBody([noticeRow()])),
  [LICENSE_OP]: () => json(okBody([licenseRow()])),
  [REGION_OP]: () => json(okBody([regionRow()])),
  [EORDER_OP]: () => json(okBody([eorderRow()])),
  ...overrides,
});

const deps = () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  const retry: RetryDeps = { sleep, random: () => 0 };
  return { sleep, retry };
};

const g2bRun = (jobKey: string): StartRunInput => ({
  source: "g2b",
  runMode: "LIVE",
  jobKey,
  trigger: "MANUAL",
  batch: null,
  params: { window: ONE_DAY },
});

const ingestG2b = (
  repo: MemoryIngestionRepo,
  fetch: FetchLike,
  options: { jobKey: string; now?: Date; aux?: G2bAuxFetcher | null; retry?: RetryDeps },
) => {
  const retry = options.retry ?? deps().retry;
  const aux =
    options.aux === null
      ? undefined
      : (options.aux ??
        createG2bAuxFetcher({ endpoint: ENDPOINT, serviceKey: SERVICE_KEY, fetch, retry }));
  return runIngest({
    connector: createOfficialApiConnector({ endpoint: ENDPOINT, serviceKey: SERVICE_KEY, fetch }),
    repo,
    run: g2bRun(options.jobKey),
    now: () => options.now ?? FIRST_NOW,
    retry,
    secrets: [SERVICE_KEY],
    ...(aux === undefined ? {} : { aux }),
  });
};

const quotaUsedOf = (repo: MemoryIngestionRepo, jobKey: string): number | undefined =>
  repo.state.runs.get(jobKey)?.quotaUsed;

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

describe("runIngest — 새 g2b 공고에 보조 조회를 붙인다", () => {
  it("목록 1쪽 뒤 보조 3종을 부른다(호출 순서: 목록 → 면허제한 → 지역 → e발주)", async () => {
    const repo = createMemoryIngestionRepo();
    const { operations, fetch } = routedFetch(routesWith());

    await ingestG2b(repo, fetch, { jobKey: "g2b:1" });

    expect(operations).toEqual([LIST_OP, LICENSE_OP, REGION_OP, EORDER_OP]);
  });

  it("저장한 revision 의 structuredQualifications 에 면허제한·참가가능지역이 있다", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(revision?.normalized.structuredQualifications).toEqual([
      {
        kind: "LICENSE_LIMIT",
        code: "0036",
        name: "정보통신공사업",
        value: licenseRow(),
        sourceOperation: LICENSE_OP,
      },
      {
        kind: "PARTICIPATION_REGION",
        code: null,
        name: "대구광역시",
        value: regionRow(),
        sourceOperation: REGION_OP,
      },
    ]);
  });

  it("e발주 첨부가 목록 첨부 뒤에 더해지고 attachmentCount 는 2 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(revision?.normalized.attachments).toEqual([
      { name: "1.제안요청서.pdf", url: LIST_DOC_URL },
      { name: "제안요청서.hwpx", url: RFP_URL },
    ]);
    expect(result.saved.map(({ kind, attachmentCount }) => [kind, attachmentCount])).toEqual([
      ["CREATED", 2],
    ]);
  });

  it("bid_structured_requirements 흉내에 revision 단위로 seq 0·1 이 들어간다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    expect(
      repo.state.structuredRequirements.map(({ bidId, revisionId, kind, seq }) => [
        bidId,
        revisionId,
        kind,
        seq,
      ]),
    ).toEqual([
      [result.saved[0]?.bidId, result.saved[0]?.revisionId, "LICENSE_LIMIT", 0],
      [result.saved[0]?.bidId, result.saved[0]?.revisionId, "PARTICIPATION_REGION", 1],
    ]);
  });

  it("요약은 created 1 이고 run 은 SUCCEEDED, quota_used 는 목록 1 + 보조 3 = 4 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    expect([result.status, result.summary, quotaUsedOf(repo, "g2b:1")]).toEqual([
      "SUCCEEDED",
      { ...ZERO, created: 1 },
      4,
    ]);
  });

  it("checkpoint 와 finish 가 같은 quotaUsed 를 남긴다(마지막 체크포인트 뒤 보조 호출이 새지 않는다)", async () => {
    const repo = createMemoryIngestionRepo();
    const saveCheckpoint = vi.spyOn(repo, "saveCheckpoint");
    const finishRun = vi.spyOn(repo, "finishRun");

    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    expect(saveCheckpoint.mock.calls.map(([, checkpoint]) => checkpoint.quotaUsed)).toEqual([4]);
    expect(finishRun.mock.calls.map(([, result]) => result.quotaUsed)).toEqual([4]);
  });

  it("보조 조회 0건(items 키 없음)이면 structuredQualifications 는 빈 배열이고 첨부는 목록 것만이다", async () => {
    const repo = createMemoryIngestionRepo();
    const empty = () =>
      json({
        response: {
          header: { resultCode: "00", resultMsg: "정상" },
          body: { numOfRows: 999, pageNo: 1, totalCount: 0 },
        },
      });

    const result = await ingestG2b(
      repo,
      routedFetch(routesWith({ [LICENSE_OP]: empty, [REGION_OP]: empty, [EORDER_OP]: empty }))
        .fetch,
      { jobKey: "g2b:1" },
    );

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      revision?.normalized.structuredQualifications,
      revision?.normalized.attachments.length,
      result.status,
      repo.state.errors,
    ]).toEqual([[], 1, "SUCCEEDED", []]);
  });

  it("aux 를 주지 않으면(녹음 재생·fixture) 보조 조회를 부르지 않고 구조화 자격은 빈 배열이다", async () => {
    const repo = createMemoryIngestionRepo();
    const { auxCalls, fetch } = routedFetch(routesWith());

    await ingestG2b(repo, fetch, { jobKey: "g2b:1", aux: null });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      auxCalls(),
      revision?.normalized.structuredQualifications,
      quotaUsedOf(repo, "g2b:1"),
    ]).toEqual([0, [], 1]);
  });

  it("g2b 수집은 전역 fetch 를 부르지 않는다", async () => {
    await ingestG2b(createMemoryIngestionRepo(), routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
    });

    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe("runIngest — 변경 없는 재수집에는 보조 조회를 부르지 않는다", () => {
  it("같은 목록 행을 다른 run 으로 다시 받으면 DUPLICATE 이고 보조 호출은 0 이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1", now: FIRST_NOW });
    const second = routedFetch(routesWith());

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([
      result.summary,
      second.operations,
      memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO).length,
    ]).toEqual([{ ...ZERO, skippedDuplicate: 1 }, [LIST_OP], 1]);
  });

  it("재수집 run 의 quota_used 는 목록 1 뿐이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });

    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([quotaUsedOf(repo, "g2b:1"), quotaUsedOf(repo, "g2b:2")]).toEqual([4, 1]);
  });

  it("보조 조회가 실패했던 공고도 목록이 같으면 DUPLICATE 다(실패를 다시 메우려고 revision 을 만들지 않는다)", async () => {
    const repo = createMemoryIngestionRepo();
    const failing = routesWith({
      [LICENSE_OP]: () => json(errorBody("07", "입력범위값 초과 에러")),
    });
    await ingestG2b(repo, routedFetch(failing).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(routesWith());

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([result.summary, second.auxCalls()]).toEqual([{ ...ZERO, skippedDuplicate: 1 }, 0]);
  });
});

describe("runIngest — 목록이 바뀐 공고는 새 revision 과 함께 보조 조회를 다시 부른다", () => {
  it("제목이 바뀌면 CHANGED 이고 보조 3종을 다시 불러 revision 2 에 구조화 자격이 있다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(
      routesWith({
        [LIST_OP]: () =>
          json(okBody([noticeRow({ bidNtceNm: "가상 정보시스템 유지관리 용역(수정)" })])),
        [LICENSE_OP]: () =>
          json(okBody([licenseRow({ lcnsLmtNm: "소프트웨어사업자(컴퓨터관련서비스사업)/1468" })])),
      }),
    );

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    const revisions = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([result.summary, second.auxCalls(), revisions.length]).toEqual([
      { ...ZERO, changed: 1 },
      3,
      2,
    ]);
    expect(
      revisions[1]?.normalized.structuredQualifications.map(({ kind, code }) => [kind, code]),
    ).toEqual([
      ["LICENSE_LIMIT", "1468"],
      ["PARTICIPATION_REGION", null],
    ]);
  });

  it("변경 revision 의 changes 는 보조 결과를 합친 뒤의 diff 다(바뀐 면허제한이 structuredQualifications 변경으로 남는다)", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(
      routesWith({
        [LIST_OP]: () =>
          json(okBody([noticeRow({ bidNtceNm: "가상 정보시스템 유지관리 용역(수정)" })])),
        [LICENSE_OP]: () =>
          json(okBody([licenseRow({ lcnsLmtNm: "소프트웨어사업자(컴퓨터관련서비스사업)/1468" })])),
      }),
    );

    await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    const [, changed] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(changed?.changes.map(({ field }) => field)).toEqual([
      "title",
      "structuredQualifications",
    ]);
  });

  it("목록이 같은데 보조 결과만 달라질 수 있어도 목록 기준으로 먼저 판정하므로 보조를 부르지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(
      routesWith({
        [LICENSE_OP]: () => json(okBody([licenseRow({ lcnsLmtNm: "다른면허/9999" })])),
      }),
    );

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([result.summary.skippedDuplicate, second.auxCalls()]).toEqual([1, 0]);
  });
});

describe("runIngest — 취소공고에는 보조 조회를 부르지 않는다", () => {
  it("취소공고 행은 CANCELLED 로 저장하고 보조 호출 0, quota_used 는 목록 1 이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(
      routesWith({
        [LIST_OP]: () => json(okBody([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      }),
    );

    const result = await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    expect([result.summary, second.auxCalls(), quotaUsedOf(repo, "g2b:2")]).toEqual([
      { ...ZERO, cancelled: 1 },
      0,
      1,
    ]);
  });

  it("취소 revision 은 보조 없이 저장되고 revision 1 의 구조화 자격은 그대로 남는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith()).fetch, { jobKey: "g2b:1" });
    const second = routedFetch(
      routesWith({
        [LIST_OP]: () => json(okBody([noticeRow({ ntceKindNm: "취소공고", bidNtceOrd: "001" })])),
      }),
    );

    await ingestG2b(repo, second.fetch, { jobKey: "g2b:2", now: LATER_NOW });

    const [first, cancelled] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      cancelled?.normalized.status,
      cancelled?.normalized.structuredQualifications,
      first?.normalized.structuredQualifications.length,
      repo.state.structuredRequirements.map(({ revisionId }) => revisionId),
    ]).toEqual(["CANCELLED", [], 2, [first?.revisionId, first?.revisionId]]);
  });

  it("처음부터 취소된 공고(CREATED, 재분석 없음)도 보조 조회를 부르지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const only = routedFetch(
      routesWith({ [LIST_OP]: () => json(okBody([noticeRow({ ntceKindNm: "취소공고" })])) }),
    );

    const result = await ingestG2b(repo, only.fetch, { jobKey: "g2b:1" });

    expect([result.summary.created, result.saved[0]?.reanalyze, only.auxCalls()]).toEqual([
      1,
      false,
      0,
    ]);
  });
});

describe("runIngest — 보조 조회 실패는 공고를 막지 않는다(07 §2.6)", () => {
  const LICENSE_FAILS: Routes = {
    [LICENSE_OP]: () => json(errorBody("07", "입력범위값 초과 에러")),
  };

  it("면허제한이 결과 코드로 실패해도 공고는 지역·첨부와 함께 저장되고 run 은 SUCCEEDED 다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith(LICENSE_FAILS)).fetch, {
      jobKey: "g2b:1",
    });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect([
      result.status,
      result.summary,
      revision?.normalized.structuredQualifications.map(({ kind }) => kind),
      revision?.normalized.attachments.length,
    ]).toEqual(["SUCCEEDED", { ...ZERO, created: 1 }, ["PARTICIPATION_REGION"], 2]);
  });

  it("실패는 ingest_errors 에 registry 키:공고번호 로 남는다(API_RESULT_CODE, resultCode 07)", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(repo, routedFetch(routesWith(LICENSE_FAILS)).fetch, {
      jobKey: "g2b:1",
    });

    expect(repo.state.errors).toEqual([
      {
        runId: result.runId,
        sourceKey: `g2b-bid-license-limit:${NOTICE_NO}`,
        errorCode: "API_RESULT_CODE",
        resultCode: "07",
        redactedDetail: `나라장터 ${LICENSE_OP} resultCode 07: 입력범위값 초과 에러`,
      },
    ]);
  });

  it("세 종류가 모두 실패하면 오류 3건을 남기고 공고는 보조 없이 저장된다", async () => {
    const repo = createMemoryIngestionRepo();
    const allFail = routesWith({
      [LICENSE_OP]: () => json(errorBody("07", "x")),
      [REGION_OP]: () => json({}, 503),
      [EORDER_OP]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const { sleep, retry } = deps();

    const result = await ingestG2b(repo, routedFetch(allFail).fetch, { jobKey: "g2b:1", retry });

    const [revision] = memoryRevisionsOf(repo, "g2b-bid-notice", NOTICE_NO);
    expect(
      repo.state.errors.map(({ sourceKey, errorCode, resultCode }) => [
        sourceKey,
        errorCode,
        resultCode,
      ]),
    ).toEqual([
      [`g2b-bid-license-limit:${NOTICE_NO}`, "API_RESULT_CODE", "07"],
      [`g2b-bid-region:${NOTICE_NO}`, "API_HTTP_ERROR", null],
      [`g2b-bid-eorder-attach:${NOTICE_NO}`, "API_HTTP_ERROR", null],
    ]);
    expect([
      result.status,
      revision?.normalized.structuredQualifications,
      revision?.normalized.attachments.length,
    ]).toEqual(["SUCCEEDED", [], 1]);
    // 503 은 1·2·4초로 3회 재시도했다. 보조 재시도는 summary.retried(목록 쪽)에 더하지 않는다.
    expect([sleep.mock.calls.map(([ms]) => ms), result.summary.retried]).toEqual([
      [1000, 2000, 4000],
      0,
    ]);
  });

  it("보조 재시도도 quota_used 에 센다: 목록 1 + 면허 1 + 지역 4(503×4) + e발주 1 = 7", async () => {
    const repo = createMemoryIngestionRepo();

    await ingestG2b(repo, routedFetch(routesWith({ [REGION_OP]: () => json({}, 503) })).fetch, {
      jobKey: "g2b:1",
    });

    expect(quotaUsedOf(repo, "g2b:1")).toBe(7);
  });

  it("오류 메시지가 서비스키를 되돌려 줘도 ingest_errors 의 detail 에 키가 없다", async () => {
    const repo = createMemoryIngestionRepo();
    const echo = routesWith({
      [LICENSE_OP]: () =>
        json(errorBody("07", `에러 serviceKey=${SERVICE_KEY} ${encodeURIComponent(SERVICE_KEY)}`)),
    });

    await ingestG2b(repo, routedFetch(echo).fetch, { jobKey: "g2b:1" });

    const detail = repo.state.errors.map((error) => error.redactedDetail).join("\n");
    for (const form of SECRET_FORMS) expect(detail).not.toContain(form);
    expect(detail).toContain("[REDACTED]");
  });

  it("일일 한도(22)는 API_QUOTA_EXCEEDED 로 남기고 공고는 저장된다", async () => {
    const repo = createMemoryIngestionRepo();
    const quota = routesWith({
      [EORDER_OP]: () => json(errorBody("22", "서비스 요청제한횟수 초과에러")),
    });

    const result = await ingestG2b(repo, routedFetch(quota).fetch, { jobKey: "g2b:1" });

    expect([
      result.summary.created,
      repo.state.errors.map(({ errorCode, resultCode }) => [errorCode, resultCode]),
    ]).toEqual([1, [["API_QUOTA_EXCEEDED", "22"]]]);
  });
});

describe("runIngest — quota_used 집계", () => {
  it("목록 쪽 재시도(500 뒤 성공)도 센다: 목록 2 + 보조 3 = 5, summary.retried 는 1", async () => {
    const repo = createMemoryIngestionRepo();
    const flaky = routesWith({
      [LIST_OP]: (nth) => (nth === 1 ? json({}, 500) : json(okBody([noticeRow()]))),
    });

    const result = await ingestG2b(repo, routedFetch(flaky).fetch, { jobKey: "g2b:1" });

    expect([quotaUsedOf(repo, "g2b:1"), result.summary.retried]).toEqual([5, 1]);
  });

  it("목록이 끝내 실패하면 FAILED 이고 실패한 호출(4회)도 quota_used 에 남는다", async () => {
    const repo = createMemoryIngestionRepo();

    const result = await ingestG2b(
      repo,
      routedFetch(routesWith({ [LIST_OP]: () => json({}, 500) })).fetch,
      {
        jobKey: "g2b:1",
      },
    );

    expect([result.status, quotaUsedOf(repo, "g2b:1")]).toEqual(["FAILED", 4]);
  });

  it("실패한 run 을 같은 jobKey 로 이어 가면 저장된 값부터 더 센다: 4 + 1 + 3 = 8", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, routedFetch(routesWith({ [LIST_OP]: () => json({}, 500) })).fetch, {
      jobKey: "g2b:1",
    });

    const resumed = await ingestG2b(repo, routedFetch(routesWith()).fetch, {
      jobKey: "g2b:1",
      now: LATER_NOW,
    });

    expect([resumed.status, resumed.summary.created, quotaUsedOf(repo, "g2b:1")]).toEqual([
      "SUCCEEDED",
      1,
      8,
    ]);
  });

  it("한 쪽에 공고 두 건이면 보조는 건마다 3회: 목록 1 + 6 = 7", async () => {
    const repo = createMemoryIngestionRepo();
    const other = "R26BK00000002";
    const two = routesWith({
      [LIST_OP]: () => json(okBody([noticeRow(), noticeRow({ bidNtceNo: other })])),
      [LICENSE_OP]: () => json(okBody([licenseRow(), licenseRow({ bidNtceNo: other })])),
    });

    const result = await ingestG2b(repo, routedFetch(two).fetch, { jobKey: "g2b:1" });

    expect([result.summary.created, quotaUsedOf(repo, "g2b:1")]).toEqual([2, 7]);
    // 섞여 온 행은 공고마다 자기 행만 받는다(지역 행은 첫 공고 것뿐이라 둘째 공고에는 없다).
    expect(
      memoryRevisionsOf(repo, "g2b-bid-notice", other)[0]?.normalized.structuredQualifications.map(
        ({ kind, value }) => [kind, value.bidNtceNo],
      ),
    ).toEqual([["LICENSE_LIMIT", other]]);
  });
});

describe("runIngest — fixture run 은 공공 API 를 부르지 않아 quota_used 가 0 이다", () => {
  let manifest: FixtureManifest;
  beforeAll(async () => {
    manifest = await loadFixtureManifest(FIXTURES_DIR);
  });

  it("SEED 를 돌려도 run.quotaUsed 는 0 이고 checkpoint 에 quotaUsed 를 주지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const saveCheckpoint = vi.spyOn(repo, "saveCheckpoint");

    await runIngest({
      connector: createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "SEED", manifest }),
      repo,
      run: {
        source: "fixture",
        runMode: "MOCK",
        jobKey: "seed-1",
        trigger: "DEMO",
        batch: "SEED",
        params: null,
      },
      anchor: new Date("2026-10-19T03:00:00.000Z"),
      now: () => FIRST_NOW,
      retry: deps().retry,
    });

    expect(quotaUsedOf(repo, "seed-1")).toBe(0);
    expect(saveCheckpoint.mock.calls.every(([, checkpoint]) => !("quotaUsed" in checkpoint))).toBe(
      true,
    );
  });
});
