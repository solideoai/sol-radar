import "server-only";
import {
  type AiState,
  type CheckState,
  PROBE_TIMEOUT_MS,
  type Readiness,
  toReadiness,
} from "./health.model";
import { probeDb, probeRedis, readDependencyReport } from "./health.repo";

export type Probes = {
  db: () => Promise<CheckState>;
  redis: () => Promise<CheckState>;
  storage: () => Promise<CheckState>;
  ai: () => Promise<AiState>;
};

// 환경 변수는 호출 때 읽는다. 모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다.
function defaultProbes(): Probes {
  const report = readDependencyReport(process.env.REDIS_URL, {
    runMode: process.env.SOL_RUN_MODE?.trim() || "mock",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") || "",
    rawBucket: process.env.SUPABASE_STORAGE_RAW_BUCKET?.trim() || "bid-documents",
    parsedBucket: process.env.SUPABASE_STORAGE_PARSED_BUCKET?.trim() || "bid-parsed",
  });
  return {
    db: probeDb,
    redis: () => probeRedis(process.env.REDIS_URL),
    storage: async () => (await report)?.storage ?? "unavailable",
    ai: async () => (await report)?.ai ?? "unavailable",
  };
}

/** 검사가 멈추거나 던져도 제한 시간 뒤 fallback 으로 끝낸다. 검사가 먼저 끝나면 타이머를 지운다. */
export function limitProbe<T, F>(probe: () => Promise<T>, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS);
    const finish = (value: T | F) => {
      clearTimeout(timer);
      resolve(value);
    };
    // probe() 가 동기로 던져도 fallback 이 되도록 Promise 로 감싼다.
    Promise.resolve()
      .then(probe)
      .then(finish, () => finish(fallback));
  });
}

const withLimit = <T extends string>(probe: () => Promise<T>): Promise<T | "unavailable"> =>
  limitProbe(probe, "unavailable" as const);

export async function getReadiness(
  probes: Probes = defaultProbes(),
): Promise<{ httpStatus: 200 | 503; body: Readiness }> {
  const [db, redis, storage, ai] = await Promise.all([
    withLimit(probes.db),
    withLimit(probes.redis),
    withLimit(probes.storage),
    withLimit(probes.ai),
  ]);
  return toReadiness({ db, redis, storage, ai });
}

/** AI 검사 하나만 같은 제한 시간으로 돈다. 대시보드가 다른 검사를 기다리지 않게 한다. */
export function getAiState(probes: Probes = defaultProbes()): Promise<AiState> {
  return withLimit(probes.ai);
}
