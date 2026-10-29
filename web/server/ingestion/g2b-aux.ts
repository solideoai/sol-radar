import "server-only";
import {
  CONNECTOR_TIMEOUT_MS,
  type BeforeApiRequest,
  type ConnectorFailure,
  type G2bItem,
} from "./connector.model";
import { createG2bHttp, validateG2bTimeout, type FetchLike } from "./g2b-http";
import { buildG2bAuxUrl } from "./g2b-request";
import {
  G2B_AUX_OPERATIONS,
  G2B_MAX_ROWS,
  parseG2bAuxEnvelope,
  stripContactFields,
  type G2bAuxOperation,
  type G2bAuxRegistryKey,
} from "./g2b.model";
import {
  validateG2bEndpoint,
  validateG2bNumOfRows,
  validateG2bServiceKey,
} from "./official-api-connector";
import { withRetry, type RetryDeps } from "./retry";

// ── G2bAuxFetcher: 보조 조회 3종을 공고 1건 단위로 부른다(07 §2.2, C1 증거 §10-3) ──
// live 전용이다. ingestion.service 가 새 revision(재분석 대상)에만 부르고, 세 오퍼레이션은 서로 독립이라
// 하나가 실패해도 나머지 결과는 쓴다. 실패는 값으로 돌려주고(run 을 깨지 않는다) 호출 수는 재시도까지 센다.
export type G2bAuxRequest = {
  noticeId: string;
  /** 차수(bidNtceOrd). 목록 행에 없으면 null */
  amendmentNo: string | null;
  /** 공고 등록 시각. 보조 조회 기간(−1일~+6일)의 기준 */
  registeredAt: Date;
  beforeRequest?: BeforeApiRequest;
};

export type G2bAuxRows = {
  licenseLimit: G2bItem[];
  region: G2bItem[];
  eorderAttach: G2bItem[];
};

export type G2bAuxFailure = {
  operation: G2bAuxOperation;
  registryKey: G2bAuxRegistryKey;
  failure: ConnectorFailure;
};

export type G2bAuxOutcome = {
  /** 성공한 오퍼레이션의 행(담당자 필드 제거, 다른 공고의 행 제외). 실패·미호출 오퍼레이션은 빈 배열 */
  rows: G2bAuxRows;
  failures: G2bAuxFailure[];
  /** 예약 저장소 장애 뒤 부르지 않은 operation의 registryKey. 실패한 operation은 failures에 있다. */
  skipped: G2bAuxRegistryKey[];
  /** 이 요청에서 나간 공공 API 호출 수(재시도·쪽 포함). quota_used 에 더한다 */
  calls: number;
  retried: number;
};

export type G2bAuxFetcher = {
  fetchAux(request: G2bAuxRequest): Promise<G2bAuxOutcome>;
};

export type G2bAuxFetcherOptions = {
  endpoint: string;
  serviceKey: string;
  fetch: FetchLike;
  retry: RetryDeps;
  numOfRows?: number;
  timeoutMs?: number;
};

/** 공고 1건의 보조 행은 수십 행을 넘지 않는다. 그래도 totalCount 가 더 크면 이 쪽수까지만 더 받는다 */
export const G2B_AUX_MAX_PAGES = 5;
export const EMPTY_AUX_ROWS: Readonly<G2bAuxRows> = Object.freeze({
  licenseLimit: [],
  region: [],
  eorderAttach: [],
});

const ROWS_KEY_OF: Readonly<Record<G2bAuxOperation, keyof G2bAuxRows>> = {
  getBidPblancListInfoLicenseLimit: "licenseLimit",
  getBidPblancListInfoPrtcptPsblRgn: "region",
  getBidPblancListInfoEorderAtchFileInfo: "eorderAttach",
};

type PagesResult =
  | { ok: true; items: G2bItem[]; calls: number; retried: number }
  | { ok: false; failure: ConnectorFailure; calls: number; retried: number };

/** 다른 공고의 행은 버린다. inqryDiv=1 로 받은 창 전체가 섞여 와도(녹음 재생·필터 무시) 이 공고의 행만 남는다. */
export const auxRowsForNotice = (items: readonly G2bItem[], noticeId: string): G2bItem[] =>
  items.filter((item) => item.bidNtceNo === noticeId);

export function createG2bAuxFetcher(options: G2bAuxFetcherOptions): G2bAuxFetcher {
  const who = "G2bAuxFetcher";
  const endpoint = validateG2bEndpoint(options.endpoint, who);
  const serviceKey = validateG2bServiceKey(options.serviceKey, who);
  // 공고 1건의 행은 적어 한 쪽에 다 온다. 상한(999)으로 받아 쪽을 더 부르지 않게 한다.
  const numOfRows = validateG2bNumOfRows(options.numOfRows ?? G2B_MAX_ROWS, who);
  const timeoutMs = validateG2bTimeout(options.timeoutMs ?? CONNECTOR_TIMEOUT_MS, who);
  const http = createG2bHttp({ serviceKey, fetch: options.fetch, timeoutMs });

  async function fetchPages(
    { operation, registryKey }: (typeof G2B_AUX_OPERATIONS)[number],
    request: G2bAuxRequest,
  ): Promise<PagesResult> {
    const items: G2bItem[] = [];
    let calls = 0;
    let retried = 0;
    for (let pageNo = 1; pageNo <= G2B_AUX_MAX_PAGES; pageNo += 1) {
      const url = buildG2bAuxUrl({
        endpoint,
        serviceKey,
        operation,
        noticeId: request.noticeId,
        amendmentNo: request.amendmentNo,
        registeredAt: request.registeredAt,
        pageNo,
        numOfRows,
      });
      const callsBeforePage = calls;
      const attempt = await withRetry(
        () =>
          http.fetchEnvelope(url, operation, parseG2bAuxEnvelope, async () => {
            // 일일 한도가 오퍼레이션마다 따로라 registryKey 로 따로 예약한다(quota.ts scopedServiceId).
            const denied = await request.beforeRequest?.(registryKey);
            if (!denied) calls++;
            return denied ?? null;
          }),
        options.retry,
      );
      // 예약 거절로 HTTP를 보내지 않은 시도는 재시도 수에도 더하지 않는다.
      retried += Math.max(0, calls - callsBeforePage - 1);
      const { outcome } = attempt;
      if (!outcome.ok) return { ok: false, failure: outcome.failure, calls, retried };
      items.push(...outcome.items);
      // 받은 행이 없거나 totalCount 를 채웠으면 끝. 서버가 totalCount 보다 적게 주는 경우에도 빈 쪽에서 멈춘다.
      if (outcome.items.length === 0 || items.length >= outcome.totalCount) break;
    }
    return { ok: true, items, calls, retried };
  }

  async function fetchAux(request: G2bAuxRequest): Promise<G2bAuxOutcome> {
    const rows: G2bAuxRows = { licenseLimit: [], region: [], eorderAttach: [] };
    const failures: G2bAuxFailure[] = [];
    const skipped: G2bAuxRegistryKey[] = [];
    let calls = 0;
    let retried = 0;
    // 차례로 부른다. 같은 서비스의 호출이라 동시에 보내면 초당 한도(30 tps)에 더 빨리 닿는다.
    for (const [index, entry] of G2B_AUX_OPERATIONS.entries()) {
      const { operation, registryKey } = entry;
      const result = await fetchPages(entry, request);
      calls += result.calls;
      retried += result.retried;
      if (!result.ok) {
        failures.push({ operation, registryKey, failure: result.failure });
        // 한도는 오퍼레이션마다 따로라 한 오퍼레이션의 한도 초과(22·예약 거절)는 다른 오퍼레이션을 막지 않는다.
        // 예약 저장소 장애는 어느 예산도 확인할 수 없어 남은 operation 을 부르지 않는다.
        if (result.failure.kind === "QUOTA_UNAVAILABLE") {
          skipped.push(...G2B_AUX_OPERATIONS.slice(index + 1).map((next) => next.registryKey));
          break;
        }
        continue;
      }
      rows[ROWS_KEY_OF[operation]] = auxRowsForNotice(result.items, request.noticeId).map(
        stripContactFields,
      );
    }
    return { rows, failures, skipped, calls, retried };
  }

  return { fetchAux };
}
