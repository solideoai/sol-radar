import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { STORAGE_OWNER, STORAGE_SENTINEL, type StorageSettings } from "@/server/documents";
import {
  type AiState,
  type DependencyScope,
  type DependencyReport,
  DEPENDENCY_HEALTH_KEY,
  DEPENDENCY_HEALTH_TTL_MS,
} from "@/server/health";

type ReporterDeps = {
  scope: DependencyScope;
  now(): number;
  storage(): Promise<void>;
  ai(): Promise<AiState>;
  publish(value: string): Promise<void>;
  timeoutMs?: number;
};
async function bounded<T>(work: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => fallback),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export function createDependencyReporter(deps: ReporterDeps) {
  let running: Promise<void> | null = null;
  async function probe() {
    const [storage, ai] = await Promise.all([
      bounded(
        async () => {
          await deps.storage();
          return "ok" as const;
        },
        deps.timeoutMs ?? 10_000,
        "unavailable" as const,
      ),
      bounded(deps.ai, deps.timeoutMs ?? 10_000, "unavailable"),
    ]);
    const report: DependencyReport = { checkedAt: deps.now(), scope: deps.scope, storage, ai };
    await deps.publish(JSON.stringify(report));
  }
  function run(): Promise<void> {
    if (running) return running;
    running = probe().finally(() => {
      running = null;
    });
    return running;
  }
  return {
    run,
    async settled() {
      await running;
    },
  };
}

export function createStorageProbe(client: SupabaseClient<Database>, settings: StorageSettings) {
  let lastWriteAt = 0;
  return async () => {
    for (const [kind, name] of [
      ["raw", settings.rawBucket],
      ["parsed", settings.parsedBucket],
    ] as const) {
      const bucket = await client.storage.getBucket(name);
      if (bucket.error || !bucket.data || bucket.data.public)
        throw new Error("storage_private_bucket_missing");
      const sentinel = await client.storage
        .from(name)
        .download(STORAGE_SENTINEL, {}, { signal: AbortSignal.timeout(5_000) });
      if (sentinel.error || !sentinel.data) throw new Error("storage_owner_missing");
      const owner: unknown = JSON.parse(await sentinel.data.text());
      if (
        typeof owner !== "object" ||
        !owner ||
        !("owner" in owner) ||
        owner.owner !== STORAGE_OWNER ||
        !("kind" in owner) ||
        owner.kind !== kind ||
        !("bucket" in owner) ||
        owner.bucket !== name
      )
        throw new Error("storage_owner_mismatch");
    }
    if (Date.now() - lastWriteAt < 5 * 60_000) return;
    for (const bucket of [settings.rawBucket, settings.parsedBucket]) {
      const key = `_sol-radar/health/${randomUUID()}`;
      const content = JSON.stringify({ owner: STORAGE_OWNER, check: key });
      const bytes = new TextEncoder().encode(content);
      const api = client.storage.from(bucket);
      const uploaded = await api.upload(key, bytes, {
        upsert: false,
        contentType: "application/json",
        cacheControl: "0",
      });
      if (uploaded.error) throw new Error("storage_write_failed");
      try {
        const downloaded = await api.download(key, {}, { signal: AbortSignal.timeout(5_000) });
        if (downloaded.error || !downloaded.data || (await downloaded.data.text()) !== content)
          throw new Error("storage_read_failed");
      } finally {
        const deleted = await api.remove([key]);
        if (deleted.error) throw new Error("storage_probe_cleanup_failed");
      }
    }
    lastWriteAt = Date.now();
  };
}

export function startDependencyReporter(reporter: ReturnType<typeof createDependencyReporter>) {
  const tick = () =>
    reporter.run().catch(() => {
      console.error("worker dependency health 기록 실패");
    });
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 30_000);
  return {
    async close() {
      clearInterval(timer);
      await reporter.settled().catch(() => undefined);
    },
  };
}

export const dependencyPublish =
  (redis: { set(key: string, value: string, expiry: "PX", ms: number): Promise<unknown> }) =>
  async (value: string) => {
    await redis.set(DEPENDENCY_HEALTH_KEY, value, "PX", DEPENDENCY_HEALTH_TTL_MS);
  };
