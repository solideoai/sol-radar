import { describe, expect, it } from "vitest";
import {
  POLL_FAST_MS,
  POLL_FAST_WINDOW_MS,
  POLL_LIMIT_MS,
  POLL_SLOW_MS,
} from "@/app/(app)/(work)/bids/[id]/use-analysis-run";
import { FAILURE_NOTICE_AFTER } from "./use-ingest-polling";

// 수집 이력 폴링의 숫자(디자인 스펙 §4.8 주기·상한, §4.3 "상태 읽기 연속 3회 실패").
// 훅은 분석 폴링 상수를 그대로 빌려 쓴다. 분석 쪽 숫자가 바뀌면 수집 화면 스펙과 어긋나므로 여기서도 빨개진다.
// 멈춤 판정(끝난 run·접수 run)은 ingest-runs.test.ts 의 isSettled, 401·403 구분은 ingestion-api.test.ts 의 readFirstPage 가 본다.

describe("수집 폴링 숫자(§4.8)", () => {
  it("처음 60초는 2초마다 읽는다", () => {
    expect(POLL_FAST_WINDOW_MS).toBe(60_000);
    expect(POLL_FAST_MS).toBe(2_000);
  });

  it("60초 뒤에는 5초마다 읽는다", () => {
    expect(POLL_SLOW_MS).toBe(5_000);
  });

  it("시작부터 300초가 상한이다", () => {
    expect(POLL_LIMIT_MS).toBe(300_000);
  });

  it("연속 3회 실패하면 상태 줄에 '확인하지 못했습니다'를 보인다", () => {
    expect(FAILURE_NOTICE_AFTER).toBe(3);
  });
});
