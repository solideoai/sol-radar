import "server-only";
import { z } from "zod";
import { EXTERNAL_SOURCE_KEYS, type ExternalSourceKey } from "./source-keys";

// ── 외부 수집 서비스 준비 상태(10-26 0순위 안전장치) ──
// ingest Worker 는 기동 때 외부 서비스마다 상태를 정하고, 서비스 하나가 막혀도 나머지와 나라장터 수집을 계속 돈다.
// Worker 가 정한 상태를 Redis 한 키에 JSON 으로 남기고 redis-api 가 읽어 수동 수집 판정·화면 표시에 쓴다.
// 키 값·env 값은 싣지 않는다(상태 이름과 일정 여부만).

/**
 * - READY: 키·한도·기본 조회 방식이 갖춰져 정기 수집에 들어간다
 * - NOT_CALLABLE: registry 가 막았다(DISABLED·NOT_VERIFIED 등, reason 에 registry 사유)
 * - OPERATION_UNVERIFIED: 키는 있으나 기본 조회 방식이 녹음 응답으로 검증되지 않아 정기 수집에서 뺐다
 * - QUOTA_UNVERIFIED: registry quota.daily 가 없다. 한도를 지어내지 않고 부르지 않는다
 * - KEY_MISSING: 서비스키 env 가 비었다
 * - KEY_INVALID: 서비스키 형식이 틀렸거나 env 이름이 허용 목록 밖이다
 * - AUTH_FAILED: 실행 중 공공 API 가 인증 오류(resultCode 30·31)를 돌려줬다. Worker 를 다시 띄울 때까지 부르지 않는다
 */
export const SOURCE_READINESS_STATES = [
  "READY",
  "NOT_CALLABLE",
  "OPERATION_UNVERIFIED",
  "QUOTA_UNVERIFIED",
  "KEY_MISSING",
  "KEY_INVALID",
  "AUTH_FAILED",
] as const;
export type SourceReadinessState = (typeof SOURCE_READINESS_STATES)[number];

/** Worker 가 쓰고 redis-api 가 읽는 키. 만료 없이 Worker 가 기동·인증 실패 때 덮어쓴다 */
export const SOURCE_READINESS_KEY = "ingest:source-readiness";

const serviceReadinessSchema = z.object({
  state: z.enum(SOURCE_READINESS_STATES),
  /** NOT_CALLABLE 일 때 registry 사유(callableSource reason) */
  reason: z
    .string()
    .regex(/^[A-Z_]{1,50}$/)
    .optional(),
  /** 이 서비스의 정기 수집 Job Scheduler 를 걸었는지 */
  scheduled: z.boolean(),
});
export type ServiceReadiness = z.infer<typeof serviceReadinessSchema>;

/**
 * 서비스별 상태 묶음. 아는 서비스 키의 올바른 항목만 남기고 나머지는 버린다(던지지 않는다).
 * Worker·redis-api·웹의 배포 시점이 달라 한쪽에 새 서비스나 새 상태가 생겨도 다른 서비스와 응답 전체가 깨지지 않게 한다.
 * 버려진 서비스는 "상태 없음"(WORKER_NOT_READY)으로 막힌다.
 */
export const sourceReadinessServicesSchema = z
  .record(z.string(), z.unknown())
  .transform((raw): Partial<Record<ExternalSourceKey, ServiceReadiness>> => {
    const known: Partial<Record<ExternalSourceKey, ServiceReadiness>> = {};
    for (const key of EXTERNAL_SOURCE_KEYS) {
      const parsed = serviceReadinessSchema.safeParse(raw[key]);
      if (parsed.success) known[key] = parsed.data;
    }
    return known;
  });

export const sourceReadinessSnapshotSchema = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime({ offset: true }),
  services: sourceReadinessServicesSchema,
});
export type SourceReadinessSnapshot = z.infer<typeof sourceReadinessSnapshotSchema>;

/** redis-api 가 스냅숏을 읽는 곳. 키가 없으면 null(새 Worker 가 아직 기동하지 않았다), Redis 오류는 던진다 */
export type SourceReadinessReader = { read(): Promise<SourceReadinessSnapshot | null> };

/** 스냅숏 JSON 을 읽는다. 모양이 다르면 null(옛·깨진 값은 "Worker 상태 모름"으로 본다) */
export function parseSourceReadiness(raw: string | null): SourceReadinessSnapshot | null {
  if (raw === null) return null;
  try {
    const parsed = sourceReadinessSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * 수동 외부 수집을 받을지. 받으면 null, 아니면 503 details.reason 에 실을 사유.
 * 스냅숏이 없으면 WORKER_NOT_READY(새 Worker 미기동), 서비스 항목이 없어도 같다.
 * OPERATION_UNVERIFIED 는 기본 조회 방식만 미검증이라는 뜻이다. 요청한 조회 방식이 녹음 응답으로 검증됐으면 받는다
 * (Worker gate 와 같은 판정, worker/main.ts readinessBlockOf).
 */
export function externalManualBlockOf(
  snapshot: SourceReadinessSnapshot | null,
  serviceKey: ExternalSourceKey,
  options: { operationVerified: boolean },
): Exclude<SourceReadinessState, "READY"> | "WORKER_NOT_READY" | null {
  const service = snapshot?.services[serviceKey];
  if (service === undefined) return "WORKER_NOT_READY";
  if (service.state === "READY") return null;
  if (service.state === "OPERATION_UNVERIFIED" && options.operationVerified) return null;
  return service.state;
}
