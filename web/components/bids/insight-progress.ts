// 추천 분석 진행률(ADR-078, 디자인 스펙 7.2). 상태가 PENDING 과 완료뿐이라 실제 진행을 알 수 없어서,
// 걸린 시간을 예상 시간 T(3분 대기 상한 INSIGHT_POLL_LIMIT_MS)에 견준 어림값으로 보인다.
// T 를 대기 상한과 같게 두면 99 에 닿는 때와 늦음 안내가 나오는 때가 같다(계획 Q4).

/** DONE 을 받은 뒤 100% 를 보이는 시간. 그 뒤 내용으로 바꾼다. FAILED 는 100% 를 거치지 않는다. */
export const INSIGHT_DONE_HOLD_MS = 600;

/**
 * 0~99 정수. 100 은 DONE 때 화면이 따로 보인다(완료 전에는 99 에서 멈춘다).
 * 음수 경과(클라이언트·서버 시계 차)와 읽을 수 없는 값은 0 이다.
 */
export function insightProgress(elapsedMs: number, expectedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !(expectedMs > 0)) return 0;
  return Math.min(99, Math.floor((100 * elapsedMs) / expectedMs));
}
