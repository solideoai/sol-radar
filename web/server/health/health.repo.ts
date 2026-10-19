import "server-only";
import { Redis } from "ioredis";
import { getSupabaseAnon } from "@/server/supabase";
import { type AiState, type CheckState, PROBE_TIMEOUT_MS } from "./health.model";

// ── 의존성 검사. 어떤 실패도 밖으로 던지지 않고 unavailable 로 바꾼다 ──
// 오류 메시지·URL 은 남기지 않는다(Redis URL 에 비밀번호가 들어 있을 수 있다).
// 시간 상한은 service 가 건다. 여기의 제한은 멈춘 연결·요청을 정리하기 위한 것이다.

export async function probeDb(): Promise<CheckState> {
  try {
    const { error } = await getSupabaseAnon()
      .from("profiles")
      .select("id", { head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));
    return error ? "unavailable" : "ok";
  } catch {
    return "unavailable";
  }
}

export async function probeRedis(url: string | undefined): Promise<CheckState> {
  if (!url) return "unavailable";
  let client: Redis | null = null;
  try {
    client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: PROBE_TIMEOUT_MS,
      // TCP 는 받지만 답이 없는 서버에서는 connect() 가 AUTH 단계에서 끝나지 않아 finally 의 disconnect 에 못 닿는다.
      commandTimeout: PROBE_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
    });
    // 연결 실패는 'error' 이벤트로도 오므로 듣지 않으면 처리되지 않은 오류가 된다.
    client.on("error", () => {});
    await client.connect();
    return (await client.ping()) === "PONG" ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    client?.disconnect();
  }
}

export async function probeStorage(endpoint: string | undefined): Promise<CheckState> {
  if (!endpoint) return "unavailable";
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, "")}/minio/health/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status === 200 ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function probeAi(gatewayUrl: string | undefined): Promise<AiState> {
  if (!gatewayUrl) return "unavailable";
  try {
    const response = await fetch(`${gatewayUrl.replace(/\/+$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status !== 200) return "unavailable";
    const body: unknown = await response.json();
    const provider =
      typeof body === "object" && body !== null && "provider" in body ? body.provider : null;
    return provider === "mock" || provider === "local" || provider === "hosted"
      ? provider
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
