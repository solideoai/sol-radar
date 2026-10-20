import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { BidSourceConnector, G2bItem } from "./connector.model";
import { createG2bAuxFetcher, type G2bAuxFetcher } from "./g2b-aux";
import { G2B_DEFAULT_ROWS, G2B_MAX_ROWS } from "./g2b.model";
import { createOfficialApiConnector, type FetchLike } from "./official-api-connector";
import type { RetryDeps } from "./retry";

// ── RecordedApiConnector: fixtures/recorded/ 의 녹음 응답(담당자 필드 마스킹)을 재생한다(07 §2.1·§2.3) ──
// 시험·개발 전용이다. 세 실행 모드(LIVE·FIXTURE·MOCK)의 connector 선택에는 넣지 않는다. 네트워크를 부르지 않는다.
export const RECORDED_SCHEMA_VERSION = "sol-recorded/v0.1";
/** 재생용 가짜 키. 실제 서비스키가 아니며, OfficialApiConnector 가 빈 키를 거부하므로 자리만 채운다 */
export const RECORDED_REPLAY_SERVICE_KEY = "recorded-replay-not-a-service-key";

const RECORDED_ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const RESPONSE_ENVELOPE = "response";
const ERROR_ENVELOPE = "nkoneps.com.response.ResponseError";

// 녹음에 서비스키가 섞여 들어가면 저장소에 키가 커밋된다. 이름이 servicekey 인 파라미터는 형식 오류로 거부한다.
const recordedParamsSchema = z
  .record(z.string(), z.string())
  .refine((params) => !Object.keys(params).some((key) => key.toLowerCase() === "servicekey"), {
    error: "params 에 서비스키 파라미터가 있다",
  });

export const recordedResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(RECORDED_SCHEMA_VERSION),
    serviceId: z.string().min(1),
    registryKey: z.string().min(1),
    operation: z.string().min(1),
    params: recordedParamsSchema,
    fetchedAt: z.iso.datetime(),
    httpStatus: z.number().int().min(200).max(599),
    envelope: z.enum([RESPONSE_ENVELOPE, ERROR_ENVELOPE]),
    resultCode: z.string(),
    resultMsg: z.string(),
    totalCount: z.number().int().min(0).nullable(),
    items: z.array(z.record(z.string(), z.unknown())),
    masked: z.literal(true),
    maskedFields: z.array(z.string()),
    maskedFieldsNote: z.string(),
    rawSha256: z.string().regex(/^[0-9a-f]{64}$/),
    note: z.string(),
  })
  .refine((recorded) => recorded.envelope !== RESPONSE_ENVELOPE || recorded.totalCount !== null, {
    error: "response 봉투의 totalCount 는 숫자다",
    path: ["totalCount"],
  });

export type RecordedResponse = z.infer<typeof recordedResponseSchema>;

// zod 메시지에는 받은 값이 들어갈 수 있다. 녹음에 섞인 키가 오류로 새지 않게 경로만 남긴다.
const issuePathsOf = (error: z.ZodError): string =>
  [
    ...new Set(
      error.issues.map(({ path }) => (path.length === 0 ? "(root)" : path.map(String).join("."))),
    ),
  ].join(", ");

export function parseRecordedResponse(json: unknown): RecordedResponse {
  const parsed = recordedResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`녹음 응답 형식이 잘못됐다: ${issuePathsOf(parsed.error)}`);
  }
  return parsed.data;
}

function parseJsonFile(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`녹음 파일이 JSON 이 아니다: ${path}`);
  }
}

export async function loadRecordedResponse(path: string): Promise<RecordedResponse> {
  return parseRecordedResponse(parseJsonFile(await readFile(path, "utf8"), path));
}

/** 녹음을 나라장터가 실제로 보내는 봉투 모양으로 되돌린다. */
export function toG2bEnvelopeBody(recorded: RecordedResponse): unknown {
  const header = { resultCode: recorded.resultCode, resultMsg: recorded.resultMsg };
  if (recorded.envelope === ERROR_ENVELOPE) return { [ERROR_ENVELOPE]: { header } };
  return {
    response: {
      header,
      body: {
        items: recorded.items,
        numOfRows: Number(recorded.params.numOfRows),
        pageNo: Number(recorded.params.pageNo),
        totalCount: recorded.totalCount,
      },
    },
  };
}

const notFound = (): Response =>
  new Response("recording not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });

type RequestedPage = { operation: string; pageNo: string | null; bidNtceNo: string | null };

const requestedPage = (url: string): RequestedPage | null => {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return {
    operation: parsed.pathname.split("/").at(-1) ?? "",
    pageNo: parsed.searchParams.get("pageNo"),
    bidNtceNo: parsed.searchParams.get("bidNtceNo"),
  };
};

/**
 * 오퍼레이션·pageNo 가 같은 녹음 가운데 고른다. 보조 조회(bidNtceNo 요청)는 같은 bidNtceNo 로 녹음한 것을 먼저,
 * 없으면 bidNtceNo 없이(inqryDiv=1 창) 녹음한 것을 돌려준다 — 창 녹음에는 여러 공고의 행이 섞여 있어 받는 쪽이
 * bidNtceNo 로 거른다(실제 inqryDiv=1 응답이 bidNtceNo 를 무시하는 것과 같은 모양). 목록 요청은 bidNtceNo 가 없다.
 */
export function findRecording(
  recordings: readonly RecordedResponse[],
  requested: RequestedPage,
): RecordedResponse | undefined {
  const samePage = recordings.filter(
    (candidate) =>
      candidate.operation === requested.operation && candidate.params.pageNo === requested.pageNo,
  );
  if (requested.bidNtceNo !== null) {
    const exact = samePage.find((candidate) => candidate.params.bidNtceNo === requested.bidNtceNo);
    if (exact) return exact;
  }
  return samePage.find((candidate) => candidate.params.bidNtceNo === undefined);
}

/** 녹음을 재생하는 fetch. 받은 URL 에는 키가 있어 저장·출력하지 않는다. */
export function createRecordedFetch(recordings: readonly RecordedResponse[]): FetchLike {
  return async (url, init) => {
    init.signal.throwIfAborted();
    const requested = requestedPage(url);
    const recording = requested === null ? undefined : findRecording(recordings, requested);
    // 없는 쪽을 빈 쪽으로 지어내지 않는다. 404 → HTTP_ERROR 로 run 이 멈추는 것이 정상이다.
    if (!recording) return notFound();
    return new Response(JSON.stringify(toG2bEnvelopeBody(recording)), {
      status: recording.httpStatus,
      headers: { "content-type": "application/json" },
    });
  };
}

const recordedRows = (recordings: readonly RecordedResponse[]): number => {
  const rows = Number(recordings[0]?.params.numOfRows);
  return Number.isInteger(rows) && rows >= 1 && rows <= G2B_MAX_ROWS ? rows : G2B_DEFAULT_ROWS;
};

export function createRecordedApiConnector(options: {
  recordings: readonly RecordedResponse[];
  numOfRows?: number;
  isInfoBizNotice?: (item: G2bItem) => boolean;
}): BidSourceConnector {
  return createOfficialApiConnector({
    endpoint: RECORDED_ENDPOINT,
    serviceKey: RECORDED_REPLAY_SERVICE_KEY,
    fetch: createRecordedFetch(options.recordings),
    numOfRows: options.numOfRows ?? recordedRows(options.recordings),
    ...(options.isInfoBizNotice === undefined ? {} : { isInfoBizNotice: options.isInfoBizNotice }),
  });
}

/** 녹음을 재생하는 보조 조회 3종. 시험 전용이다. 네트워크를 부르지 않는다. */
export function createRecordedAuxFetcher(options: {
  recordings: readonly RecordedResponse[];
  retry: RetryDeps;
  numOfRows?: number;
}): G2bAuxFetcher {
  return createG2bAuxFetcher({
    endpoint: RECORDED_ENDPOINT,
    serviceKey: RECORDED_REPLAY_SERVICE_KEY,
    fetch: createRecordedFetch(options.recordings),
    retry: options.retry,
    ...(options.numOfRows === undefined ? {} : { numOfRows: options.numOfRows }),
  });
}
