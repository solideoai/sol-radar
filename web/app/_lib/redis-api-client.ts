import "server-only";
import type { z } from "zod";
import { aiStatusSchema, type Readiness } from "@/server/health";
import { redisApiConnection, type DeploymentEnv } from "./deployment-role";
import {
  analysisAcceptedSchema,
  backendErrorSchema,
  backendReadinessSchema,
  ingestAcceptedSchema,
  ingestWorkerUnavailableErrorSchema,
  insightAcceptedFor,
  manualIngestGateSchema,
  sourceReadinessErrorSchema,
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
  if (
    operation !== "analysis-submit" &&
    operation !== "insight-submit" &&
    operation !== "ingest-submit" &&
    operation !== "ai-status" &&
    operation !== "ingest-gate-read"
  )
    return redisApiError(404, "NOT_FOUND", "요청 경로를 찾을 수 없습니다.");
  try {
    const settings = redisApiConnection(deps.env);
    return await withRedisApiDeadline(
      settings.timeoutMs,
      async (signal) => {
        const accessToken = await deps.accessToken();
        signal.throwIfAborted();
        if (!accessToken) return redisApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
        if (operation === "ai-status") {
          return relayGet(settings, accessToken, deps.send, signal, AI_STATUS_RELAY);
        }
        if (operation === "ingest-gate-read") {
          return relayGet(settings, accessToken, deps.send, signal, MANUAL_GATE_RELAY);
        }
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
            if ([502, 504].includes(upstream.status) && attempt === 0) {
              void upstream.body?.cancel().catch(() => undefined);
              throw new Error("REDIS_API_TEMPORARY_FAILURE");
            }
            if (upstream.status === 413) {
              void upstream.body?.cancel().catch(() => undefined);
              return bodyTooLarge();
            }
            if (
              (upstream.status >= 500 && upstream.status !== 503) ||
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
          const containsCredential = text.includes(settings.token) || text.includes(accessToken);
          if (upstream.status === 503) {
            // 다시 보내도 같은 답인 수집 503(소스 미준비·수집 Worker 미기동)은 재시도하지 않고 그대로 전한다.
            const sourceFailure =
              operation === "ingest-submit" && !containsCredential
                ? (permanentFailureResponse(
                    text,
                    sourceReadinessErrorSchema,
                    "아직 사용할 수 없는 수집 서비스입니다",
                  ) ??
                  permanentFailureResponse(
                    text,
                    ingestWorkerUnavailableErrorSchema,
                    "수집 Worker 가 아직 켜지지 않았습니다",
                  ))
                : null;
            if (sourceFailure !== null) return sourceFailure;
            if (attempt === 0) {
              await retryDelay(signal);
              continue;
            }
            return redisApiUnavailable();
          }
          if (containsCredential) return redisApiUnavailable();
          const raw: unknown = JSON.parse(text);
          const responseSchema =
            upstream.status === 202
              ? operation === "analysis-submit"
                ? analysisAcceptedSchema
                : operation === "insight-submit"
                  ? insightAcceptedFor(targetPath)
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

// GET 중계 한 종류. statuses 밖의 상태·schema 에 맞지 않는 본문·자격 증명이 섞인 본문은 503 {component:"redis-api"} 다.
type GetRelay = {
  path: string;
  statuses: readonly number[];
  okSchema: z.ZodType;
  /** 오류 상태 가운데 이 코드만 그대로 전한다(없으면 statuses 안의 오류 봉투는 모두 전한다) */
  acceptError?: (status: number, code: string) => boolean;
};

const AI_STATUS_RELAY: GetRelay = {
  path: "/api/v1/admin/ai/status",
  statuses: [200, 401, 403, 422],
  okSchema: aiStatusSchema,
  acceptError: (status, code) => status !== 422 || code === "HOSTED_NOT_APPROVED",
};

const MANUAL_GATE_RELAY: GetRelay = {
  path: "/api/v1/admin/ingestion/manual-gate",
  statuses: [200, 401, 403],
  okSchema: manualIngestGateSchema,
};

async function relayGet(
  settings: ReturnType<typeof redisApiConnection>,
  accessToken: string,
  send: typeof fetch,
  signal: AbortSignal,
  relay: GetRelay,
): Promise<Response> {
  const upstream = await send(`${settings.baseUrl}${relay.path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Sol-Service-Token": settings.token,
    },
    signal,
    cache: "no-store",
    redirect: "manual",
  });
  if (!relay.statuses.includes(upstream.status)) {
    void upstream.body?.cancel().catch(() => undefined);
    return redisApiUnavailable();
  }
  const text = new TextDecoder().decode(
    await limitedBody(upstream.body, MAX_RESPONSE_BYTES, signal),
  );
  if (text.includes(settings.token) || text.includes(accessToken)) return redisApiUnavailable();
  const raw: unknown = JSON.parse(text);
  if (upstream.status === 200) {
    const ok = relay.okSchema.safeParse(raw);
    if (!ok.success) return redisApiUnavailable();
    return Response.json(ok.data, { status: 200, headers: responseHeaders() });
  }
  const failure = backendErrorSchema.safeParse(raw);
  if (!failure.success) return redisApiUnavailable();
  if (relay.acceptError && !relay.acceptError(upstream.status, failure.data.error.code))
    return redisApiUnavailable();
  return Response.json(failure.data, {
    status: upstream.status,
    headers: responseHeaders(failure.data.error.requestId),
  });
}

function permanentFailureResponse(
  text: string,
  schema: typeof sourceReadinessErrorSchema | typeof ingestWorkerUnavailableErrorSchema,
  message: string,
): Response | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return Response.json(
      { error: { ...parsed.data.error, message } },
      { status: 503, headers: responseHeaders(parsed.data.error.requestId) },
    );
  } catch {
    return null;
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

type ReadinessDiagnostic = {
  reason:
    | "CONFIG_INVALID"
    | "UPSTREAM_HTTP"
    | "TIMEOUT"
    | "NETWORK"
    | "INVALID_RESPONSE"
    | "INCONSISTENT_RESPONSE";
  httpStatus?: number;
  elapsedMs: number;
  requestId: string;
};

export async function readRedisApiReadiness(
  overrides: Partial<Pick<ClientDeps, "env" | "send">> & {
    diagnose?: (diagnostic: ReadinessDiagnostic) => void;
  } = {},
): Promise<{ httpStatus: 200 | 503; body: Readiness }> {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  let reason: ReadinessDiagnostic["reason"] = "CONFIG_INVALID";
  let httpStatus: number | undefined;
  try {
    const { env = process.env, send = fetch } = overrides;
    const settings = redisApiConnection(env);
    reason = "NETWORK";
    // 서버 probe 상한2초에 전송 여유를 더한다. AI만 늦으면200/degraded를 유지한다.
    return await withRedisApiDeadline(5000, async (signal) => {
      const response = await send(`${settings.baseUrl}/health`, {
        headers: { "X-Sol-Service-Token": settings.token, "X-Request-Id": requestId },
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      httpStatus = response.status;
      if (response.status !== 200 && response.status !== 503) {
        reason = "UPSTREAM_HTTP";
        void response.body?.cancel().catch(() => undefined);
        throw new Error("BACKEND_HEALTH_STATUS");
      }
      reason = "INVALID_RESPONSE";
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
      if (body.status !== status || response.status !== (coreDown ? 503 : 200)) {
        reason = "INCONSISTENT_RESPONSE";
        throw new Error("BACKEND_HEALTH_INCONSISTENT");
      }
      return { httpStatus: coreDown ? 503 : 200, body };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "REDIS_API_TIMEOUT") reason = "TIMEOUT";
    const diagnose =
      overrides.diagnose ??
      ((value: ReadinessDiagnostic) => console.warn("redis-api readiness", value));
    diagnose({ reason, httpStatus, elapsedMs: Date.now() - started, requestId });
    return { httpStatus: 503, body: structuredClone(UNAVAILABLE) };
  }
}
