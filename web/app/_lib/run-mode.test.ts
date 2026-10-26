import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestStaleAfterMs, nextScheduledIngestAt } from "@/server/opportunities";
import { currentIngestIntervalMinutes, currentIngestMode, currentRunMode } from "./run-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

// 회사 redis-api 는 분석 Worker 와 맞추려고 SOL_RUN_MODE=mock 을 두면서 공공 API 수동 수집(live)을 받는다.
describe("수동 수집 실행 모드(SOL_INGEST_MODE)", () => {
  it("SOL_INGEST_MODE 가 있으면 그 값이고 SOL_RUN_MODE 는 그대로다", () => {
    vi.stubEnv("SOL_RUN_MODE", "mock");
    vi.stubEnv("SOL_INGEST_MODE", "live");
    expect(currentIngestMode()).toBe("live");
    expect(currentRunMode()).toBe("mock");
  });

  it.each(["", "  "])("비어 있으면(%j) SOL_RUN_MODE 를 따른다", (raw) => {
    vi.stubEnv("SOL_RUN_MODE", "fixture");
    vi.stubEnv("SOL_INGEST_MODE", raw);
    expect(currentIngestMode()).toBe("fixture");
  });

  it("잘못된 값이면 키 이름만 담아 던진다(공공 API 를 부르지 않는다)", () => {
    vi.stubEnv("SOL_RUN_MODE", "mock");
    vi.stubEnv("SOL_INGEST_MODE", "LIVE");
    expect(() => currentIngestMode()).toThrow("env 오류: SOL_INGEST_MODE");
  });
});

describe("수집 신선도: 웹은 수집 주기 env 를 읽지 않는다", () => {
  it("G2B_INGEST_INTERVAL_MINUTES 가 있어도 다음 수집 예정은 추정하지 않고 지연 기준은 210분이다", () => {
    vi.stubEnv("G2B_INGEST_INTERVAL_MINUTES", "60");
    expect(currentIngestIntervalMinutes()).toBeNull();
    expect(ingestStaleAfterMs(currentIngestIntervalMinutes())).toBe(210 * 60_000);
    expect(
      nextScheduledIngestAt("2026-10-25T01:00:00.000Z", currentIngestIntervalMinutes()),
    ).toBeNull();
  });
});
