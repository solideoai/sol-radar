import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { ingestStaleAfterMs, nextScheduledIngestAt, parseIngestIntervalMinutes } from "./freshness";
import { getSourceSummary } from "./repo";

const MINUTE = 60_000;

// 수집 지연 기준은 G2B_INGEST_INTERVAL_MINUTES(양의 정수 분)의 2배, 없거나 틀리면 지금처럼 60분이다.
describe("수집 신선도 기준", () => {
  it("주기가 양의 정수면 그 2배 분을 지연 기준으로 쓴다", () => {
    expect(parseIngestIntervalMinutes("60")).toBe(60);
    expect(parseIngestIntervalMinutes(" 45 ")).toBe(45);
    expect(ingestStaleAfterMs(60)).toBe(120 * MINUTE);
  });

  it.each([undefined, "", "0", "-5", "1.5", "60분", "abc"])(
    "주기가 없거나 잘못되면(%j) 주기는 null 이고 지연 기준은 60분이다",
    (raw) => {
      expect(parseIngestIntervalMinutes(raw)).toBeNull();
      expect(ingestStaleAfterMs(parseIngestIntervalMinutes(raw))).toBe(60 * MINUTE);
    },
  );

  it("다음 수집 예정은 마지막 정기 수집 + 주기이고, 둘 중 하나라도 모르면 없다", () => {
    expect(nextScheduledIngestAt("2026-10-25T01:00:00.000Z", 60)).toBe("2026-10-25T02:00:00.000Z");
    expect(nextScheduledIngestAt("2026-10-25T01:00:00+00:00", 30)).toBe("2026-10-25T01:30:00.000Z");
    expect(nextScheduledIngestAt(null, 60)).toBeNull();
    expect(nextScheduledIngestAt("2026-10-25T01:00:00.000Z", null)).toBeNull();
    expect(nextScheduledIngestAt("not-a-date", 60)).toBeNull();
  });

  it("소스 HEALTHY 판정도 같은 기준을 쓴다(90분 전 성공은 60분 주기면 정상, 기본이면 지연)", async () => {
    const finishedAt = new Date(Date.now() - 90 * MINUTE).toISOString();
    const client = {
      rpc: async () => ({
        data: [
          {
            service_key: "g2b-bid-notice",
            source: "g2b",
            status: "SUCCEEDED",
            completeness: "COMPLETE",
            started_at: finishedAt,
            finished_at: finishedAt,
            last_success_at: finishedAt,
            summary: {},
            fetched_count: 3,
            auth_status: "VERIFIED",
            error_count: 0,
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient<Database>;
    const config = {
      key: "g2b-bid-notice",
      sourceFamily: "G2B" as const,
      serviceId: "15129394",
      displayName: "나라장터 입찰공고",
      enabled: true,
      blockedReason: null,
      keyIssuance: "ISSUED" as const,
    };
    const statusOf = async (staleAfterMs?: number) =>
      (await getSourceSummary(client, "live", [config], staleAfterMs)).groups[0]?.services[0]
        ?.status;
    expect(await statusOf(ingestStaleAfterMs(60))).toBe("HEALTHY");
    expect(await statusOf()).toBe("DEGRADED");
  });
});
