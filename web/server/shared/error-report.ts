// ── 오류 기록 자리 ──
// 서버 오류는 instrumentation.ts 의 onRequestError 가 reportServerError 로, 화면의 오류 경계(app/error.tsx·global-error.tsx)는
// reportBrowserError 로 남긴다. 둘 다 JSON 한 줄이다. 오류 수집 업체를 붙이면 이 두 함수만 고친다(docs/first-deployment.md).
// 쿠키·인증 헤더·요청 본문·검색어(?…)는 남기지 않는다 — 토큰과 개인정보가 들어 있을 수 있다.
// 브라우저에서도 불리므로 아무것도 import 하지 않는다. onRequestError 의 인자는 필요한 칸만 같은 모양으로 적는다.

/** onRequestError 의 request 중 기록에 쓰는 칸. headers 는 받지만 읽지 않는다. */
export type ServerErrorRequest = { path: string; method: string };
/** onRequestError 의 context 중 기록에 쓰는 칸. */
export type ServerErrorContext = { routePath: string; routeType: string };

export type ErrorRecord = {
  level: "error";
  source: "server" | "browser";
  time: string;
  /** Next 가 붙이는 오류 번호. 오류 화면이 보여 주는 번호와 서버 기록을 맞춰 본다. */
  digest: string | null;
  /** 검색어·조각(#)을 뗀 경로. */
  path: string | null;
  method: string | null;
  /** 오류가 난 라우트를 가리키는, Next 가 주는 라우트 파일 기준 경로(예: /teams/new). 서버만. */
  routePath: string | null;
  /** render·route·action·proxy. 서버만. */
  routeType: string | null;
  name: string;
  message: string;
};

// 오류 메시지에 큰 값이 통째로 붙어 오는 경우가 있어 한 줄이 끝없이 길어지지 않게 자른다.
const MAX_MESSAGE_LENGTH = 1000;

const pathWithoutSearch = (path: string): string => path.split(/[?#]/, 1)[0];

function describe(error: unknown): Pick<ErrorRecord, "name" | "message" | "digest"> {
  const fields: { name?: unknown; message?: unknown; digest?: unknown } =
    typeof error === "object" && error !== null ? error : {};
  const name =
    error instanceof Error
      ? error.name
      : typeof fields.name === "string"
        ? fields.name
        : "NonError";
  const message =
    typeof fields.message === "string" ? fields.message : typeof error === "string" ? error : "";
  return {
    name,
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    digest: typeof fields.digest === "string" ? fields.digest : null,
  };
}

/** 서버 오류 한 건의 기록. 순수 함수다(시각을 인자로 받는다). */
export function toServerErrorRecord(
  error: unknown,
  request: ServerErrorRequest,
  context: ServerErrorContext,
  now: Date,
): ErrorRecord {
  return {
    level: "error",
    source: "server",
    time: now.toISOString(),
    ...describe(error),
    path: pathWithoutSearch(request.path),
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  };
}

/** 오류 경계가 받은 오류 한 건의 기록. 운영에서 서버 오류의 message 는 Next 가 가린 문장이고 digest 로 서버 기록을 찾는다. */
export function toBrowserErrorRecord(error: unknown, path: string | null, now: Date): ErrorRecord {
  return {
    level: "error",
    source: "browser",
    time: now.toISOString(),
    ...describe(error),
    path: path === null ? null : pathWithoutSearch(path),
    method: null,
    routePath: null,
    routeType: null,
  };
}

/** 서버 오류를 남긴다. 표준 오류 출력의 JSON 한 줄이라 배포 플랫폼의 로그(Vercel → Logs)에서 digest 로 찾는다. */
export function reportServerError(
  error: unknown,
  request: ServerErrorRequest,
  context: ServerErrorContext,
): void {
  console.error(JSON.stringify(toServerErrorRecord(error, request, context, new Date())));
}

/** 오류 경계가 받은 오류를 브라우저 콘솔에 남긴다. 서버로 보내지 않는다. */
export function reportBrowserError(error: unknown): void {
  const path = typeof window === "undefined" ? null : window.location.pathname;
  console.error(JSON.stringify(toBrowserErrorRecord(error, path, new Date())));
}
