import { describe, expect, it } from "vitest";
import { createG2bAuxFetcher } from "./g2b-aux";
import { G2B_AUX_OPERATIONS, G2B_BID_NOTICE_LIST_OPERATION } from "./g2b.model";
import { createMemoryIngestionRepo, type MemoryIngestionRepo } from "./ingestion.repo.memory";
import { refillG2bAux, runIngest } from "./ingestion.service";
import { createOfficialApiConnector } from "./official-api-connector";
import { scopedServiceId } from "./quota";
import { createMemoryQuotaStore, type MemoryQuotaStore } from "./quota-store";

// ── 사용자 결정 2026-10-29: 나라장터 일일 한도는 목록·보조 3종이 각각 따로다. ──
// 보조 조회가 빠진 공고는 새 revision·변경 이벤트 없이 그 revision 에 채운다(화면에 같은 공고가 두 번 나오지 않는다).
// 공공 API 는 아래 fetch 가짜가 만든다.

const SERVICE_ID = "15129394";
const ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const at = new Date("2026-10-29T03:00:00.000Z"); // KST 12:00
const window = { from: "2026-10-28T03:00:00.000Z", to: "2026-10-29T03:00:00.000Z" };
const retry = { sleep: async () => undefined, random: () => 0 };
const [LICENSE, REGION, ATTACH] = G2B_AUX_OPERATIONS;
const AUX_SCOPES = G2B_AUX_OPERATIONS.map(({ registryKey }) => registryKey);

const notice = (no: string) => ({
  bidNtceNo: no,
  bidNtceOrd: "000",
  bidNtceNm: "데이터 시스템 용역",
  ntceKindNm: "등록공고",
  dminsttNm: "시험기관",
  bidNtceDt: "2026-10-28 09:00:00",
  bidClseDt: "2026-11-05 18:00:00",
  bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
});

const auxRowsOf = (operation: string, no: string): Record<string, string>[] => {
  if (operation === LICENSE.operation)
    return [{ bidNtceNo: no, lmtGrpNo: "1", lmtSno: "1", lcnsLmtNm: "소프트웨어사업자/1468" }];
  if (operation === REGION.operation)
    return [{ bidNtceNo: no, lmtSno: "1", prtcptPsblRgnNm: "서울특별시" }];
  return [
    {
      bidNtceNo: no,
      atchSno: "1",
      eorderDocDivNm: "제안요청서",
      eorderAtchFileNm: "제안요청서.hwp",
      eorderAtchFileUrl: `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadRfpFile.do?bidPbancNo=${no}&fileSeq=1`,
    },
  ];
};

const envelope = (items: readonly unknown[]) =>
  Response.json({
    response: { header: { resultCode: "00" }, body: { items, totalCount: items.length } },
  });

/** 목록 1쪽(notices) + 보조 3종. limited 에 든 오퍼레이션은 결과코드 22(일일 한도)로 답한다 */
function g2bApi(notices: readonly string[], limited: ReadonlySet<string> = new Set()) {
  const operations: string[] = [];
  const fetch = async (url: string) => {
    const parsed = new URL(url);
    const operation = parsed.pathname.split("/").at(-1) ?? "";
    operations.push(operation);
    if (operation === G2B_BID_NOTICE_LIST_OPERATION) return envelope(notices.map(notice));
    if (limited.has(operation))
      return Response.json({ response: { header: { resultCode: "22", resultMsg: "LIMITED" } } });
    return envelope(auxRowsOf(operation, parsed.searchParams.get("bidNtceNo") ?? ""));
  };
  const config = { endpoint: ENDPOINT, serviceKey: "test-only-key", fetch };
  return {
    operations,
    connector: createOfficialApiConnector({ ...config, isInfoBizNotice: () => true }),
    aux: createG2bAuxFetcher({ ...config, retry }),
  };
}

const quotaOf = (store: MemoryQuotaStore, dailyLimit: number) => ({
  store,
  serviceId: SERVICE_ID,
  dailyLimit,
});

const ingest = (
  api: ReturnType<typeof g2bApi>,
  repo: MemoryIngestionRepo,
  store: MemoryQuotaStore,
  jobKey: string,
  dailyLimit = 10,
) =>
  runIngest({
    connector: api.connector,
    aux: api.aux,
    repo,
    now: () => at,
    retry,
    run: {
      source: "g2b",
      serviceKey: "g2b-bid-notice",
      operation: G2B_BID_NOTICE_LIST_OPERATION,
      runMode: "LIVE",
      trigger: "SCHEDULED",
      batch: null,
      jobKey,
      params: { window },
    },
    quota: quotaOf(store, dailyLimit),
  });

/** 보조 3종 카운터를 90% 로 채워 둔다(그날 보조 조회를 건너뛴 상황) */
const fillAuxTo90 = async (store: MemoryQuotaStore, dailyLimit: number) => {
  for (const scope of AUX_SCOPES)
    await store.add(scopedServiceId(SERVICE_ID, scope), at, Math.ceil(dailyLimit * 0.9));
};

const auxStatusOf = (repo: MemoryIngestionRepo, no: string) =>
  repo.state.revisions.find(({ normalized }) => normalized.noticeId === no)?.normalized.auxLookup
    ?.status;

describe("나라장터 오퍼레이션별 일일 예산", () => {
  it("목록과 보조 3종은 카운터를 따로 쓴다. 공유 한도라면 막혔을 호출 수(한도 2, 호출 4)도 모두 받는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 2 });
    const api = g2bApi(["SPLIT-001"]);
    const repo = createMemoryIngestionRepo();
    const result = await ingest(api, repo, store, "split-budget", 2);
    expect(api.operations).toEqual([
      G2B_BID_NOTICE_LIST_OPERATION,
      LICENSE.operation,
      REGION.operation,
      ATTACH.operation,
    ]);
    expect(result).toMatchObject({ status: "SUCCEEDED", summary: { created: 1 } });
    expect(await store.get(SERVICE_ID, at)).toBe(1);
    for (const scope of AUX_SCOPES)
      expect(await store.get(scopedServiceId(SERVICE_ID, scope), at)).toBe(1);
    expect(auxStatusOf(repo, "SPLIT-001")).toBe("OK");
  });

  it("보조 한 오퍼레이션의 결과코드 22 는 그 오퍼레이션만 막는다. 목록·다른 보조는 계속 부르고 run 은 성공한다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    const api = g2bApi(["LIMIT-001", "LIMIT-002"], new Set([LICENSE.operation]));
    const repo = createMemoryIngestionRepo();
    const result = await ingest(api, repo, store, "aux-22");
    expect(result).toMatchObject({ status: "SUCCEEDED", summary: { created: 2 } });
    // 첫 공고: 면허제한만 22, 지역·첨부는 받았다. 둘째 공고: 면허제한 카운터가 소진돼 보조 조회를 건너뛴다.
    expect(api.operations).toEqual([
      G2B_BID_NOTICE_LIST_OPERATION,
      LICENSE.operation,
      REGION.operation,
      ATTACH.operation,
    ]);
    expect(auxStatusOf(repo, "LIMIT-001")).toBe("FAILED");
    expect(auxStatusOf(repo, "LIMIT-002")).toBe("SKIPPED_QUOTA");
    expect(await store.get(scopedServiceId(SERVICE_ID, LICENSE.registryKey), at)).toBe(10);
    expect(await store.get(scopedServiceId(SERVICE_ID, REGION.registryKey), at)).toBe(1);
    expect(await store.get(SERVICE_ID, at)).toBe(1);
    expect(repo.state.errors.some(({ errorCode }) => errorCode === "QUOTA_EXCEEDED")).toBe(false);
  });
});

describe("보조 조회 다시 채우기(같은 revision)", () => {
  it("같은 공고를 다시 받으면 목록은 다시 부르지만 새 revision·이벤트 없이 빠진 보조만 채운다. 첨부·자격 행은 겹치지 않는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    await fillAuxTo90(store, 10);
    const repo = createMemoryIngestionRepo();
    const first = await ingest(g2bApi(["REFILL-001"]), repo, store, "refill-1");
    expect(first.summary.created).toBe(1);
    expect(auxStatusOf(repo, "REFILL-001")).toBe("SKIPPED_QUOTA");

    // 다음 날 예산으로 같은 공고를 다시 받는다.
    const nextDay = createMemoryQuotaStore({ dailyLimit: 10 });
    const again = g2bApi(["REFILL-001"]);
    const second = await ingest(again, repo, nextDay, "refill-2");
    expect(again.operations).toEqual([
      G2B_BID_NOTICE_LIST_OPERATION,
      LICENSE.operation,
      REGION.operation,
      ATTACH.operation,
    ]);
    expect(second.summary).toMatchObject({ created: 0, changed: 0, skippedDuplicate: 1 });
    expect(second.saved).toEqual([]);
    expect(repo.state.revisions).toHaveLength(1);
    expect(repo.state.outbox.map(({ type }) => type)).toEqual(["BID_CREATED"]);
    const [revision] = repo.state.revisions;
    expect(revision.revision).toBe(1);
    expect(revision.normalized.auxLookup).toEqual({ status: "OK", failed: [] });
    expect(repo.state.structuredRequirements.map(({ kind }) => kind).sort()).toEqual([
      "LICENSE_LIMIT",
      "PARTICIPATION_REGION",
    ]);
    const urls = repo.state.documents.map(({ originalUrl }) => originalUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((url) => url.includes("downloadRfpFile.do"))).toBe(true);

    // 채운 뒤에는 목록만 다시 받고 보조는 부르지 않는다. 아무것도 늘지 않는다.
    const third = g2bApi(["REFILL-001"]);
    await ingest(third, repo, nextDay, "refill-3");
    expect(third.operations).toEqual([G2B_BID_NOTICE_LIST_OPERATION]);
    expect(repo.state.revisions).toHaveLength(1);
    expect(repo.state.documents.map(({ originalUrl }) => originalUrl)).toEqual(urls);
  });

  it("다시 채우기 명령은 보조가 빠진 최신 revision 만 채우고, 마감이 지난 공고는 부르지 않는다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    await fillAuxTo90(store, 10);
    const repo = createMemoryIngestionRepo();
    await ingest(g2bApi(["CMD-001", "CMD-002"]), repo, store, "cmd-seed");
    const closed = repo.state.revisions.find(({ normalized }) => normalized.noticeId === "CMD-002");
    if (closed === undefined) throw new Error("CMD-002 가 저장되지 않았다");
    closed.normalized.deadlineAt = "2026-10-29T02:00:00.000Z";

    const api = g2bApi([]);
    const result = await refillG2bAux({
      repo,
      aux: api.aux,
      quota: quotaOf(createMemoryQuotaStore({ dailyLimit: 10 }), 10),
      now: () => at,
      limit: 10,
    });
    expect(result).toMatchObject({
      checked: 2,
      refilled: 1,
      closed: 1,
      incomplete: 0,
      calls: 3,
      stoppedBy: null,
    });
    expect(api.operations).toEqual([LICENSE.operation, REGION.operation, ATTACH.operation]);
    expect(repo.state.revisions).toHaveLength(2);
    expect(repo.state.outbox).toHaveLength(2);
    expect(auxStatusOf(repo, "CMD-001")).toBe("OK");
    expect(auxStatusOf(repo, "CMD-002")).toBe("SKIPPED_QUOTA");
  });

  it("다시 채우기 명령은 보조 오퍼레이션 예산이 90% 에 닿으면 부르지 않고 멈춘다", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    await fillAuxTo90(store, 10);
    const repo = createMemoryIngestionRepo();
    await ingest(g2bApi(["STOP-001"]), repo, store, "stop-seed");
    const api = g2bApi([]);
    const result = await refillG2bAux({
      repo,
      aux: api.aux,
      quota: quotaOf(store, 10),
      now: () => at,
      limit: 10,
    });
    expect(result).toMatchObject({ checked: 1, refilled: 0, calls: 0, stoppedBy: "QUOTA" });
    expect(api.operations).toEqual([]);
  });
});
