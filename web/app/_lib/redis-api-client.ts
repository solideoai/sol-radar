import "server-only";
import { type Readiness } from "@/server/health";
import { redisApiConnection, type DeploymentEnv } from "./deployment-role";
import {
  analysisAcceptedSchema,
  backendErrorSchema,
  backendReadinessSchema,
  ingestAcceptedSchema,
} from "./redis-api-contract";
import { redisApiOperation } from "./redis-api-path";
import { withRedisApiDeadline } from "./redis-api-deadline";
import { redisApiError, redisApiUnavailable } from "./redis-api-response";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
type ClientDeps = {
  env: DeploymentEnv;
  send: typeof fetch;
  accessToken: () => Promise<string | null>;
  signal?: AbortSignal;
};

async function limitedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        cancel();
        throw new RangeError("HTTP_BODY_TOO_LARGE");
      }
      chunks.push(next.value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function responseHeaders(requestId?: string): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Request-Id": requestId ?? crypto.randomUUID(),
  });
}

/** HTTP 재시도도 같은 업무 키를 쓴다. Redis/DB 직접 연결로 대체하지 않는다. */
export async function relayRedisApi(
  request: Request,
  targetPath: string,
  overrides: Partial<ClientDeps> = {},
): Promise<Response> {
  const deps: ClientDeps = {
    env: process.env,
    send: fetch,
    accessToken: async () => (await import("@/server/auth")).getMyAccessToken(),
    ...overrides,
  };
  const operation = redisApiOperation(request.method, targetPath);
  if (operation !== "analysis-submit" && operation !== "ingest-submit")
    return redisApiError(404, "NOT_FOUND", "요청 경로를 찾을 수 없습니다.");
  try {
    const settings = redisApiConnection(deps.env);
    return await withRedisApiDeadline(
      settings.timeoutMs,
      async (signal) => {
        const accessToken = await deps.accessToken();
        signal.throwIfAborted();
        if (!accessToken) return redisApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
        if (Number(request.headers.get("Content-Length")) > MAX_REQUEST_BYTES)
          return bodyTooLarge();
        let body: Uint8Array;
        try {
          body = await limitedBody(request.body, MAX_REQUEST_BYTES, signal);
        } catch (error) {
          if (error instanceof RangeError) return bodyTooLarge();
          throw error;
        }
        const key = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
        const headers = new Headers({
          Authorization: `Bearer ${accessToken}`,
          "X-Sol-Service-Token": settings.token,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        });
        const url = `${settings.baseUrl}${targetPath}`;
        for (let attempt = 0; attempt < 2; attempt++) {
          let upstream: Response;
          let text: string;
          try {
            signal.throwIfAborted();
            upstream = await deps.send(url, {
              method: "POST",
              headers,
              body: body as BodyInit,
              signal,
              cache: "no-store",
              redirect: "manual",
            });
            if ([502, 503, 504].includes(upstream.status) && attempt === 0) {
              void upstream.body?.cancel().catch(() => undefined);
              throw new Error("REDIS_API_TEMPORARY_FAILURE");
            }
            if (upstream.status === 413) {
              void upstream.body?.cancel().catch(() => undefined);
              return bodyTooLarge();
            }
            if (
              upstream.status >= 500 ||
              upstream.status < 200 ||
              (upstream.status >= 300 && upstream.status < 400)
            ) {
              void upstream.body?.cancel().catch(() => undefined);
              return redisApiUnavailable();
            }
            text = new TextDecoder().decode(
              await limitedBody(upstream.body, MAX_RESPONSE_BYTES, signal),
            );
          } catch (error) {
            if (signal.aborted || error instanceof RangeError || attempt === 1) throw error;
            await retryDelay(signal);
            continue;
          }
          if (text.includes(settings.token) || text.includes(accessToken))
            return redisApiUnavailable();
          const raw: unknown = JSON.parse(text);
          const responseSchema =
            upstream.status === 202
              ? operation === "analysis-submit"
                ? analysisAcceptedSchema
                : ingestAcceptedSchema
              : backendErrorSchema;
          const parsed = responseSchema.safeParse(raw);
          if (
            !parsed.success ||
            (upstream.status !== 202 && ![400, 401, 403, 404, 409, 429].includes(upstream.status))
          )
            return redisApiUnavailable();
          const outputHeaders = responseHeaders(
            "error" in parsed.data ? parsed.data.error.requestId : undefined,
          );
          const retryAfter = upstream.headers.get("Retry-After");
          if (upstream.status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter))
            outputHeaders.set("Retry-After", retryAfter);
          return Response.json(parsed.data, { status: upstream.status, headers: outputHeaders });
        }
        return redisApiUnavailable();
      },
      deps.signal,
    );
  } catch {
    return redisApiUnavailable();
  }
}

function bodyTooLarge(): Response {
  return redisApiError(400, "VALIDATION_ERROR", "요청 본문이 너무 큽니다.", {
    issues: [{ path: "body", message: "16 KiB 이하여야 합니다" }],
  });
}

function retryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("REDIS_API_TIMEOUT"));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(new Error("REDIS_API_TIMEOUT"));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener("abort", stop);
        resolve();
      },
      50 + Math.floor(Math.random() * 50),
    );
    signal.addEventListener("abort", stop, { once: true });
  });
}

const UNAVAILABLE: Readiness = {
  status: "unavailable",
  checks: { db: "unavailable", redis: "unavailable", storage: "unavailable", ai: "unavailable" },
};

export async function readRedisApiReadiness(
  overrides: Partial<Pick<ClientDeps, "env" | "send">> = {},
): Promise<{ httpStatus: 200 | 503; body: Readiness }> {
  try {
    const { env = process.env, send = fetch } = overrides;
    const settings = redisApiConnection(env);
    // 서버 probe 상한2초에 전송 여유를 더한다. AI만 늦으면200/degraded를 유지한다.
    return await withRedisApiDeadline(5000, async (signal) => {
      const response = await send(`${settings.baseUrl}/health`, {
        headers: { "X-Sol-Service-Token": settings.token },
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      if (response.status !== 200 && response.status !== 503)
        throw new Error("BACKEND_HEALTH_STATUS");
      const raw: unknown = JSON.parse(
        new TextDecoder().decode(await limitedBody(response.body, 16 * 1024, signal)),
      );
      const body = backendReadinessSchema.parse(raw);
      const coreDown = [body.checks.db, body.checks.redis, body.checks.storage].includes(
        "unavailable",
      );
      const status = coreDown
        ? "unavailable"
        : body.checks.ai === "unavailable"
          ? "degraded"
          : "ok";
      if (body.status !== status || response.status !== (coreDown ? 503 : 200))
        throw new Error("BACKEND_HEALTH_INCONSISTENT");
      return { httpStatus: coreDown ? 503 : 200, body };
    });
  } catch {
    return { httpStatus: 503, body: structuredClone(UNAVAILABLE) };
  }
}
