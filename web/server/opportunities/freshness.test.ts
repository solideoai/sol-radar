import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { INGEST_SCHEDULE_INTERVAL_MINUTES } from "@/server/ingestion";
import {
  DEFAULT_INGEST_STALE_AFTER_MS,
  ingestStaleAfterMs,
  nextScheduledIngestAt,
} from "./freshness";
import { getSourceSummary } from "./repo";

const MINUTE = 60_000;

// 수집 지연 기준은 정기 일정 간격(180분) + 30분이다. 웹 env G2B_INGEST_INTERVAL_MINUTES 는 더 읽지 않는다.
describe("수집 신선도 기준", () => {
  it("지연 기준은 정기 간격 180분 + 30분 = 210분이다", () => {
    expect(INGEST_SCHEDULE_INTERVAL_MINUTES).toBe(180);
    expect(DEFAULT_INGEST_STALE_AFTER_MS).toBe(210 * MINUTE);
    expect(ingestStaleAfterMs()).toBe(210 * MINUTE);
    expect(ingestStaleAfterMs(null)).toBe(210 * MINUTE);
  });

  it("다음 수집 예정은 마지막 정기 수집 + 주기이고, 둘 중 하나라도 모르면 없다", () => {
    expect(nextScheduledIngestAt("2026-10-25T01:00:00.000Z", 180)).toBe("2026-10-25T04:00:00.000Z");
    expect(nextScheduledIngestAt(null, 180)).toBeNull();
    expect(nextScheduledIngestAt("2026-10-25T01:00:00.000Z", null)).toBeNull();
    expect(nextScheduledIngestAt("not-a-date", 180)).toBeNull();
  });

  it.each([
    [200, "HEALTHY"],
    [215, "DEGRADED"],
  ])("소스 HEALTHY 판정도 같은 기준을 쓴다(%i분 전 성공 → %s)", async (minutesAgo, expected) => {
    const finishedAt = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
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
      role: "NOTICE" as const,
    };
    const statusOf = async (staleAfterMs?: number) =>
      (await getSourceSummary(client, "live", [config], staleAfterMs)).groups[0]?.services[0]
        ?.status;
    expect(await statusOf(ingestStaleAfterMs())).toBe(expected);
    expect(await statusOf()).toBe(expected);
  });
});
