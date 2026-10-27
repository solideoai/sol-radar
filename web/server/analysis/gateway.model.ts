import "server-only";
import { z } from "zod";

// ── AI gateway 계약 모델: 설정 읽기·응답 봉투 검증·실패 분류의 순수 규칙 (03 §2.1·§3, 02 장애 원칙) ──
// 모델 산출물 본문(payload·kev 안쪽·wire)의 깊은 검증은 2단계에서 scoring 의 스키마로 한다. 여기서는 봉투만 본다.

export const DEFAULT_AI_GATEWAY_URL = "http://ai-gateway:8000";
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
export const DEFAULT_KEV_TIMEOUT_MS = 5_000;
/** worker 쪽 timeout 은 gateway 안쪽 timeout 보다 길어야 gateway 가 낸 실패 응답을 받을 수 있다. */
export const EXTRACT_TIMEOUT_EXTRA_MS = 5_000;
export const KEV_TIMEOUT_EXTRA_MS = 2_000;
/** 정본에 값이 없다. /health 는 모델을 부르지 않으므로 짧게 둔다. */
export const HEALTH_TIMEOUT_MS = 5_000;

/** 잘못 적은 값(단위 착각 등)으로 job 이 몇 시간씩 매달리지 않게 1시간에서 자른다. */
const MAX_TIMEOUT_MS = 3_600_000;

export type GatewayConfig = {
  baseUrl: string;
  extractTimeoutMs: number;
  explainTimeoutMs: number;
  kevTimeoutMs: number;
  healthTimeoutMs: number;
};

type ConfigKey = "AI_GATEWAY_URL" | "AI_TIMEOUT_MS" | "KEV_TIMEOUT_MS" | "PARSE_TIMEOUT_MS";

/** 빈 값·공백만 있는 값은 없는 것으로 본다. */
function readTrimmed(env: Record<string, string | undefined>, key: ConfigKey): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

/** http·https 이고 계정 정보가 없는 URL 만 받는다. 계정 정보가 있으면 baseUrl 을 거쳐 로그에 비밀이 남는다. */
function parseBaseUrl(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isHttp || url.username !== "" || url.password !== "") return null;
  return value.replace(/\/+$/, "");
}

/** 10진 숫자만 받는다("1e3"·"0x10"·"1.5" 는 Number() 가 받아도 거부한다). */
function parseTimeoutMs(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const ms = Number(value);
  return ms >= 1 && ms <= MAX_TIMEOUT_MS ? ms : null;
}

/** 오류 메시지에는 틀린 키 이름만 싣는다. 값(주소·숫자)은 싣지 않는다. */
export function readGatewayConfig(env: Record<string, string | undefined>): GatewayConfig {
  const rawUrl = readTrimmed(env, "AI_GATEWAY_URL");
  const rawAiTimeout = readTrimmed(env, "AI_TIMEOUT_MS");
  const rawKevTimeout = readTrimmed(env, "KEV_TIMEOUT_MS");

  const baseUrl = rawUrl === null ? DEFAULT_AI_GATEWAY_URL : parseBaseUrl(rawUrl);
  const aiTimeoutMs = rawAiTimeout === null ? DEFAULT_AI_TIMEOUT_MS : parseTimeoutMs(rawAiTimeout);
  const kevTimeoutMs =
    rawKevTimeout === null ? DEFAULT_KEV_TIMEOUT_MS : parseTimeoutMs(rawKevTimeout);

  if (baseUrl === null || aiTimeoutMs === null || kevTimeoutMs === null) {
    const invalidKeys = [
      baseUrl === null ? "AI_GATEWAY_URL" : null,
      aiTimeoutMs === null ? "AI_TIMEOUT_MS" : null,
      kevTimeoutMs === null ? "KEV_TIMEOUT_MS" : null,
    ].filter((key) => key !== null);
    throw new Error(`AI gateway 설정 오류: ${invalidKeys.join(", ")}`);
  }

  return {
    baseUrl,
    extractTimeoutMs: aiTimeoutMs + EXTRACT_TIMEOUT_EXTRA_MS,
    // /explain 도 Qwen 을 부르므로 /extract 와 같은 여유를 둔다.
    explainTimeoutMs: aiTimeoutMs + EXTRACT_TIMEOUT_EXTRA_MS,
    kevTimeoutMs: kevTimeoutMs + KEV_TIMEOUT_EXTRA_MS,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
  };
}

// ── 문서 파싱(POST /parse, 03 §10). documents worker 만 부른다 ──

/**
 * 문서 하나의 /parse 응답을 기다리는 상한. gateway 는 요청마다 파서 하위 프로세스를 띄우고(동시 최대 2개, 하나당 90초),
 * 자리가 없으면 기다린다. 그래서 처리 90초 + 자리 대기 90초다(/extract 용 timeout 을 쓰지 않는다).
 */
export const DEFAULT_PARSE_TIMEOUT_MS = 180_000;
/** worker 쪽 timeout 은 gateway 안쪽보다 길어야 gateway 가 낸 실패 응답을 받는다(/extract 와 같은 여유). */
export const PARSE_TIMEOUT_EXTRA_MS = 5_000;

export type ParseClientConfig = { baseUrl: string; parseTimeoutMs: number };

/** 오류 메시지에는 틀린 키 이름만 싣는다. AI_GATEWAY_URL 규칙은 readGatewayConfig 와 같다. */
export function readParseConfig(env: Record<string, string | undefined>): ParseClientConfig {
  const rawUrl = readTrimmed(env, "AI_GATEWAY_URL");
  const rawTimeout = readTrimmed(env, "PARSE_TIMEOUT_MS");
  const baseUrl = rawUrl === null ? DEFAULT_AI_GATEWAY_URL : parseBaseUrl(rawUrl);
  const timeoutMs = rawTimeout === null ? DEFAULT_PARSE_TIMEOUT_MS : parseTimeoutMs(rawTimeout);
  if (baseUrl === null || timeoutMs === null) {
    const invalidKeys = [
      baseUrl === null ? "AI_GATEWAY_URL" : null,
      timeoutMs === null ? "PARSE_TIMEOUT_MS" : null,
    ].filter((key) => key !== null);
    throw new Error(`AI gateway 설정 오류: ${invalidKeys.join(", ")}`);
  }
  return { baseUrl, parseTimeoutMs: timeoutMs + PARSE_TIMEOUT_EXTRA_MS };
}

// ── 응답 스키마. z.object 는 모르는 필드를 버리고 거부하지 않는다(gateway 가 필드를 늘려도 worker 가 멈추지 않게) ──

export const extractResponseSchema = z
  .object({
    status: z.enum(["COMPLETED", "PENDING_REVIEW", "FAILED"]),
    payload: z.unknown(),
    translations: z.record(z.string(), z.string()).nullable(),
    errorCode: z.enum(["EXTRACTION_FAILED", "QWEN_UNAVAILABLE"]).nullable(),
    injectionSuspected: z.boolean(),
    warnings: z.array(z.string()),
    timings: z.object({ extractMs: z.number().nonnegative() }),
  })
  .superRefine((body, ctx) => {
    // 03 §2.1: FAILED 면 payload 는 null. FAILED 인데 errorCode 가 null 이면 대체 판단에서 EXTRACTION_FAILED 로 본다.
    if (body.status === "FAILED" && body.payload !== null) {
      ctx.addIssue({ code: "custom", path: ["payload"], message: "FAILED 면 payload 는 null" });
    }
    if (body.status !== "FAILED" && (body.payload === null || body.payload === undefined)) {
      ctx.addIssue({ code: "custom", path: ["payload"], message: "FAILED 가 아니면 payload 필요" });
    }
    if (body.status !== "FAILED" && body.errorCode !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "FAILED 가 아니면 errorCode 는 null",
      });
    }
  });

const kevLabel = z.enum(["SATISFIED", "NOT_SATISFIED", "NEEDS_REVIEW"]);

export const kevResponseSchema = z.object({
  // 추가 진단이다. 예전 gateway 응답에는 없어도 된다.
  warnings: z.array(z.string()).optional(),
  // 안쪽 KevAssist 는 2단계에서 검증한다. 그때까지 나머지 필드를 버리지 않는다.
  kev: z.looseObject({ enabled: z.boolean() }),
  stateHash: z.string().nullable(),
  requirements: z
    .array(
      z.object({
        itemId: z.string(),
        qid: z.string(),
        distribution: z.object({
          SATISFIED: z.number(),
          NOT_SATISFIED: z.number(),
          NEEDS_REVIEW: z.number(),
        }),
        label: kevLabel,
      }),
    )
    .nullable(),
  wire: z.array(z.unknown()).nullable(),
  timings: z.object({ kevMs: z.number().nonnegative() }),
  // 필수 필드다. enabled=false 이고 null 이면 "Kev 사용 안 함", KEV_UNAVAILABLE 이면 Kev 만 불가,
  // INJECTION_SUSPECTED 면 추출에 인젝션 의심이 있어 gateway 가 Kev 를 부르지 않았다(Kev 장애가 아니다).
  errorCode: z.enum(["KEV_UNAVAILABLE", "INJECTION_SUSPECTED"]).nullable(),
});

export const explainResponseSchema = z.object({
  text: z.string(),
  usedNumbers: z.array(z.string()),
  fallback: z.boolean(),
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  runMode: z.enum(["live", "fixture", "mock"]),
  provider: z.enum(["mock", "local", "hosted"]),
  kevEnabled: z.boolean(),
  qwen: z.object({ model: z.string(), promptHash: z.string() }).nullable(),
  // mock 은 레지스트리와 대조하지 않으므로 registryMatch 가 null 이다.
  kev: z.object({ modelId: z.string(), registryMatch: z.boolean().nullable() }).nullable(),
  questionSets: z.array(z.string()),
  parsers: z.array(z.object({ format: z.string(), parserId: z.string().nullable() })),
});

/** 03 §10.1 ParseResult. 실패(UNSUPPORTED·FAILED)는 사유가 있어야 하고(DB check), 페이지 오프셋은 text 안이어야 한다. */
export const parseResponseSchema = z
  .object({
    status: z.enum(["PARSED", "PARTIAL", "UNSUPPORTED", "FAILED"]),
    format: z.enum(["PDF", "HWPX", "HWP", "UNKNOWN"]),
    parserId: z.string(),
    text: z.string(),
    pages: z.array(
      z.object({ page: z.number().int().min(1), charOffset: z.number().int().min(0) }),
    ),
    blocks: z.array(z.unknown()),
    // bid_documents.parse_quality(jsonb)에 그대로 저장한다
    quality: z.record(z.string(), z.json()).nullable(),
    errorCode: z
      .enum([
        "UNSUPPORTED_FORMAT",
        "NO_TEXT_LAYER",
        "ENCRYPTED",
        "DISTRIBUTION_PROTECTED",
        "TOO_LARGE",
        "CORRUPTED",
        "PARSER_ERROR",
      ])
      .nullable(),
    warnings: z.array(z.string()),
  })
  .superRefine((body, ctx) => {
    const failed = body.status === "UNSUPPORTED" || body.status === "FAILED";
    if (failed && body.errorCode === null) {
      ctx.addIssue({ code: "custom", path: ["errorCode"], message: "실패면 errorCode 필요" });
    }
    if (!failed && body.parserId.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["parserId"], message: "성공이면 parserId 필요" });
    }
    if (body.pages.some((page) => page.charOffset > body.text.length)) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "charOffset 가 text 밖" });
    }
  });

export type ExtractResponse = z.infer<typeof extractResponseSchema>;
export type KevResponse = z.infer<typeof kevResponseSchema>;
export type ExplainResponse = z.infer<typeof explainResponseSchema>;
export type GatewayHealth = z.infer<typeof healthResponseSchema>;
export type ParseResponse = z.infer<typeof parseResponseSchema>;

// ── 요청 ──

export const extractRequestSchema = z.object({
  requestId: z.string().min(1),
  bidId: z.string().min(1),
  revisionId: z.string().min(1),
  // "FX-07" 또는 revision 이 붙은 "FX-07.r01". mock 어댑터가 fixture 추출을 고를 때 쓴다.
  fixtureId: z
    .string()
    .regex(/^FX-\d{2}(\.r\d{2})?$/)
    .optional(),
  meta: z.object({
    stage: z.enum(["PLAN", "PRE_SPEC", "NOTICE"]),
    agency: z.string().nullable(),
    budgetKrw: z.string().nullable(),
    deadlineAt: z.string().nullable(),
  }),
  body: z.string(),
  attachments: z.array(
    z.object({
      documentId: z.string().min(1),
      text: z.string(),
      pages: z.array(
        z.object({ page: z.number().int().min(1), charOffset: z.number().int().min(0) }),
      ),
    }),
  ),
});
export type ExtractRequest = z.infer<typeof extractRequestSchema>;

/** /kev·/explain 본문 형태는 2단계에서 좁힌다. 지금은 X-Request-Id 에 쓸 requestId 만 강제한다. */
export type GatewayRequestBody = { requestId: string } & Record<string, unknown>;

// ── 실패와 결과. 예상한 실패는 던지지 않고 값으로 돌려준다 ──

export type GatewayFailure =
  | { kind: "UNREACHABLE"; code: string | null }
  | { kind: "TIMEOUT" }
  | { kind: "HTTP_ERROR"; httpStatus: number; errorCode: string | null }
  | { kind: "INVALID_RESPONSE"; issues: string[] }
  | { kind: "CIRCUIT_OPEN" };

/** attempts 는 실제로 보낸 HTTP 요청 수다(CIRCUIT_OPEN 이면 0). */
export type GatewayResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; failure: GatewayFailure; attempts: number };

const TIMEOUT_CAUSE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** 객체의 필드 하나. 객체가 아니거나 필드가 없으면 undefined. DOMException 의 name 처럼 상속한 getter 도 읽는다. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

/** 오류 코드 형식에 맞을 때만 싣는다. 메시지·주소가 코드 자리에 섞여 들어와도 결과로 새지 않는다(web/worker 의 errorCode 와 같은 원칙). */
function isSafeFetchCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code);
}

/** fetch 가 던진 오류를 분류한다. 오류 메시지·URL 은 싣지 않는다. */
export function classifyFetchError(error: unknown): GatewayFailure {
  const name = readField(error, "name");
  if (name === "TimeoutError" || name === "AbortError") return { kind: "TIMEOUT" };

  const causeCode = readField(readField(error, "cause"), "code");
  if (typeof causeCode === "string" && TIMEOUT_CAUSE_CODES.has(causeCode)) {
    return { kind: "TIMEOUT" };
  }

  const code = [causeCode, readField(error, "code")].find(isSafeFetchCode) ?? null;
  return { kind: "UNREACHABLE", code };
}

function isServerError(failure: GatewayFailure): boolean {
  return failure.kind === "HTTP_ERROR" && failure.httpStatus >= 500 && failure.httpStatus <= 599;
}

/** 1회 재시도 대상인가. 연결 거부는 바로 실패시킨다(02 장애 원칙). */
export function isRetryable(failure: GatewayFailure): boolean {
  return failure.kind === "TIMEOUT" || isServerError(failure);
}

/** gateway 가 죽었다는 신호인가(breaker 실패 집계 대상). 4xx·INVALID_RESPONSE 는 gateway 가 응답했으므로 아니다. */
export function isAvailabilityFailure(failure: GatewayFailure): boolean {
  return failure.kind === "UNREACHABLE" || failure.kind === "TIMEOUT" || isServerError(failure);
}

function isErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

/** HTTP 오류 본문에서 오류 코드만 꺼낸다. message 는 사용자 입력이 섞일 수 있어 싣지 않는다. */
export function readErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const detail = readField(body, "detail");
  const candidates = [
    readField(body, "errorCode"),
    Array.isArray(detail) ? undefined : readField(detail, "errorCode"),
    typeof detail === "string" ? detail : undefined,
  ];
  return candidates.find(isErrorCode) ?? null;
}

const MAX_ISSUES = 10;

/** 경로에 그대로 실을 수 있는 이름 조각. 그 밖의 키(긴 이름·공백·점·한글·기호)는 받은 값일 수 있다. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_]{1,40}$/;

/** 경로 조각은 받은 객체의 키일 수 있다(record·느슨한 객체). 숫자와 안전한 이름만 싣고 그 밖은 '*' 로 바꾼다. */
function toPathSegment(segment: PropertyKey): string {
  if (typeof segment === "number") return String(segment);
  return typeof segment === "string" && SAFE_PATH_SEGMENT.test(segment) ? segment : "*";
}

/** zod 오류를 "경로: 코드" 목록으로 바꾼다. 받은 값(공고 원문 등)은 싣지 않는다. */
export function toIssueList(error: z.ZodError): string[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(toPathSegment).join(".") : "(root)";
    return `${path}: ${issue.code}`;
  });
}
