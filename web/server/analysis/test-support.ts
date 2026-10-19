// 시험 전용 도우미. 제품 코드가 import 하지 않는다(분석 도메인은 런타임에 fixtures/ 를 읽지 않는다).
// fixtures/ 로 AnalysisContext·AnalysisInput 을 만들고, 3b mock 모양의 gateway 응답·가짜 fetch·가짜 추출 저장·고정 시계를 만든다.
// 가짜 fetch 는 실제 createGatewayClient 에 넣는다. 1단계의 timeout·재시도·breaker 를 그대로 거치게 하려는 것이다.
// scoring 의 test-support 는 딥임포트라 쓰지 않는다. 필요한 만큼만 같은 방식(node:fs + import.meta.url)으로 다시 쓴다.
import { existsSync, readFileSync } from "node:fs";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  KEV_DISCLAIMER,
  SCORING_CONFIG_V0_1,
  toScoringTeam,
  type AnalysisInput,
  type CompanyProfile,
  type EvidenceRef,
  type KevMockResponse,
  type NormalizedBidSummary,
  type RequirementExtraction,
  type ScoringPerson,
  type ScoringTeamInput,
} from "@/server/scoring";
import type {
  AnalysisContext,
  CachedExtraction,
  ExtractSource,
  ExtractionRecord,
} from "./analysis.model";
import type { AnalysisDeps, ExtractionStore } from "./analysis.service";
import { createGatewayClient } from "./gateway.client";
import type { ExplainResponse, ExtractResponse, GatewayConfig, KevResponse } from "./gateway.model";

// ── fixture 읽기 ──

const fixtureUrl = (path: string) => new URL(`../../../fixtures/${path}`, import.meta.url);
const readText = (path: string): string => readFileSync(fixtureUrl(path), "utf8");
const readJson = <T>(path: string): T => JSON.parse(readText(path)) as T;

function readCalculationDate(): string {
  const match = /^calculationDate:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m.exec(readText("manifest.yaml"));
  if (!match) throw new Error("fixtures/manifest.yaml 에 calculationDate 가 없다");
  return match[1];
}

/** fixtures/manifest.yaml calculationDate. 모든 골든은 이 KST 날짜로 계산한다. */
export const CALCULATION_DATE = readCalculationDate();
/** fixture 추출·Kev 의 extractedAt 과 같은 시각(KST 18:00). bid.fetchedAt 으로 쓴다. */
export const FIXTURE_FETCHED_AT = `${CALCULATION_DATE}T09:00:00Z`;
/** runAnalysis 가 now() 로 처음 받는 시각. KST 로 CALCULATION_DATE 18:00 이다. */
export const STARTED_AT = `${CALCULATION_DATE}T09:00:00.000Z`;
/** runAnalysis 가 now() 로 두 번째 받는 시각. */
export const FINISHED_AT = `${CALCULATION_DATE}T09:00:02.500Z`;
/** job 이 큐에 들어간 시각. runAnalysis 는 받은 값을 그대로 싣는다. */
export const QUEUED_AT = `${CALCULATION_DATE}T08:59:30.000Z`;
/**
 * 이 시도의 시작 시각(C5-B 보안 후속 2.1, 시도 식별자). worker 가 markRunning 에 넘긴 startedAt 과 같은 값이고,
 * runAnalysis 가 레코드로 옮겨 finish_score_run 의 attempt_started_at 이 된다. meta.startedAt(STARTED_AT)과 일부러 다르게 둔다.
 */
export const ATTEMPT_STARTED_AT = `${CALCULATION_DATE}T08:59:59.500Z`;

type BidFixture = {
  fixtureId: string;
  records: {
    amendmentNo: string;
    noticeId: string;
    title: string;
    agency: string | null;
    budgetKrw: string | null;
    noticeDate: string | null;
    deadlineAt: string | null;
    stage: "PLAN" | "PRE_SPEC" | "NOTICE";
    content: string;
  }[];
};

/** ADR-014: "+21d" 같은 상대 표기를 기준일 + N일의 KST 18:00(= UTC 09:00)로 바꾼다. 절대 ISO 는 그대로. */
function relativeDate(spec: string | null): string | null {
  if (spec === null) return null;
  const match = /^([+-])(\d+)d$/.exec(spec);
  if (!match) return spec;
  const days = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const [year, month, day] = CALCULATION_DATE.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0)).toISOString();
}

/** C4 형식의 공고 요약. scoring 골든 시험과 같은 방식으로 만든다(골든 숫자가 그대로 나오게). */
export function loadBid(id: string, recordIndex = 0): NormalizedBidSummary {
  const record = readJson<BidFixture>(`bids/${id}.json`).records[recordIndex];
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

/** loadSource 가 돌려줄 원문. 공고 본문은 fixture 의 content 다. */
export function sourceFor(id: string): ExtractSource {
  const record = readJson<BidFixture>(`bids/${id}.json`).records[0];
  return {
    body: record.content,
    attachments: [
      {
        documentId: `${id}-rfp`,
        text: "가상 제안요청서 본문",
        pages: [{ page: 1, charOffset: 0 }],
      },
    ],
  };
}

export function loadExtraction(id: string): RequirementExtraction {
  return readJson<RequirementExtraction>(`extractions/${id}.json`);
}

export function loadKevFixture(id: string): KevMockResponse | null {
  return existsSync(fixtureUrl(`kev/${id}.json`))
    ? readJson<KevMockResponse>(`kev/${id}.json`)
    : null;
}

/** fixtures/kev/FX-xx.json 의 responses. Kev fixture 가 없는 공고면 던진다. */
export function loadKevResponses(id: string): KevMockResponse["responses"] {
  const kev = loadKevFixture(id);
  if (kev === null) throw new Error(`fixtures/kev/${id}.json 이 없다`);
  return kev.responses;
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

export type Golden = {
  fixtureId: string;
  factors: { factor: string; normalized: number; points: number; maxPoints: number }[];
  total: number;
  score: number;
  recommendation: "BID" | "WATCH" | "NO_BID";
  reviewFlags: string[];
};

export function loadGolden(id: string): Golden {
  return readJson<Golden>(`goldens/${id}.json`);
}

/** 깊은 복사 뒤 일부를 바꾼다. 원본을 변형하지 않는다. */
export function withPatch<T>(value: T, patch: (draft: T) => void): T {
  const draft = structuredClone(value);
  patch(draft);
  return draft;
}

// ── 입력 만들기 ──

/** fixture 캐시 행의 requirement_extractions.id. 저장 port 가 돌려주는 id(SAVED_EXTRACTION_ID)와 겹치지 않는다. */
export function cachedExtractionId(id: string): string {
  return `extraction-cached-${id}`;
}

/** fixture 추출을 담은 유효한 캐시 행(requirement_extractions 한 행). */
export function cachedRow(id: string): CachedExtraction {
  return {
    id: cachedExtractionId(id),
    status: "COMPLETED",
    payload: loadExtraction(id),
    translations: null,
  };
}

/** fixture 하나의 analysis job 입력. 캐시 추출이 있고 Kev 가 켜진 isDemo 공고다. */
export function buildContext(
  id: string,
  overrides: Partial<AnalysisContext> = {},
): AnalysisContext {
  return {
    requestId: `req-${id}`,
    orgId: "org-solideo-demo",
    scoreRunId: `run-${id}`,
    bidId: `bid-${id}`,
    companyProfileId: "profile-solideo-demo",
    fixtureId: id,
    bid: loadBid(id),
    extraction: cachedRow(id),
    profile: loadProfile(),
    team: loadTeam(),
    runMode: "mock",
    aiProvider: "mock",
    kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
    documentIssues: [],
    queuedAt: QUEUED_AT,
    attemptStartedAt: ATTEMPT_STARTED_AT,
    ...overrides,
  };
}

/** C4 를 직접 부르는 입력(fixture Kev wire 그대로). 순수 함수 시험에서 AnalysisResult 를 만들 때 쓴다. */
export function buildAnalysisInput(
  id: string,
  overrides: Partial<AnalysisInput> = {},
): AnalysisInput {
  return {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: loadBid(id),
    extraction: loadExtraction(id),
    profile: loadProfile(),
    team: loadTeam(),
    kev: loadKevFixture(id),
    config: { ...SCORING_CONFIG_V0_1, today: CALCULATION_DATE },
    ...overrides,
  };
}

/** 근거 하나. 판정 키가 아닌 필드(fetchedAt·match 등)는 덮어써서 구분한다. */
export function evidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    documentId: null,
    revisionId: "FX-01#01",
    quotedText: "가상 인용 문장",
    fetchedAt: FIXTURE_FETCHED_AT,
    ...overrides,
  };
}

/** 값 안의 모든 객체 키를 깊이 상관없이 모은다(요청 본문에 규칙 결과 키가 섞였는지 본다). */
export function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...keysDeep(entry)]);
  }
  return [];
}

// ── 3b mock 모양의 gateway 응답 본문 ──

export const KEV_MS = 37;
export const EXTRACT_MS = 1234;
export const STATE_HASH = "c".repeat(64);
export const MOCK_EXPLAIN_TEXT = "gateway mock 템플릿 설명 문장";

/** 3b 통보 /kev mock(Kev 사용): wire=[{responses, usage, latency_ms}], provider·model "mock", requestId null. */
export function kevUsedBody(responses: KevMockResponse["responses"]): KevResponse {
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

/** 3b 통보 /kev(KEV_ENABLED=false 또는 Kev 장애): enabled=false, 나머지 null. 장애면 errorCode=KEV_UNAVAILABLE. */
export function kevDisabledBody(errorCode: KevResponse["errorCode"]): KevResponse {
  return {
    kev: {
      enabled: false,
      provider: null,
      model: null,
      questionSetVersion: null,
      suggestedOption: null,
      probabilities: null,
      confidence: null,
      mandatoryRisk: null,
      needsHumanReview: null,
      fit: null,
      scores: null,
      risks: null,
      calibration: null,
      stateTrace: null,
      latencyMs: null,
      requestId: null,
      disclaimer: KEV_DISCLAIMER,
    },
    stateHash: null,
    requirements: null,
    wire: null,
    timings: { kevMs: 3 },
    errorCode,
  };
}

/**
 * 3e 통합 결함 재현 본문. main c2b12d3 의 실제 demo:preanalyze 에서 fixtures/kev 파일이 없는 15건이 PARTIAL·AI_UNAVAILABLE 로 끝났다
 * (gateway 는 모두 200). 3b mock 이 03 §5.7 공식 경로로 낸 /kev 200 본문이고, wire 의 fit 에 probabilities·confidence 가 빠졌다
 * (services/ai 13fcb96 이 고친 결함). 봉투(1단계 kevResponseSchema)는 통과하고 kev-mock wire 스키마(fit 네 필드 필수)만 어긴다.
 * 값은 공식 BID 분기(FORMULA_BID)와 FORMULA_FIT_SCORE 2.0, latency_ms 0(build_response 기본값)이다.
 */
export function kevFitDefectBody(): KevResponse {
  const legend = { "0": "Very poor", "1": "Poor", "2": "Moderate", "3": "Good", "4": "Very good" };
  const recommendation = {
    choice: "BID",
    confidence: 0.6,
    probabilities: { BID: 0.6, WATCH: 0.3, NO_BID: 0.1 },
  };
  return {
    kev: {
      enabled: true,
      provider: "mock",
      model: "mock",
      questionSetVersion: "kev-qs/v0.1",
      suggestedOption: recommendation.choice,
      probabilities: recommendation.probabilities,
      confidence: recommendation.confidence,
      mandatoryRisk: 0.1,
      needsHumanReview: 0.2,
      fit: { score: 2.0, legend },
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
    wire: [
      {
        responses: {
          recommendation,
          mandatoryRisk: { noul: 0.1 },
          needsHumanReview: { noul: 0.2 },
          // 결함: score 답에 probabilities·confidence 가 없다(03 §5.4 는 네 필드 필수).
          fit: { score: 2.0, legend },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
        latency_ms: 0,
      },
    ],
    timings: { kevMs: KEV_MS },
    errorCode: null,
  };
}

/** /explain 응답. 3b mock 은 늘 fallback=true 다. */
export function explainBody(text: string, fallback: boolean): ExplainResponse {
  return { text, usedNumbers: [], fallback };
}

/** /extract 200 응답. 기본은 COMPLETED. */
export function extractBody(
  payload: unknown,
  overrides: Partial<Omit<ExtractResponse, "payload">> = {},
): ExtractResponse {
  return {
    status: "COMPLETED",
    payload,
    translations: null,
    errorCode: null,
    injectionSuspected: false,
    warnings: [],
    timings: { extractMs: EXTRACT_MS },
    ...overrides,
  };
}

/** /extract 200 FAILED 응답(03 §2.1: payload 는 null). */
export function extractFailedBody(errorCode: ExtractResponse["errorCode"]): ExtractResponse {
  return extractBody(null, { status: "FAILED", errorCode });
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

/** 내부 주소·오류 코드가 메시지에 든 undici 연결 거부. 레코드로 새면 안 된다. */
export const LEAKY_ADDRESS = "10.0.0.5";
export const refusedReply: Reply = () =>
  Promise.reject(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error(`connect ECONNREFUSED ${LEAKY_ADDRESS}:8000`), {
        code: "ECONNREFUSED",
      }),
    }),
  );

/** AbortSignal.timeout 이 끊었을 때의 모양. 기다리지 않고 바로 던진다. */
export const timeoutReply: Reply = () =>
  Promise.reject(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }));

export type GatewayPath = "/health" | "/extract" | "/kev" | "/explain";
export type GatewayRoutes = Partial<Record<GatewayPath, Reply | Reply[]>>;
export type GatewayCall = { path: string; body: unknown };

/** 엔드포인트마다 timeout 을 다르게 둔다. 가짜 fetch 는 signal 을 기다리지 않는다. */
export const GATEWAY_CONFIG: GatewayConfig = {
  baseUrl: "http://gw.test:8000",
  extractTimeoutMs: 11_000,
  explainTimeoutMs: 12_000,
  kevTimeoutMs: 13_000,
  healthTimeoutMs: 14_000,
};

/** breaker 시각. 고정이라 한 번 열린 breaker 는 시험 안에서 닫히지 않는다. */
const BREAKER_NOW = 1_000_000;

/** 경로별로 준비한 답을 차례로 쓰고, 다 쓰면 마지막 답을 되풀이한다. 준비하지 않은 경로는 404 다. */
export function fakeGateway(routes: GatewayRoutes = {}) {
  const calls: GatewayCall[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const route = routes[path as GatewayPath];
    const replies = route === undefined ? [] : Array.isArray(route) ? route : [route];
    const index = calls.filter((call) => call.path === path).length - 1;
    const reply = replies[Math.min(index, replies.length - 1)];
    return reply ? reply() : jsonReply({ errorCode: "NOT_ROUTED" }, 404)();
  };
  const gateway = createGatewayClient(GATEWAY_CONFIG, { fetch, now: () => BREAKER_NOW });
  return {
    gateway,
    calls,
    /** 그 경로로 실제로 나간 HTTP 요청 수(재시도 포함). */
    count: (path: GatewayPath) => calls.filter((call) => call.path === path).length,
    /** 그 경로로 나간 index 번째 요청 본문(JSON). 없으면 던진다. */
    bodyOf: (path: GatewayPath, index = 0): Record<string, unknown> => {
      const body = calls.filter((call) => call.path === path)[index]?.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error(`${path} 요청 본문이 없다`);
      }
      return { ...body };
    },
  };
}

// ── 시계·추출 저장 ──

/** 준비한 시각을 차례로 돌려주고, 다 쓰면 마지막 시각을 되풀이한다. */
export function clock(...isoTimes: string[]): () => Date {
  let calls = 0;
  return () => {
    const iso = isoTimes[Math.min(calls, isoTimes.length - 1)];
    calls += 1;
    return new Date(iso);
  };
}

/** 가짜 추출 저장이 save 마다 돌려주는 requirement_extractions.id(기본값). 캐시 행 id 와 겹치지 않는다. */
export const SAVED_EXTRACTION_ID = "extraction-saved-1";

/** loadSource·save 호출을 남기는 가짜 추출 저장. save 는 savedId(기본 SAVED_EXTRACTION_ID)를 돌려준다. */
export function fakeExtractionStore(
  options: { source?: ExtractSource; loadError?: Error; saveError?: Error; savedId?: string } = {},
) {
  const loads: AnalysisContext[] = [];
  const saves: ExtractionRecord[] = [];
  const store: ExtractionStore = {
    loadSource: async (context) => {
      loads.push(context);
      if (options.loadError) throw options.loadError;
      return options.source ?? sourceFor("FX-01");
    },
    save: async (record) => {
      saves.push(record);
      if (options.saveError) throw options.saveError;
      return { id: options.savedId ?? SAVED_EXTRACTION_ID };
    },
  };
  return { store, loads, saves };
}

/** 정상 gateway: /kev 는 3b mock(fixture responses), /explain 은 mock 템플릿(fallback=true). */
export function healthyRoutes(id: string): GatewayRoutes {
  return {
    "/kev": jsonReply(kevUsedBody(loadKevResponses(id))),
    "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)),
  };
}

/** runAnalysis 에 넘길 의존성. 시계는 STARTED_AT → FINISHED_AT. */
export function buildDeps(
  gateway: AnalysisDeps["gateway"],
  extraction: ExtractionStore,
  now: () => Date = clock(STARTED_AT, FINISHED_AT),
): AnalysisDeps {
  return { gateway, now, extraction };
}
