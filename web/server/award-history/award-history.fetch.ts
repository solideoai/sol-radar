import "server-only";
import {
  G2B_BID_NOTICE_LIST_OPERATION,
  G2B_MAX_ROWS,
  buildG2bListUrl,
  createG2bHttp,
  formatG2bDateTime,
  withRetry,
  type FetchLike,
  type G2bHttp,
  type G2bWindowSlice,
  type RetryDeps,
} from "@/server/ingestion";
import {
  awardRowOf,
  listEnvelopeOf,
  noticeRowOf,
  type AwardApiRow,
  type BackfillWindows,
  type NoticeApiRow,
} from "./award-history.model";

// ── 조달청 낙찰정보(15129397)·입찰공고(15129394) 목록을 받는다. 운영자 CLI(award-backfill) 전용 ──
// 요청 한 번은 createG2bHttp 가 처리한다(키 가리기·응답 크기 상한 20MB·게이트웨이 오류 분류). 이 파일은
// 기간 조각·쪽 넘기기·호출 상한만 맡는다. 서비스키는 쿼리로 나가므로 요청 URL 은 어디에도 남기지 않는다.

export const AWARD_SERVICE_ENDPOINT = "https://apis.data.go.kr/1230000/as/ScsbidInfoService";
export const AWARD_LIST_OPERATION = "getScsbidListSttusServc";
export const BID_NOTICE_SERVICE_ENDPOINT =
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
// 999행 응답은 낙찰 ≈ 0.7MB, 공고 ≈ 5MB(녹음 100행 490KB 기준)라 응답 상한(G2B_RESPONSE_MAX_BYTES 20MB) 안이다.
export const BACKFILL_ROWS = G2B_MAX_ROWS;
const TIMEOUT_MS = 60_000;

/** 호출 상한에 닿았다. 받은 데까지만 처리한다. */
export class CallLimitReached extends Error {
  constructor() {
    super("호출 상한");
    this.name = "CallLimitReached";
  }
}

/** 재시도 뒤에도 실패했다. message 는 createG2bHttp 의 detail(오퍼레이션·결과 코드·상태, 키는 가림)이다. */
export class BackfillFetchFailed extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BackfillFetchFailed";
  }
}

type Page<T> = { rows: T[]; totalCount: number };

export type AwardBackfillFetcher = {
  /** 낙찰 조각의 건수(numOfRows=1) */
  countAwards(slice: G2bWindowSlice): Promise<number>;
  fetchAwardPage(slice: G2bWindowSlice, pageNo: number): Promise<Page<AwardApiRow>>;
  fetchNoticePage(slice: G2bWindowSlice, pageNo: number): Promise<Page<NoticeApiRow>>;
  callsUsed(): number;
};

const awardUrlOf = (input: {
  serviceKey: string;
  slice: G2bWindowSlice;
  pageNo: number;
  numOfRows: number;
}): string =>
  `${AWARD_SERVICE_ENDPOINT}/${AWARD_LIST_OPERATION}?${new URLSearchParams([
    ["serviceKey", input.serviceKey],
    ["type", "json"],
    ["pageNo", String(input.pageNo)],
    ["numOfRows", String(input.numOfRows)],
    // 1 = 낙찰 등록일시(rgstDt) 기준(S1 확인)
    ["inqryDiv", "1"],
    ["inqryBgnDt", formatG2bDateTime(input.slice.from)],
    ["inqryEndDt", formatG2bDateTime(input.slice.to)],
  ]).toString()}`;

/**
 * 서비스키는 디코딩된 값을 받는다(URLSearchParams 가 한 번 인코딩한다). 재시도도 호출 한 번으로 센다.
 * 상한에 닿으면 CallLimitReached, 재시도 뒤에도 실패하면 BackfillFetchFailed 를 던진다.
 */
export function createAwardBackfillFetcher(options: {
  fetch: FetchLike;
  awardServiceKey: string;
  noticeServiceKey: string;
  maxCalls: number;
  retry: RetryDeps;
}): AwardBackfillFetcher {
  const awardHttp = createG2bHttp({
    serviceKey: options.awardServiceKey,
    fetch: options.fetch,
    timeoutMs: TIMEOUT_MS,
  });
  const noticeHttp = createG2bHttp({
    serviceKey: options.noticeServiceKey,
    fetch: options.fetch,
    timeoutMs: TIMEOUT_MS,
  });
  let used = 0;

  async function call(
    http: G2bHttp,
    url: string,
    operation: string,
  ): Promise<{ items: Record<string, unknown>[]; totalCount: number }> {
    const { outcome } = await withRetry(() => {
      if (used >= options.maxCalls) throw new CallLimitReached();
      used += 1;
      return http.fetchEnvelope(url, operation, listEnvelopeOf);
    }, options.retry);
    if (!outcome.ok) throw new BackfillFetchFailed(outcome.failure.detail);
    return outcome;
  }

  const awardPage = (slice: G2bWindowSlice, pageNo: number, numOfRows: number) =>
    call(
      awardHttp,
      awardUrlOf({ serviceKey: options.awardServiceKey, slice, pageNo, numOfRows }),
      AWARD_LIST_OPERATION,
    );

  return {
    async countAwards(slice) {
      return (await awardPage(slice, 1, 1)).totalCount;
    },
    async fetchAwardPage(slice, pageNo) {
      const page = await awardPage(slice, pageNo, BACKFILL_ROWS);
      return { rows: page.items.map(awardRowOf), totalCount: page.totalCount };
    },
    async fetchNoticePage(slice, pageNo) {
      const url = buildG2bListUrl({
        endpoint: BID_NOTICE_SERVICE_ENDPOINT,
        serviceKey: options.noticeServiceKey,
        pageNo,
        numOfRows: BACKFILL_ROWS,
        slice,
      });
      const page = await call(noticeHttp, url, G2B_BID_NOTICE_LIST_OPERATION);
      return {
        rows: page.items.map(noticeRowOf).filter((row): row is NoticeApiRow => row !== null),
        totalCount: page.totalCount,
      };
    },
    callsUsed: () => used,
  };
}

const pagesOf = (totalCount: number): number => Math.ceil(totalCount / BACKFILL_ROWS);

/** 낙찰 조각별 건수를 세어 받을 쪽 수를 돌려준다. */
export async function countAwardPages(
  fetcher: AwardBackfillFetcher,
  windows: BackfillWindows,
): Promise<{ awardCount: number; awardPages: number; counts: number[] }> {
  const counts: number[] = [];
  for (const slice of windows.award) counts.push(await fetcher.countAwards(slice));
  return {
    awardCount: counts.reduce((sum, count) => sum + count, 0),
    awardPages: counts.reduce((sum, count) => sum + pagesOf(count), 0),
    counts,
  };
}

export type CollectedBackfill = {
  awards: AwardApiRow[];
  notices: NoticeApiRow[];
  /** 호출 상한에 닿아 중간에 멈췄으면 true. 그때까지 받은 행은 그대로 둔다 */
  callLimitReached: boolean;
};

// 첫 쪽에서 받은 totalCount 로 남은 쪽을 정한다(건수를 센 뒤 새로 등록된 행까지 받는다).
async function collectPages<T>(
  fetchPage: (pageNo: number) => Promise<Page<T>>,
  sink: T[],
): Promise<void> {
  const first = await fetchPage(1);
  sink.push(...first.rows);
  for (let pageNo = 2; pageNo <= pagesOf(first.totalCount); pageNo += 1) {
    sink.push(...(await fetchPage(pageNo)).rows);
  }
}

/**
 * 낙찰을 먼저 받고(호출이 적고 쪽 수를 미리 안다), 공고는 받은 낙찰의 공고번호만 남긴다(14개월치 공고 전부를 들고 있지 않게).
 * awardCounts 는 countAwardPages 의 조각별 건수다. 0건 조각은 부르지 않는다.
 */
export async function collectBackfill(
  fetcher: AwardBackfillFetcher,
  windows: BackfillWindows,
  awardCounts: readonly number[],
): Promise<CollectedBackfill> {
  const awards: AwardApiRow[] = [];
  const notices: NoticeApiRow[] = [];
  try {
    for (const [index, slice] of windows.award.entries()) {
      if ((awardCounts[index] ?? 0) === 0) continue;
      await collectPages((pageNo) => fetcher.fetchAwardPage(slice, pageNo), awards);
    }
    const wanted = new Set(awards.map((award) => award.bidNoticeNo));
    for (const slice of windows.notice) {
      const day: NoticeApiRow[] = [];
      try {
        await collectPages((pageNo) => fetcher.fetchNoticePage(slice, pageNo), day);
      } finally {
        notices.push(...day.filter((notice) => wanted.has(notice.bidNoticeNo)));
      }
    }
    return { awards, notices, callLimitReached: false };
  } catch (error) {
    if (error instanceof CallLimitReached) return { awards, notices, callLimitReached: true };
    throw error;
  }
}
