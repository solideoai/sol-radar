import "server-only";
import { guardRedisApiRequest } from "@/app/_lib/redis-api-auth";
import { deploymentRole, redisApiConnection } from "@/app/_lib/deployment-role";
import { withRedisApiDeadline } from "@/app/_lib/redis-api-deadline";
import { redisApiOperation } from "@/app/_lib/redis-api-path";
import { redisApiUnavailable } from "@/app/_lib/redis-api-response";
import {
  MAX_BODY_BYTES,
  type AnalysisContext,
  type BodyRead,
  type LazyBody,
  type QueryIssue,
  type RawQuery,
} from "@/server/bids";
import { apiError, handleApiRequest, requireBusinessUser } from "./http";

// 업무 Route Handler(공고·분석·결정·알림)의 공통 입구.
// 순서: 예상 밖 예외 → 500 봉투(handleApiRequest) → 로그인·CSRF·가입 완료·업무 조직(requireBusinessUser) → 본 처리.
export function businessRoute(
  request: Request,
  work: (ctx: AnalysisContext, signal?: AbortSignal) => Promise<Response>,
): Promise<Response> {
  return handleApiRequest(request, async () => {
    const rejected = guardRedisApiRequest(request);
    if (rejected) return rejected;
    const operation = redisApiOperation(request.method, new URL(request.url).pathname);
    if (
      deploymentRole() === "frontend" &&
      (operation === "analysis-submit" ||
        operation === "insight-submit" ||
        operation === "ingest-submit" ||
        operation === "ingest-gate-read" ||
        operation === "ai-status")
    ) {
      try {
        const { timeoutMs } = redisApiConnection(process.env);
        return await withRedisApiDeadline(
          timeoutMs,
          async (signal) => {
            const guarded = await requireBusinessUser(request);
            signal.throwIfAborted();
            return guarded.ok ? work(guarded.ctx, signal) : guarded.response;
          },
          request.signal,
        );
      } catch {
        return redisApiUnavailable();
      }
    }
    const guarded = await requireBusinessUser(request);
    return guarded.ok ? work(guarded.ctx) : guarded.response;
  });
}

type PathResource = "revision" | "bid" | "analysis" | "notification" | "ingestionRun" | "project";
const NOT_FOUND_MESSAGES: Record<PathResource, string> = {
  bid: "공고를 찾을 수 없습니다",
  revision: "변경 이력을 찾을 수 없습니다",
  project: "입찰 프로젝트를 찾을 수 없습니다",
  analysis: "분석을 찾을 수 없습니다",
  notification: "알림을 찾을 수 없습니다",
  ingestionRun: "수집 실행을 찾을 수 없습니다",
};

// 경로 id 가 UUID 가 아닐 때의 응답. 없는 자원과 같은 404 이고 DB 는 부르지 않는다(Review Focus 2).
export const pathNotFound = (resource: PathResource): Response =>
  apiError(404, "NOT_FOUND", NOT_FOUND_MESSAGES[resource], { resource });

export const invalidQuery = (issues: QueryIssue[]): Response =>
  apiError(400, "VALIDATION_ERROR", "쿼리가 올바르지 않습니다", { issues });

// 쿼리 문자열 → 파서 입력. 한 번 온 값은 문자열, 반복된 값은 배열이다(파서가 반복을 가린다).
export function rawQueryOf(request: Request): RawQuery {
  const params = new URL(request.url).searchParams;
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }),
  );
}

const TOO_LARGE: BodyRead = { ok: false };

// Content-Length 가 상한을 넘는지. 숫자가 아니거나 없으면 선언이 없는 것으로 보고 읽을 때 잰다.
function declaresTooLarge(request: Request): boolean {
  const declared = Number(request.headers.get("content-length") ?? "");
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

// 본문을 상한까지만 읽는다. 넘으면 그 자리에서 읽기를 멈추고 null 이다(조각으로 오는 본문도 막는다).
async function readCappedText(request: Request): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// 요청 본문(보안 L5: 16KB 상한, Content-Length 와 실제 바이트를 둘 다 본다). 넘으면 ok:false 다.
// 비었으면 {} 다. JSON 이 아니면 글자 그대로 넘겨 서비스의 본문 검증이 400 으로 거절하게 한다
// (여기서 먼저 거절하면 서비스가 정한 권한 → 속도 제한 → 본문 순서가 깨진다).
export async function readJsonBody(request: Request): Promise<BodyRead> {
  if (declaresTooLarge(request)) return TOO_LARGE;
  const text = await readCappedText(request);
  if (text === null) return TOO_LARGE;
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: true, value: text };
  }
}

// 서비스가 검사 순서를 정한 뒤 읽는 본문(분석 요청). 선언된 길이는 지금 알려 주고, 읽기는 부를 때 한다.
export const lazyJsonBody = (request: Request): LazyBody => ({
  declaredTooLarge: declaresTooLarge(request),
  read: () => readJsonBody(request),
});
