// 시험 전용 도우미(web/worker/analysis-job.test.ts). 제품 코드가 import 하지 않는다.
// worker 는 analysis 도메인의 배럴(@/server/analysis)만 부를 수 있어 2단계 test-support 를 쓰지 못한다.
// 필요한 만큼만 같은 방식(node:fs + import.meta.url)으로 fixtures/ 를 읽고, 3b mock 모양의 gateway 응답을 만든다.
// 가짜 fetch 는 실제 createGatewayClient 에 넣는다. 1단계의 재시도·breaker 를 그대로 거치게 하려는 것이다.
import { readFileSync } from "node:fs";
import {
  createGatewayClient,
  type AnalysisContext,
  type AnalysisContextLoader,
  type AnalysisRunRecord,
  type AnalysisRunSink,
  type AnalysisRunTracker,
  type CachedExtraction,
  type ExtractSource,
  type ExtractionCacheKey,
  type ExtractionRecord,
  type ExtractionStore,
  type GatewayConfig,
  type GatewayHealth,
  type LoadedAnalysisContext,
} from "@/server/analysis";
import {
  KEV_DISCLAIMER,
  toScoringTeam,
  type CompanyProfile,
  type KevMockResponse,
  type NormalizedBidSummary,
  type RequirementExtraction,
  type ScoringPerson,
  type ScoringTeamInput,
} from "@/server/scoring";

// ── fixture 읽기 ──

const readText = (path: string): string =>
  readFileSync(new URL(`../../fixtures/${path}`, import.meta.url), "utf8");
const readJson = <T>(path: string): T => JSON.parse(readText(path)) as T;

function readCalculationDate(): string {
  const match = /^calculationDate:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m.exec(readText("manifest.yaml"));
  if (!match) throw new Error("fixtures/manifest.yaml 에 calculationDate 가 없다");
  return match[1];
}

/** fixtures/manifest.yaml calculationDate. 시계는 이 날의 KST 18:00 근처로 고정한다. */
export const CALCULATION_DATE = readCalculationDate();
const FIXTURE_FETCHED_AT = `${CALCULATION_DATE}T09:00:00Z`;
/** C6 가 QUEUED 행을 넣은 시각(score_runs.queued_at). loader 가 돌려준다. */
export const QUEUED_AT = `${CALCULATION_DATE}T08:59:30.000Z`;

type BidRecord = {
  amendmentNo: string;
  noticeId: string;
  title: string;
  agency: string | null;
  budgetKrw: string | null;
  noticeDate: string | null;
  deadlineAt: string | null;
  stage: "PLAN" | "PRE_SPEC" | "NOTICE";
  content: string;
};

function bidRecord(id: string): BidRecord {
  return readJson<{ records: BidRecord[] }>(`bids/${id}.json`).records[0];
}

/** ADR-014: "+21d" 같은 상대 표기를 기준일 + N일의 KST 18:00(= UTC 09:00)로 바꾼다. 절대 ISO 는 그대로. */
function relativeDate(spec: string | null): string | null {
  if (spec === null) return null;
  const match = /^([+-])(\d+)d$/.exec(spec);
  if (!match) return spec;
  const days = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const [year, month, day] = CALCULATION_DATE.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0)).toISOString();
}

/** 공고 원문(fixture content). 로그에 새지 않는지 볼 때 쓴다. */
export function bidContent(id: string): string {
  return bidRecord(id).content;
}

export function loadBid(id: string): NormalizedBidSummary {
  const record = bidRecord(id);
  return {
    noticeId: record.noticeId,
    revisionId: `${id}#${record.amendmentNo}`,
    title: record.title,
    agency: record.agency,
    stage: record.stage,
    budgetKrw: record.budgetKrw,
    deadlineAt: relativeDate(record.deadlineAt),
    noticeDate: relativeDate(record.noticeDate),
    fetchedAt: FIXTURE_FETCHED_AT,
    projectPeriod: null,
    structuredQualifications: [],
  };
}

export function loadExtraction(id: string): RequirementExtraction {
  return readJson<RequirementExtraction>(`extractions/${id}.json`);
}

export function loadKevResponses(id: string): KevMockResponse["responses"] {
  return readJson<KevMockResponse>(`kev/${id}.json`).responses;
}

export function loadProfile(): CompanyProfile {
  return readJson<CompanyProfile>("company/solideo-profile.json");
}

export function loadTeam(): ScoringTeamInput {
  const people = readJson<{
    people: ScoringPerson[];
    assignments: {
      personId: string;
      startsAt: string;
      endsAt: string;
      allocationPercent: number;
    }[];
    asOf: string;
  }>("people/solideo.people.json");
  return toScoringTeam(people.people, people.assignments, people.asOf);
}

/** 깊은 복사 뒤 일부를 바꾼다. 원본을 변형하지 않는다. */
export function withPatch<T>(value: T, patch: (draft: T) => void): T {
  const draft = structuredClone(value);
  patch(draft);
  return draft;
}

// ── 식별자 ──

export const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
export const OTHER_ORG_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const SCORE_RUN_ID = "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
export const OTHER_SCORE_RUN_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
export const REQUEST_ID = "req-FX-01";
export const IDEMPOTENCY_KEY = `${ORG_ID}:${REQUEST_ID}`;
export const COMPANY_PROFILE_ID = "c0ffee00-1234-4abc-9def-000000000001";
export const CACHED_EXTRACTION_ID = "e0000000-0000-4000-8000-000000000001";

/** fixture 추출을 담은 유효한 캐시 행(requirement_extractions 한 행, 2b 모양). */
export function cachedRow(id: string, rowId = CACHED_EXTRACTION_ID): CachedExtraction {
  return { id: rowId, status: "COMPLETED", payload: loadExtraction(id), translations: null };
}

/** loader 가 돌려줄 값. FX-01·QUEUED(started_at 없음)·캐시 추출 있음·첨부 문제 없음. */
export function loaded(
  id = "FX-01",
  overrides: Partial<LoadedAnalysisContext> = {},
): LoadedAnalysisContext {
  return {
    orgId: ORG_ID,
    scoreRunId: SCORE_RUN_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    status: "QUEUED",
    startedAt: null,
    bidId: `bid-${id}`,
    companyProfileId: COMPANY_PROFILE_ID,
    fixtureId: `${id}.r01`,
    bid: loadBid(id),
    extraction: cachedRow(id),
    profile: loadProfile(),
    team: loadTeam(),
    documentIssues: [],
    queuedAt: QUEUED_AT,
    ...overrides,
  };
}

/** loadSource 가 돌려줄 원문. */
export function sourceFor(id: string): ExtractSource {
  return {
    body: bidContent(id),
    attachments: [
      {
        documentId: `${id}-rfp`,
        text: "가상 제안요청서 본문",
        pages: [{ page: 1, charOffset: 0 }],
      },
    ],
  };
}

// ── 3b mock 모양의 gateway 응답 본문 ──

const KEV_MS = 37;
const STATE_HASH = "c".repeat(64);
export const MOCK_EXPLAIN_TEXT = "gateway mock 템플릿 설명 문장";
export const HEALTH_QWEN = { model: "fixture", promptHash: "e".repeat(64) };

/** GET /health 200 본문. 기본은 mock 모드·Kev 켜짐·qwen 있음. */
export function healthBody(overrides: Partial<GatewayHealth> = {}): GatewayHealth {
  return {
    status: "ok",
    runMode: "mock",
    provider: "mock",
    kevEnabled: true,
    qwen: HEALTH_QWEN,
    kev: { modelId: "mock", registryMatch: null },
    questionSets: ["kev-qs/v0.1"],
    parsers: [{ format: "pdf", parserId: null }],
    ...overrides,
  };
}

/** 3b 통보 /kev mock(Kev 사용): wire=[{responses, usage, latency_ms}], provider·model "mock", requestId null. */
export function kevUsedBody(responses: KevMockResponse["responses"]) {
  return {
    kev: {
      enabled: true,
      provider: "mock",
      model: "mock",
      questionSetVersion: "kev-qs/v0.1",
      suggestedOption: responses.recommendation.choice,
      probabilities: responses.recommendation.probabilities,
      confidence: responses.recommendation.confidence,
      mandatoryRisk: responses.mandatoryRisk.noul,
      needsHumanReview: responses.needsHumanReview.noul,
      fit: { score: responses.fit.score, legend: responses.fit.legend },
      scores: null,
      risks: null,
      calibration: null,
      stateTrace: null,
      latencyMs: KEV_MS,
      requestId: null,
      disclaimer: KEV_DISCLAIMER,
    },
    stateHash: STATE_HASH,
    requirements: null,
    wire: [{ responses, usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: KEV_MS }],
    timings: { kevMs: KEV_MS },
    errorCode: null,
  };
}

/** /explain 응답. 3b mock 은 늘 fallback=true 다. */
export function explainBody(text = MOCK_EXPLAIN_TEXT, fallback = true) {
  return { text, usedNumbers: [], fallback };
}

/** /extract 200 COMPLETED 응답. */
export function extractBody(payload: unknown) {
  return {
    status: "COMPLETED",
    payload,
    translations: null,
    errorCode: null,
    injectionSuspected: false,
    warnings: [],
    timings: { extractMs: 1234 },
  };
}

// ── 가짜 fetch ──

export type Reply = () => Promise<Response>;

export const jsonReply =
  (body: unknown, status = 200): Reply =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

/** 내부 주소가 메시지에 든 undici 연결 거부. 로그로 새면 안 된다. */
export const LEAKY_ADDRESS = "10.0.0.5";
export const refusedReply: Reply = () =>
  Promise.reject(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error(`connect ECONNREFUSED ${LEAKY_ADDRESS}:8000`), {
        code: "ECONNREFUSED",
      }),
    }),
  );

export type GatewayPath = "/health" | "/extract" | "/kev" | "/explain";
export type GatewayRoutes = Partial<Record<GatewayPath, Reply>>;

const GATEWAY_CONFIG: GatewayConfig = {
  baseUrl: "http://gw.test:8000",
  extractTimeoutMs: 11_000,
  explainTimeoutMs: 12_000,
  kevTimeoutMs: 13_000,
  healthTimeoutMs: 14_000,
};

/** breaker 시각. 고정이라 한 번 열린 breaker 는 시험 안에서 닫히지 않는다. */
const BREAKER_NOW = 1_000_000;

/** 경로마다 준비한 답을 쓴다. 준비하지 않은 경로는 404 다. 프로세스당 하나인 gateway 처럼 시도 사이에 이어 쓴다. */
export function fakeGateway(routes: GatewayRoutes) {
  const paths: string[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    paths.push(path);
    const reply = routes[path as GatewayPath];
    return reply ? reply() : jsonReply({ errorCode: "NOT_ROUTED" }, 404)();
  };
  const gateway = createGatewayClient(GATEWAY_CONFIG, { fetch, now: () => BREAKER_NOW });
  return {
    gateway,
    paths,
    /** 그 경로로 실제로 나간 HTTP 요청 수(재시도 포함). */
    count: (path: GatewayPath) => paths.filter((called) => called === path).length,
  };
}

/** 정상 gateway: /health mock, /kev 3b mock(fixture responses), /explain mock 템플릿. */
export function healthyRoutes(id = "FX-01", health: Partial<GatewayHealth> = {}): GatewayRoutes {
  return {
    "/health": jsonReply(healthBody(health)),
    "/kev": jsonReply(kevUsedBody(loadKevResponses(id))),
    "/explain": jsonReply(explainBody()),
  };
}

/** 모든 경로가 연결 거부(gateway 컨테이너가 죽음). */
export const downRoutes: GatewayRoutes = {
  "/health": refusedReply,
  "/extract": refusedReply,
  "/kev": refusedReply,
  "/explain": refusedReply,
};

// ── 시계 ──

/** 준비한 시각을 차례로 돌려주고, 다 쓰면 마지막 시각을 되풀이한다. 부른 횟수를 센다. */
export function clock(...isoTimes: string[]) {
  let calls = 0;
  const now = () => {
    const iso = isoTimes[Math.min(calls, isoTimes.length - 1)];
    calls += 1;
    return new Date(iso);
  };
  return { now, calls: () => calls };
}

// ── 가짜 port ──

/** 여러 가짜 port 의 호출 순서를 한 줄로 남긴다. */
export type EventLog = string[];

export type LoadCall = {
  target: { orgId: string; scoreRunId: string };
  cacheKey: ExtractionCacheKey;
};

/** 시도마다 next() 의 값을 돌려주는 가짜 loader. 던질 오류를 줄 수도 있다. */
export function fakeLoader(
  events: EventLog,
  next: (call: LoadCall, index: number) => LoadedAnalysisContext | null | Error,
) {
  const calls: LoadCall[] = [];
  const loader: AnalysisContextLoader = {
    load: async (target, cacheKey) => {
      const call = { target: { ...target }, cacheKey };
      calls.push(call);
      events.push("loader.load");
      const value = next(call, calls.length - 1);
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { loader, calls };
}

export type MarkRunningInput = Parameters<AnalysisRunTracker["markRunning"]>[0];
export type MarkFailedInput = Parameters<AnalysisRunTracker["markFailed"]>[0];

/**
 * markRunning 은 기본으로 run 을 잡는다(true). runningClaimed=false 면 0행(그 사이 다른 시도가 잡았거나 끝냈다)이다.
 * markFailed 는 받은 입력만 기록한다. 쓰기 조건(expected)이 맞는지는 저장 port(analysis.repo) 시험이 본다.
 */
export function fakeTracker(
  events: EventLog,
  options: { runningError?: Error; failedError?: Error; runningClaimed?: boolean } = {},
) {
  const running: MarkRunningInput[] = [];
  const failed: MarkFailedInput[] = [];
  const tracker: AnalysisRunTracker = {
    markRunning: async (input) => {
      running.push(input);
      events.push("tracker.markRunning");
      if (options.runningError) throw options.runningError;
      return options.runningClaimed ?? true;
    },
    markFailed: async (input) => {
      failed.push(input);
      events.push("tracker.markFailed");
      if (options.failedError) throw options.failedError;
    },
  };
  return { tracker, running, failed };
}

/** save 는 저장한 행의 id 를 돌려준다(2b). 저장한 행은 다음 시도의 loader 가 캐시로 읽을 수 있다. */
export function fakeExtractionStore(
  events: EventLog,
  savedId = "e0000000-0000-4000-8000-0000000000aa",
) {
  const sources: AnalysisContext[] = [];
  const saves: ExtractionRecord[] = [];
  const store: ExtractionStore = {
    loadSource: async (context) => {
      sources.push(context);
      events.push("extraction.loadSource");
      return sourceFor("FX-01");
    },
    save: async (record) => {
      saves.push(record);
      events.push("extraction.save");
      return { id: savedId };
    },
  };
  return { store, sources, saves, savedId };
}

/** 시도마다 saveErrors 의 값을 차례로 쓴다(null 이면 성공). 다 쓰면 성공한다. */
export function fakeSink(events: EventLog, saveErrors: (Error | null)[] = []) {
  const attempts: AnalysisRunRecord[] = [];
  const sink: AnalysisRunSink = {
    save: async (record) => {
      attempts.push(record);
      events.push("sink.save");
      const error = saveErrors[attempts.length - 1] ?? null;
      if (error) throw error;
    },
  };
  return { sink, attempts };
}
