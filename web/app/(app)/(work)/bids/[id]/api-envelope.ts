// 공고 상세가 부르는 v1 쓰기·polling 응답 읽기. 오류 봉투 {error:{code,message,details,requestId}} + X-Request-Id(05 §1).
// 분석 실행(use-analysis-run)과 결정 기록(submit-review)이 같이 쓴다. 서버 모듈을 부르지 않는다(브라우저 번들).

export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  details: Record<string, unknown>;
};

export const CSRF_HEADERS = { "X-Requested-With": "sol-radar" } as const;
export const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  ...CSRF_HEADERS,
} as const;

export const NETWORK_ERROR = "NETWORK_ERROR";
export const NETWORK_MESSAGE = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.";
const FALLBACK_MESSAGE = "요청을 처리하지 못했습니다.";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 본문이 JSON 이 아니면(프록시 오류 화면 등) null 이다.
export const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null);

// 봉투가 없을 때(프록시 오류 등) 상태 코드로 정하는 code. 아는 상태는 서버(app/api/v1/_lib/http.ts)의 ApiErrorCode 이름을 쓴다.
const FALLBACK_CODE: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};
const fallbackCode = (status: number): string =>
  FALLBACK_CODE[status] ?? (status >= 500 ? "INTERNAL_ERROR" : `HTTP_${status}`);

export function failureOf(response: Response, body: unknown): ApiFailure {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const requestId =
    typeof error?.requestId === "string"
      ? error.requestId
      : (response.headers.get("X-Request-Id") ?? undefined);
  return {
    status: response.status,
    code: typeof error?.code === "string" ? error.code : fallbackCode(response.status),
    message:
      typeof error?.message === "string" && error.message.trim() !== ""
        ? error.message
        : FALLBACK_MESSAGE,
    ...(requestId === undefined ? {} : { requestId }),
    details: isRecord(error?.details) ? error.details : {},
  };
}
