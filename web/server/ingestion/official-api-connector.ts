import "server-only";
import { z } from "zod";
import {
  CONNECTOR_TIMEOUT_MS,
  type BidSourceConnector,
  type FetchPageInput,
  type FetchPageOutcome,
  type G2bItem,
  type RateLimitInfo,
  type SourceRecord,
} from "./connector.model";
import { DEFAULT_INFO_BIZ_FILTER } from "./g2b-filter";
import { createG2bHttp, validateG2bTimeout, type FetchLike } from "./g2b-http";
import { buildG2bListUrl, splitG2bWindow } from "./g2b-request";
import {
  G2B_API_HOST,
  G2B_BID_NOTICE_LIST_OPERATION,
  G2B_DEFAULT_ROWS,
  G2B_MAX_ROWS,
  parseG2bEnvelope,
  stripContactFields,
} from "./g2b.model";

// ── OfficialApiConnector: 나라장터 입찰공고 목록(15129394 getBidPblancListInfoServc) ──
// 요청 한 번의 HTTP·봉투 처리는 g2b-http.ts 가 한다(보조 조회와 같은 규칙). 여기는 창 조각·cursor·필터만 안다.
export type { FetchLike } from "./g2b-http";

export type OfficialApiConnectorOptions = {
  endpoint: string;
  serviceKey: string;
  fetch: FetchLike;
  numOfRows?: number;
  timeoutMs?: number;
  isInfoBizNotice?: (item: G2bItem) => boolean;
};

const OPERATION = G2B_BID_NOTICE_LIST_OPERATION;
const CURSOR_PATTERN = /^(\d+):(\d+)$/;
const isoInstantSchema = z.iso.datetime({ offset: true });
const emptyPage = (): FetchPageOutcome => ({
  ok: true,
  page: { records: [], nextCursor: null, rateLimitInfo: null },
});

type PageCursor = { sliceIndex: number; pageNo: number };

// 생성 오류 메시지에 받은 값을 넣지 않는다. endpoint·키가 로그로 새지 않게 한다.
export function validateG2bEndpoint(endpoint: string, who: string): string {
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  const isAllowed =
    url !== null &&
    url.protocol === "https:" &&
    url.hostname === G2B_API_HOST &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "";
  if (!isAllowed) {
    throw new Error(`${who}: endpoint 는 https://${G2B_API_HOST} 아래 경로여야 한다`);
  }
  return endpoint;
}

export function validateG2bNumOfRows(numOfRows: number, who: string): number {
  if (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > G2B_MAX_ROWS) {
    throw new Error(`${who}: numOfRows 는 1~${G2B_MAX_ROWS} 정수여야 한다`);
  }
  return numOfRows;
}

export function validateG2bServiceKey(serviceKey: string, who: string): string {
  if (serviceKey.trim() === "") throw new Error(`${who}: serviceKey 가 비어 있다`);
  return serviceKey;
}

// 수집 창은 서비스가 run.params 에서 넘긴다. ISO 가 아니면 호출자의 프로그램 오류라 던진다.
function instantOf(value: string | null, name: "from" | "to"): Date {
  if (value === null || !isoInstantSchema.safeParse(value).success) {
    throw new Error(`OfficialApiConnector: ${name} 는 ISO 8601 시각이어야 한다`);
  }
  return new Date(Date.parse(value));
}

function cursorOf(cursor: string | null, sliceCount: number): PageCursor {
  if (cursor === null) return { sliceIndex: 0, pageNo: 1 };
  const match = CURSOR_PATTERN.exec(cursor);
  const sliceIndex = match ? Number(match[1]) : Number.NaN;
  const pageNo = match ? Number(match[2]) : Number.NaN;
  if (!(sliceIndex < sliceCount) || !(pageNo >= 1)) {
    throw new Error("OfficialApiConnector: cursor 는 '{조각}:{쪽}' 형식이고 범위 안이어야 한다");
  }
  return { sliceIndex, pageNo };
}

function nextCursorOf(
  { sliceIndex, pageNo }: PageCursor,
  numOfRows: number,
  totalCount: number,
  sliceCount: number,
): string | null {
  if (pageNo * numOfRows < totalCount) return `${sliceIndex}:${pageNo + 1}`;
  return sliceIndex + 1 < sliceCount ? `${sliceIndex + 1}:1` : null;
}

export function createOfficialApiConnector(
  options: OfficialApiConnectorOptions,
): BidSourceConnector {
  const who = "OfficialApiConnector";
  const endpoint = validateG2bEndpoint(options.endpoint, who);
  const serviceKey = validateG2bServiceKey(options.serviceKey, who);
  const numOfRows = validateG2bNumOfRows(options.numOfRows ?? G2B_DEFAULT_ROWS, who);
  const timeoutMs = validateG2bTimeout(options.timeoutMs ?? CONNECTOR_TIMEOUT_MS, who);
  const isInfoBizNotice = options.isInfoBizNotice ?? DEFAULT_INFO_BIZ_FILTER;
  const http = createG2bHttp({ serviceKey, fetch: options.fetch, timeoutMs });

  async function fetchPage(input: FetchPageInput): Promise<FetchPageOutcome> {
    const slices = splitG2bWindow(instantOf(input.from, "from"), instantOf(input.to, "to"));
    if (slices.length === 0) return emptyPage();
    const cursor = cursorOf(input.cursor, slices.length);

    const url = buildG2bListUrl({
      endpoint,
      serviceKey,
      pageNo: cursor.pageNo,
      numOfRows,
      slice: slices[cursor.sliceIndex],
    });
    const result = await http.fetchEnvelope(url, OPERATION, parseG2bEnvelope);
    if (!result.ok) return result;

    // 필터는 담당자 필드가 있는 원본 행으로 판정하고, 담는 것은 담당자 필드를 뺀 행이다.
    const records = result.items
      .filter((item) => isInfoBizNotice(item))
      .map((item): SourceRecord => ({ kind: "g2b-bid-notice", item: stripContactFields(item) }));
    const rateLimitInfo: RateLimitInfo = {
      limit: null,
      remaining: result.rateLimitRemaining,
      retryAfterSec: null,
    };
    return {
      ok: true,
      page: {
        records,
        nextCursor: nextCursorOf(cursor, numOfRows, result.totalCount, slices.length),
        rateLimitInfo,
      },
    };
  }

  return { source: "g2b", fetchPage };
}
