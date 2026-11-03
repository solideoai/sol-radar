// 추천 분석 진행률(ADR-078, 디자인 스펙 7.2). 상태가 PENDING 과 완료뿐이라 실제 진행을 알 수 없어서,
// 걸린 시간으로 어림한다. 예상 시간 INSIGHT_EXPECTED_MS 까지 90 으로 고르게 오르고, 그 뒤로는 대기 상한
// (INSIGHT_POLL_LIMIT_MS, 3분)까지 99 를 향해 천천히 오른다. 99 에 닿는 때와 늦음 안내가 나오는 때는 같다(계획 Q4).
// 2026-11-03 사용자 지시로 고쳤다. T 를 대기 상한(3분)으로 두었더니 실제 생성(6~9초)이 5% 근처에서 끝나 100 으로 건너뛰었다.

/**
 * 진행률이 90 에 닿는 예상 시간. 운영 회사 Qwen 의 insight/v0.2 생성 6.4초·8.9초(2026-11-03)에
 * 결과를 묻는 간격(2초)을 더한 값이다.
 */
export const INSIGHT_EXPECTED_MS = 10_000;

/** 예상 시간에 닿을 때의 진행률. */
const EXPECTED_PERCENT = 90;

/** DONE 을 받으면 지금 값에서 100 까지 이어 채운다. 1 오를 때마다 이만큼 걸리고, 전체는 INSIGHT_FILL_MAX_MS 를 넘지 않는다. */
const FILL_MS_PER_POINT = 15;
export const INSIGHT_FILL_MAX_MS = 800;

/** 100% 에 닿은 뒤 그대로 보이는 시간. 그 뒤 내용으로 바꾼다. FAILED 는 100% 를 거치지 않는다. */
export const INSIGHT_DONE_HOLD_MS = 600;

/**
 * 0~99 정수. 100 은 DONE 때 화면이 따로 채운다(완료 전에는 99 에서 멈춘다).
 * 음수 경과(클라이언트·서버 시계 차)와 읽을 수 없는 값은 0 이다.
 */
export function insightProgress(elapsedMs: number, expectedMs: number, limitMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !(expectedMs > 0)) return 0;
  if (elapsedMs <= expectedMs) return Math.floor((EXPECTED_PERCENT * elapsedMs) / expectedMs);
  if (!(limitMs > expectedMs)) return 99;
  const tail = ((99 - EXPECTED_PERCENT) * (elapsedMs - expectedMs)) / (limitMs - expectedMs);
  return Math.min(99, Math.floor(EXPECTED_PERCENT + tail));
}

/** DONE 을 받은 값(from)에서 100 까지 채우는 데 쓰는 시간. */
export function insightFillMs(from: number): number {
  const left = Math.max(0, 100 - from);
  return Math.min(INSIGHT_FILL_MAX_MS, left * FILL_MS_PER_POINT);
}

/** 채우기 시작 뒤 elapsedMs 가 지났을 때 보일 값. from 에서 100 까지 고르게 오른다. */
export function insightFillValue(from: number, elapsedMs: number): number {
  const duration = insightFillMs(from);
  if (duration === 0 || elapsedMs >= duration) return 100;
  if (elapsedMs <= 0) return from;
  return Math.min(100, Math.floor(from + ((100 - from) * elapsedMs) / duration));
}
