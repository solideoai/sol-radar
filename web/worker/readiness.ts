import IORedis from "ioredis";
import { getSupabaseAdmin } from "@/server/supabase";
import type { WorkerEnv } from "@/worker/env";

export const READINESS_TIMEOUT_MS = 5_000;

export type ReadinessProbes = {
  pingRedis: () => Promise<unknown>;
  pingSupabase: () => Promise<unknown>;
};

function withTimeout(probe: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    probe().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("probe failed"));
      },
    );
  });
}

// 실패한 쪽 이름만 오류에 담는다. 원래 오류 메시지에는 접속 문자열이 섞일 수 있어 버린다.
export async function checkReadiness(
  probes: ReadinessProbes,
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<void> {
  const results = await Promise.allSettled([
    withTimeout(probes.pingRedis, timeoutMs),
    withTimeout(probes.pingSupabase, timeoutMs),
  ]);
  const failed = [
    results[0].status === "rejected" ? "redis" : null,
    results[1].status === "rejected" ? "supabase" : null,
  ].filter((name) => name !== null);
  if (failed.length > 0) {
    throw new Error(`준비 확인 실패: ${failed.join(", ")}`);
  }
}

export function createReadinessProbes(env: WorkerEnv): ReadinessProbes {
  return {
    pingRedis: async () => {
      const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      redis.on("error", () => undefined);
      try {
        await redis.connect();
        await redis.ping();
      } finally {
        redis.disconnect();
      }
    },
    pingSupabase: async () => {
      const { error } = await getSupabaseAdmin()
        .from("profiles")
        .select("id", { head: true })
        .limit(1);
      if (error) {
        throw new Error("supabase query failed");
      }
    },
  };
}
