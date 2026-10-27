import type { SourceServiceStatus } from "@/server/opportunities";
import type { ManualGate } from "./ingestion-api";
import {
  BLOCKED_NOTICE,
  GATE_PENDING_NOTICE,
  IN_PROGRESS_NOTICE,
  NOT_LIVE_NOTICE,
  SCHEDULER_INACTIVE_NOTICE,
  sourceBlockText,
} from "./ingestion-copy";
import type { LiveControlView } from "./manual-gate";

// 서비스별 [증분 수집] 단추를 막을지와 그 이유(10-26 0순위). 상태를 바꾸지 않는 순수 함수다.
// 실수집 여부는 웹의 SOL_RUN_MODE(Vercel 은 mock)가 아니라 판정(GET manual-gate)의 수집 모드로 안다.
// 최종 판정은 서버다(POST 의 503 source·409·429). 화면은 서버가 이미 알려 준 상태로 미리 막을 뿐이다.

/** 나라장터 입찰공고. 이 서비스는 Worker 상태가 아니라 정기 일정(schedule.active)으로 준비 여부를 본다 */
export const G2B_BID_NOTICE_KEY = "g2b-bid-notice";

export type ServiceCollectView = { disabled: boolean; reason: string | null };

const blocked = (reason: string | null): ServiceCollectView => ({ disabled: true, reason });

/**
 * 우선순위: 요청 중 → 판정 없음 → 수집 모드 → registry → 정기 일정 → Worker 서비스 상태 → 같은 출처 실행 중
 * → 수동 수집 제한(쿨다운·공유 실행·하루 상한, [지금 불러오기]와 같은 gate).
 * - gate: 판정. 읽는 중이거나 읽지 못했으면 null
 * - live: liveControlViewOf(inProgress: false) 결과. 쿨다운·공유 실행·하루 상한만 본다(실수집 판정일 때만 있다)
 * - running: 같은 출처(source family)의 수집이 실행 중이거나 이 화면이 접수했다(서버도 409 로 막는다).
 *   다른 출처가 도는 중이면 막지 않는다(서버 판정과 같다)
 */
export function serviceCollectViewOf(input: {
  service: Pick<SourceServiceStatus, "key" | "enabled" | "blockedReason">;
  gate: ManualGate | null;
  live: LiveControlView | null;
  running: boolean;
  busy: boolean;
}): ServiceCollectView {
  const { service, gate, live, running, busy } = input;
  if (busy) return blocked(null);
  if (gate === null) return blocked(GATE_PENDING_NOTICE);
  if (gate.ingestMode !== "live") return blocked(NOT_LIVE_NOTICE);
  if (!service.enabled) return blocked(sourceBlockText(service.blockedReason));
  if (!gate.schedule.active) return blocked(SCHEDULER_INACTIVE_NOTICE);
  if (service.key !== G2B_BID_NOTICE_KEY) {
    const state = gate.services?.[service.key];
    if (state === undefined) return blocked(sourceBlockText("WORKER_NOT_READY"));
    if (state.state !== "READY") return blocked(sourceBlockText(state.state));
  }
  if (running) return blocked(IN_PROGRESS_NOTICE);
  if (live === null) return blocked(GATE_PENDING_NOTICE);
  if (live.blocked) return blocked(live.notice?.text ?? BLOCKED_NOTICE);
  return { disabled: false, reason: null };
}
