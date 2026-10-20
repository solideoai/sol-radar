import "server-only";
import { quotaKey } from "./quota";

// ── 호출 예산 저장 포트(07 §2.2 "호출 예산"). 카운터 키는 quota:{serviceId}:{YYYYMMDD}(KST, quota.ts) ──
// 구현은 둘이다: worker 의 Redis(web/worker/quota-store.ts, INCRBY + TTL 2일)와 시험·fixture 용 메모리(아래).
// 상태 판정(OK·AUXILIARY_STOPPED·EXHAUSTED)은 quotaState 가 하고, 이 포트는 수만 센다.
export type QuotaStore = {
  /** 그날(KST) 지금까지 쓴 호출 수. 기록이 없으면 0. 숫자로 읽을 수 없으면 NaN(quotaState 가 EXHAUSTED 로 닫는다) */
  get(serviceId: string, at: Date): Promise<number>;
  /** 호출 수를 더하고 더한 뒤의 값을 돌려준다. 호출 직후마다 부른다 */
  add(serviceId: string, at: Date, calls: number): Promise<number>;
  /** 결과코드 22(일일 한도 초과)를 받았다. 값을 그날 한도 이상으로 올려 남은 호출을 막는다 */
  markExhausted(serviceId: string, at: Date): Promise<void>;
};

/** 수집 흐름이 예산을 보는 데 필요한 것. dailyLimit 은 registry quota.daily(infra/sources/registry.yaml) */
export type IngestQuota = { store: QuotaStore; serviceId: string; dailyLimit: number };

export type MemoryQuotaStore = QuotaStore & {
  /** 키(quotaKey) → 쓴 호출 수. 시험이 들여다본다 */
  readonly used: ReadonlyMap<string, number>;
};

export function validateDailyLimit(dailyLimit: number, who: string): number {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0) {
    throw new Error(`${who}: dailyLimit 은 0 이상 정수여야 한다`);
  }
  return dailyLimit;
}

/** 호출 수는 0 이상 정수다. 아니면 프로그램 오류라 던진다(카운터를 더럽히지 않는다). */
export function validateCalls(calls: number): number {
  if (!Number.isInteger(calls) || calls < 0) {
    throw new RangeError(`QuotaStore.add: calls 는 0 이상 정수여야 한다: ${calls}`);
  }
  return calls;
}

export function createMemoryQuotaStore(options: { dailyLimit: number }): MemoryQuotaStore {
  const dailyLimit = validateDailyLimit(options.dailyLimit, "MemoryQuotaStore");
  const used = new Map<string, number>();
  return {
    used,
    async get(serviceId, at) {
      return used.get(quotaKey(serviceId, at)) ?? 0;
    },
    async add(serviceId, at, calls) {
      const key = quotaKey(serviceId, at);
      const next = (used.get(key) ?? 0) + validateCalls(calls);
      used.set(key, next);
      return next;
    },
    async markExhausted(serviceId, at) {
      const key = quotaKey(serviceId, at);
      // 이미 한도를 넘었으면 그대로 둔다(내리지 않는다).
      used.set(key, Math.max(used.get(key) ?? 0, dailyLimit));
    },
  };
}
