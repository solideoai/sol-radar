import { describe, expect, it } from "vitest";
import type { IngestRunStatus, IngestTrigger, StartRunInput } from "./ingestion.repo";
import { createMemoryIngestionRepo, type MemoryIngestionRepo } from "./ingestion.repo.memory";

// 시험 전용 메모리 저장소의 findLatestRunWindowEnd 가 C3 계약 7-1 을 따르는지 본다.
// 7-1(security-auditor 중간): 일정 수집 창은 SCHEDULED run 만 잇는다. MANUAL run 의 미래 창 끝을 이어 받으면
// 다음 일정 수집이 그 사이 공고를 건너뛴다. 메모리 저장소는 Supabase 저장소(trigger = 'SCHEDULED')를 흉내 낸다.

const SCHEDULED_END = "2026-10-19T03:00:00.000Z";
const MANUAL_FUTURE_END = "2026-10-25T15:00:00.000Z";
const ZERO = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

const g2bRun = (jobKey: string, trigger: IngestTrigger, to: unknown): StartRunInput => ({
  source: "g2b",
  runMode: "LIVE",
  jobKey,
  trigger,
  batch: null,
  params: { window: { from: "2026-10-18T03:00:00.000Z", to }, stages: ["NOTICE"] },
});

// run 을 시작하고 정한 상태로 끝낸다(RUNNING 이면 끝내지 않는다).
const runWith = async (
  repo: MemoryIngestionRepo,
  input: StartRunInput,
  status: IngestRunStatus,
): Promise<void> => {
  const started = await repo.startRun(input);
  if (status !== "RUNNING") await repo.finishRun(started.runId, { status, summary: ZERO });
};

describe("메모리 저장소 findLatestRunWindowEnd(source, trigger) — C3 계약 7-1", () => {
  it("SCHEDULED 조회는 그 뒤에 시작한 MANUAL run 의 미래 창이 있어도 SCHEDULED run 의 창 끝을 준다", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(repo, g2bRun("g2b:SCHEDULED:1", "SCHEDULED", SCHEDULED_END), "SUCCEEDED");
    await runWith(repo, g2bRun("manual-1", "MANUAL", MANUAL_FUTURE_END), "SUCCEEDED");
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toEqual(
      new Date(SCHEDULED_END),
    );
  });

  it("SCHEDULED run 이 없으면 MANUAL·DEMO run 이 끝나 있어도 null 이다", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(repo, g2bRun("manual-1", "MANUAL", MANUAL_FUTURE_END), "SUCCEEDED");
    await runWith(repo, g2bRun("demo-1", "DEMO", MANUAL_FUTURE_END), "PARTIAL");
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toBeNull();
  });

  it("SCHEDULED run 이 여럿이면 가장 최근에 시작한 것의 창 끝이다", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(
      repo,
      g2bRun("g2b:SCHEDULED:1", "SCHEDULED", "2026-10-18T03:00:00.000Z"),
      "SUCCEEDED",
    );
    await runWith(repo, g2bRun("g2b:SCHEDULED:2", "SCHEDULED", SCHEDULED_END), "SUCCEEDED");
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toEqual(
      new Date(SCHEDULED_END),
    );
  });

  it("PARTIAL 로 끝난 SCHEDULED run 도 본다", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(repo, g2bRun("g2b:SCHEDULED:1", "SCHEDULED", SCHEDULED_END), "PARTIAL");
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toEqual(
      new Date(SCHEDULED_END),
    );
  });

  it.each<[IngestRunStatus]>([["FAILED"], ["RUNNING"]])(
    "%s SCHEDULED run 은 보지 않고 그 앞의 끝난 SCHEDULED run 창 끝을 준다",
    async (status) => {
      const repo = createMemoryIngestionRepo();
      await runWith(repo, g2bRun("g2b:SCHEDULED:1", "SCHEDULED", SCHEDULED_END), "SUCCEEDED");
      await runWith(repo, g2bRun("g2b:SCHEDULED:2", "SCHEDULED", MANUAL_FUTURE_END), status);
      await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toEqual(
        new Date(SCHEDULED_END),
      );
    },
  );

  it("가장 최근 SCHEDULED run 의 window.to 가 ISO 가 아니면 null 이다(더 앞 run 으로 내려가지 않는다)", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(repo, g2bRun("g2b:SCHEDULED:1", "SCHEDULED", SCHEDULED_END), "SUCCEEDED");
    await runWith(repo, g2bRun("g2b:SCHEDULED:2", "SCHEDULED", "어제"), "SUCCEEDED");
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toBeNull();
  });

  it("fixture run 은 보지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await runWith(
      repo,
      {
        source: "fixture",
        runMode: "FIXTURE",
        jobKey: "seed-1",
        trigger: "SCHEDULED",
        batch: "SEED",
        params: { window: { to: MANUAL_FUTURE_END } },
      },
      "PARTIAL",
    );
    await expect(repo.findLatestRunWindowEnd("g2b", "SCHEDULED")).resolves.toBeNull();
  });
});
