import { describe, expect, it } from "vitest";
import type { ApiFailure } from "@/app/(app)/(work)/bids/[id]/api-envelope";
import { QUOTA_CAUSE_TEXT, quotaCauseOf, type IngestRunError } from "./error-kind";
import { gateOf, type ManualGate } from "./ingestion-api";
import { liveControlViewOf } from "./manual-gate";
import { requestErrorOf } from "./request-errors";

// [지금 불러오기] 판정 표시·거절 문구·호출 한도 원인(10-26 운영 전환). 시각은 서버가 준 값을 서울 시각으로만 보인다.

const CHECKED_AT = Date.parse("2026-10-26T05:00:00.000Z"); // 14:00 KST
const RUN_ID = "0f8e2c1a-3b4d-4e5f-8a6b-7c8d9e0f1a2b";

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
  services: null,
  ...overrides,
});

const view = (value: ManualGate, ownRunIds: ReadonlySet<string> = new Set()) =>
  liveControlViewOf({ gate: value, checkedAt: CHECKED_AT, inProgress: false, ownRunIds, rows: [] });

const failure = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): ApiFailure => ({
  status,
  code,
  message: "server message",
  details,
});
const errorOf = (value: ApiFailure) =>
  requestErrorOf(value, {
    retryAfterSec: null,
    submitted: "g2b",
    runMode: "live",
    now: new Date(CHECKED_AT),
  });

describe("liveControlViewOf", () => {
  it("열려 있으면 막지 않고 정기 일정과 다음 정기 수집 시각을 보인다", () => {
    expect(view(gate())).toEqual({
      blocked: false,
      notice: null,
      schedule: "정기 수집: 매일 00·03·06·09·12·15·18·21시(KST) · 다음 15:00",
    });
  });

  it("쿨다운이면 막고 서버가 준 시각을 보인다. 날이 다르면 날짜를 붙인다", () => {
    expect(view(gate({ nextAvailableAt: "2026-10-26T06:05:00.000Z" }))).toMatchObject({
      blocked: true,
      notice: { text: "다음 불러오기 가능: 15:05" },
    });
    expect(view(gate({ nextAvailableAt: "2026-10-26T15:30:00.000Z" })).notice?.text).toBe(
      "다음 불러오기 가능: 10월 27일 00:30",
    );
  });

  it("다른 관리자의 공유 run 은 요청 시각과 run 보기를 주고, 내 공유 run 은 다음 가능 시각만 준다", () => {
    const sharedRun = {
      runId: RUN_ID,
      requestedAt: "2026-10-26T04:55:00.000Z",
      until: "2026-10-26T05:05:00.000Z",
      mine: false,
    };
    expect(view(gate({ sharedRun }))).toMatchObject({
      blocked: true,
      notice: {
        text: "다른 관리자가 13:55 에 요청한 수집이 진행 중입니다 · 다음 불러오기 가능: 14:05",
        showRunId: RUN_ID,
      },
    });
    // 내 접수: 서버가 mine 으로 알려 준다
    const mine = gate({
      sharedRun: { ...sharedRun, mine: true },
      nextAvailableAt: "2026-10-26T05:55:00.000Z",
    });
    expect(view(mine).notice).toEqual({ text: "다음 불러오기 가능: 14:55", showRunId: null });
    expect(view(gate({ sharedRun }), new Set([RUN_ID])).notice?.showRunId).toBeNull();
  });

  it("하루 한도를 다 쓰거나 정기 수집이 꺼져 있으면 막는다", () => {
    expect(
      view(gate({ daily: { used: 20, limit: 20, resetsAt: "2026-10-26T15:00:00.000Z" } })).notice
        ?.text,
    ).toBe("오늘 수동 불러오기 한도(20회)를 다 썼습니다 · 00:00 이후 가능");
    const off = view(gate({ schedule: { ...gate().schedule, active: false, nextRunAt: null } }));
    expect(off).toEqual({ blocked: true, notice: null, schedule: "정기 수집: 꺼짐" });
  });
});

describe("requestErrorOf: [지금 불러오기] 거절", () => {
  it("쿨다운·공유 run·하루 한도·진행 중·worker 꺼짐을 각자의 문장으로 보인다", () => {
    expect(
      errorOf(
        failure(429, "MANUAL_COOLDOWN", {
          nextAvailableAt: "2026-10-26T06:05:00.000Z",
          retryAfterSeconds: 3900,
        }),
      ).message,
    ).toBe("다음 불러오기 가능: 15:05");
    const shared = errorOf(
      failure(409, "MANUAL_SHARED_RUN", {
        runId: RUN_ID,
        requestedAt: "2026-10-26T04:58:00.000Z",
        nextAvailableAt: "2026-10-26T05:08:00.000Z",
        retryAfterSeconds: 480,
      }),
    );
    expect(shared.message).toBe(
      "다른 관리자가 13:58 에 요청한 수집이 진행 중입니다 · 다음 불러오기 가능: 14:08",
    );
    expect(shared.action).toEqual({ kind: "show-run", runId: RUN_ID });
    expect(errorOf(failure(429, "MANUAL_DAILY_LIMIT", { limit: 20 })).message).toBe(
      "오늘 수동 불러오기 한도(20회)를 다 썼습니다 · 00:00 이후 가능",
    );
    expect(errorOf(failure(409, "INGESTION_IN_PROGRESS", { runId: RUN_ID })).message).toBe(
      "수집이 진행 중입니다 · 끝나면 결과가 반영됩니다",
    );
    const inactive = errorOf(
      failure(503, "SERVICE_UNAVAILABLE", {
        component: "ingest-worker",
        reason: "SCHEDULER_INACTIVE",
      }),
    );
    expect(inactive.message).toBe("수집 Worker 가 아직 켜지지 않았습니다 · 운영자에게 문의");
    expect(inactive.retryAfterSec).toBeUndefined();
    expect(errorOf(failure(503, "SERVICE_UNAVAILABLE", { component: "queue" })).message).toMatch(
      /잠시 뒤 다시 시도하세요\.$/,
    );
  });
});

describe("quotaCauseOf", () => {
  const error = (errorCode: string, resultCode: string | null = null): IngestRunError => ({
    sourceKey: "g2b:quota",
    errorCode,
    resultCode,
    detail: "",
  });

  it("실제 소진(코드 22 포함)이 저장소 오류보다 먼저이고, 원인이 없으면 null 이다", () => {
    expect(
      quotaCauseOf([error("API_QUOTA_EXCEEDED", "22"), error("QUOTA_STORE_UNAVAILABLE")]),
    ).toBe("EXCEEDED");
    expect(quotaCauseOf([error("API_RESULT_CODE", " 22")])).toBe("EXCEEDED");
    expect(quotaCauseOf([error("QUOTA_STORE_UNAVAILABLE")])).toBe("STORE_UNAVAILABLE");
    expect(quotaCauseOf([error("API_TIMEOUT")])).toBeNull();
    expect(QUOTA_CAUSE_TEXT.EXCEEDED).toBe(
      "일일 API 호출 한도(1,000회)를 다 써서 수집하지 못했습니다 · 다음 날 00:00(KST)부터 다시 수집합니다",
    );
  });
});

describe("gateOf", () => {
  it("모르는 수집 모드는 null 로 읽어 실수집 단추를 띄우지 않고, 칸이 틀리면 판정 전체를 버린다", () => {
    const withoutMode = Object.fromEntries(
      Object.entries(gate()).filter(([key]) => key !== "ingestMode"),
    );
    expect(gateOf(withoutMode)?.ingestMode).toBeNull();
    expect(gateOf({ ...gate(), ingestMode: "live" })?.ingestMode).toBe("live");
    expect(gateOf({ ...gate(), daily: { used: "1", limit: 20, resetsAt: "x" } })).toBeNull();
  });
});
