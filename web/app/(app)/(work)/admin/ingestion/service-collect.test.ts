import { describe, expect, it } from "vitest";
import type { ManualGate } from "./ingestion-api";
import {
  GATE_PENDING_NOTICE,
  IN_PROGRESS_NOTICE,
  NOT_LIVE_NOTICE,
  SCHEDULER_INACTIVE_NOTICE,
  sourceBlockText,
} from "./ingestion-copy";
import { liveControlViewOf } from "./manual-gate";
import { G2B_BID_NOTICE_KEY, serviceCollectViewOf } from "./service-collect";

// 서비스별 [증분 수집] 단추 조건(10-26 0순위). 웹의 SOL_RUN_MODE 가 아니라 판정의 수집 모드·서비스 상태로 막는다.

const CHECKED_AT = Date.parse("2026-10-26T05:00:00.000Z");
const LH = "lh-bid-notice";

const gate = (overrides: Partial<ManualGate> = {}): ManualGate => ({
  ingestMode: "live",
  cooldownMinutes: 60,
  nextAvailableAt: null,
  sharedRun: null,
  daily: { used: 0, limit: 20, resetsAt: "2026-10-26T15:00:00.000Z" },
  schedule: {
    pattern: "0 */3 * * *",
    timezone: "Asia/Seoul",
    slotHoursKst: [0, 3, 6, 9, 12, 15, 18, 21],
    active: true,
    nextRunAt: "2026-10-26T06:00:00.000Z",
  },
  services: { [LH]: { state: "READY", scheduled: true } },
  ...overrides,
});

const viewOf = (
  value: ManualGate | null,
  {
    key = LH,
    enabled = true,
    blockedReason = null,
    running = false,
  }: { key?: string; enabled?: boolean; blockedReason?: string | null; running?: boolean } = {},
) =>
  serviceCollectViewOf({
    service: { key, enabled, blockedReason },
    gate: value,
    live:
      value === null
        ? null
        : liveControlViewOf({
            gate: value,
            checkedAt: CHECKED_AT,
            inProgress: false,
            ownRunIds: new Set(),
            rows: [],
          }),
    running,
    busy: false,
  });

const open = { disabled: false, reason: null };

describe("serviceCollectViewOf", () => {
  it("판정을 읽기 전이면 막는다", () => {
    expect(viewOf(null)).toEqual({ disabled: true, reason: GATE_PENDING_NOTICE });
  });

  it("수집 모드가 live 가 아니면 서비스가 준비돼 있어도 막는다", () => {
    expect(viewOf(gate({ ingestMode: "mock" }))).toEqual({
      disabled: true,
      reason: NOT_LIVE_NOTICE,
    });
  });

  it("웹 실행 모드와 상관없이 회사 수집 모드가 live 이고 서비스가 READY 이면 연다", () => {
    expect(viewOf(gate())).toEqual(open);
  });

  it("registry 에서 꺼진 서비스는 registry 이유를 보인다", () => {
    expect(viewOf(gate(), { enabled: false, blockedReason: "DISABLED" })).toEqual({
      disabled: true,
      reason: sourceBlockText("DISABLED"),
    });
  });

  it("정기 일정이 꺼져 있으면 막는다", () => {
    const value = gate({ schedule: { ...gate().schedule, active: false } });
    expect(viewOf(value)).toEqual({ disabled: true, reason: SCHEDULER_INACTIVE_NOTICE });
  });

  it.each(["KEY_MISSING", "AUTH_FAILED", "QUOTA_UNVERIFIED"])(
    "Worker 가 %s 로 남긴 외부 서비스만 막는다",
    (state) => {
      const value = gate({
        services: {
          [LH]: { state, scheduled: false },
          "kwater-bid-notice": { state: "READY", scheduled: true },
        },
      });
      expect(viewOf(value)).toEqual({ disabled: true, reason: sourceBlockText(state) });
      expect(viewOf(value, { key: "kwater-bid-notice" })).toEqual(open);
    },
  );

  it("Worker 상태가 없으면 외부 서비스는 막고 나라장터 입찰공고는 연다", () => {
    const value = gate({ services: null });
    expect(viewOf(value)).toEqual({
      disabled: true,
      reason: sourceBlockText("WORKER_NOT_READY"),
    });
    expect(viewOf(value, { key: G2B_BID_NOTICE_KEY })).toEqual(open);
  });

  it("같은 출처가 실행 중이면 막는다", () => {
    expect(viewOf(gate(), { running: true })).toEqual({
      disabled: true,
      reason: IN_PROGRESS_NOTICE,
    });
  });

  it("수동 수집 쿨다운이면 [지금 불러오기]와 같은 이유로 막는다", () => {
    const view = viewOf(gate({ nextAvailableAt: "2026-10-26T05:40:00.000Z" }));
    expect(view.disabled).toBe(true);
    expect(view.reason).toContain("14:40");
  });
});
