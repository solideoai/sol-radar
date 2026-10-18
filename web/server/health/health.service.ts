import "server-only";
import {
  type AiState,
  type CheckState,
  PROBE_TIMEOUT_MS,
  type Readiness,
  toReadiness,
} from "./health.model";
import { probeAi, probeDb, probeRedis, probeStorage } from "./health.repo";

export type Probes = {
  db: () => Promise<CheckState>;
  redis: () => Promise<CheckState>;
  storage: () => Promise<CheckState>;
  ai: () => Promise<AiState>;
};

// 환경 변수는 호출 때 읽는다. 모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다.
function defaultProbes(): Probes {
  return {
    db: probeDb,
    redis: () => probeRedis(process.env.REDIS_URL),
    storage: () => probeStorage(process.env.MINIO_ENDPOINT),
    ai: () => probeAi(process.env.AI_GATEWAY_URL),
  };
}

/** 검사가 멈추거나 던져도 제한 시간 뒤 unavailable 로 끝낸다. 검사가 먼저 끝나면 타이머를 지운다. */
function withLimit<T extends string>(probe: () => Promise<T>): Promise<T | "unavailable"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unavailable"), PROBE_TIMEOUT_MS);
    const finish = (value: T | "unavailable") => {
      clearTimeout(timer);
      resolve(value);
    };
    // probe() 가 동기로 던져도 unavailable 이 되도록 Promise 로 감싼다.
    Promise.resolve()
      .then(probe)
      .then(finish, () => finish("unavailable"));
  });
}

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
