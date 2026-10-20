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

// N8 수동 수집(계획 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §2 ingestion.store.ts): run 입력의 runId(Route Handler 가
// 만든 202 의 id)가 있으면 새 run 의 id 다. 없으면 저장소가 정한다. 같은 jobKey 재실행은 기존 run 을 그대로 쓴다.
describe("메모리 저장소 startRun 의 runId(N8)", () => {
  const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
  const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
  const RUN_ID = "a8000000-0000-4000-8000-000000000001";
  const OTHER_RUN_ID = "a8000000-0000-4000-8000-000000000002";
  const manualRun = (runId?: string): StartRunInput => ({
    source: "fixture",
    runMode: "MOCK",
    jobKey: `manual:${ORG_ID}:req-1`,
    trigger: "MANUAL",
    batch: "SEED",
    params: null,
    requestedBy: USER_ID,
    idempotencyKey: `${ORG_ID}:req-1`,
    ...(runId === undefined ? {} : { runId }),
  });

  it("runId 가 있으면 새 run 의 id 가 그 값이다", async () => {
    const repo = createMemoryIngestionRepo();

    const started = await repo.startRun(manualRun(RUN_ID));

    expect([started.runId, repo.state.runs.get(manualRun().jobKey)?.runId]).toEqual([
      RUN_ID,
      RUN_ID,
    ]);
  });

  it("그 runId 로 run 을 끝낼 수 있다", async () => {
    const repo = createMemoryIngestionRepo();
    await repo.startRun(manualRun(RUN_ID));

    await repo.finishRun(RUN_ID, { status: "SUCCEEDED", summary: ZERO });

    expect(repo.state.runs.get(manualRun().jobKey)?.status).toBe("SUCCEEDED");
  });

  it("runId 가 없으면 저장소가 정한 id(run-<순번>)다", async () => {
    const repo = createMemoryIngestionRepo();

    const started = await repo.startRun(manualRun());

    expect(started.runId).toBe("run-1");
  });

  it("같은 jobKey 를 다른 runId 로 다시 시작하면 기존 run 을 그대로 준다(행을 새로 만들지 않는다)", async () => {
    const repo = createMemoryIngestionRepo();
    await repo.startRun(manualRun(RUN_ID));

    const again = await repo.startRun(manualRun(OTHER_RUN_ID));

    expect([again.runId, repo.state.runs.size]).toEqual([RUN_ID, 1]);
  });
});
