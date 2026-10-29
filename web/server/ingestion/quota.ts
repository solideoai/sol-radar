import "server-only";
import { kstCalendarDate } from "./normalize-date";

// ── V2-11 호출 예산: 카운터 키와 상태 판정만 둔다. Redis 연결은 worker 몫이다 ──
export const QUOTA_AUXILIARY_STOP_RATIO = 0.9;
export const DAILY_LIMIT_RESULT_CODE = "22";

export type QuotaState = "OK" | "AUXILIARY_STOPPED" | "EXHAUSTED";

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** data.go.kr 일일 한도는 KST 날짜로 바뀌므로 키도 KST 날짜로 나눈다. */
export function quotaKey(serviceId: string, at: Date): string {
  const { year, month, day } = kstCalendarDate(at);
  return `quota:${serviceId}:${year}${pad2(month)}${pad2(day)}`;
}

/**
 * 일일 한도는 기능(operation)마다 따로다(사용자 확인 2026-10-29, 나라장터 입찰공고는 목록·보조 3종 각 1,000회).
 * 목록은 서비스 id 그대로 세고(이전 키와 같다), 보조 조회는 뒤에 registryKey 를 붙여 따로 센다.
 */
export const scopedServiceId = (serviceId: string, scope?: string): string =>
  scope === undefined ? serviceId : `${serviceId}:${scope}`;

export function quotaState(used: number, dailyLimit: number): QuotaState {
  // 값을 믿을 수 없으면 호출하지 않는 쪽으로 닫는다. 한도를 넘기면 그날 수집 전체가 막힌다.
  if (!Number.isFinite(used) || !Number.isFinite(dailyLimit)) return "EXHAUSTED";
  if (dailyLimit <= 0 || used >= dailyLimit) return "EXHAUSTED";
  if (used >= dailyLimit * QUOTA_AUXILIARY_STOP_RATIO) return "AUXILIARY_STOPPED";
  return "OK";
}

export function isDailyLimitExceeded(resultCode: string | null | undefined): boolean {
  return resultCode?.trim() === DAILY_LIMIT_RESULT_CODE;
}
