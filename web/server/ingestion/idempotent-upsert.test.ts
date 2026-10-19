import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BidSourceConnector, FetchPageInput } from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureBatch, FixtureManifest } from "./fixture.model";
import type { StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryEventsOf,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// G1: 같은 공고 2회 수집 → bid 1건, revision 1, 이벤트 0 (FX-09, + FX-10 차수). 07 §5, 11 §3.
// SEED 와 LIVE 는 같은 anchor 를 쓴다(그래야 FX-09 의 상대 날짜가 같아 중복으로 잡힌다).

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const NOW = new Date("2026-10-19T09:00:00.000Z");
const LATER = new Date("2026-10-20T09:00:00.000Z");

const FX09 = "DEMO-2026-0009";
const FX10 = "DEMO-2026-0010";

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const retry = (): RetryDeps => ({ sleep: async () => undefined, random: () => 0 });

const runOf = (jobKey: string, batch: FixtureBatch): StartRunInput => ({
  source: "fixture",
  runMode: "FIXTURE",
  jobKey,
  trigger: "DEMO",
  batch,
  params: null,
});

const ingest = (
  repo: MemoryIngestionRepo,
  jobKey: string,
  batch: FixtureBatch,
  options: { now?: Date; connector?: BidSourceConnector } = {},
) =>
  runIngest({
    connector:
      options.connector ?? createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch, manifest }),
    repo,
    run: runOf(jobKey, batch),
    anchor: ANCHOR,
    now: () => options.now ?? NOW,
    retry: retry(),
  });

const seedThenLive = async () => {
  const repo = createMemoryIngestionRepo();
  const seed = await ingest(repo, "seed-1", "SEED");
  const afterSeed = { fx09Events: memoryEventsOf(repo, "fixture", FX09).length };
  const live = await ingest(repo, "live-1", "LIVE");
  return { repo, seed, live, afterSeed };
};

describe("G1 — FX-09 재전송(duplicate-delivery)", () => {
  it("SEED 뒤 LIVE 를 돌려도 FX-09 의 revision 은 1건(revision 1)이다", async () => {
    const { repo } = await seedThenLive();
    expect(memoryRevisionsOf(repo, "fixture", FX09).map((revision) => revision.revision)).toEqual([
      1,
    ]);
  });

  it("SEED 뒤 LIVE 를 돌려도 FX-09 를 담은 bid 는 하나다", async () => {
    const { repo } = await seedThenLive();
    const bidIds = repo.state.revisions
      .filter((revision) => revision.normalized.noticeId === FX09)
      .map((revision) => revision.bidId);
    expect(new Set(bidIds).size).toBe(1);
  });

  it("LIVE 는 FX-09 이벤트를 추가하지 않는다(BID_CREATED 1건 그대로)", async () => {
    const { repo, afterSeed } = await seedThenLive();
    expect(afterSeed.fx09Events).toBe(1);
    expect(memoryEventsOf(repo, "fixture", FX09).map((event) => event.idempotencyKey)).toEqual([
      `fixture:${FX09}:1:BID_CREATED`,
    ]);
  });

  it("LIVE 의 FX-09 는 saved 에 없다(새 revision 없음)", async () => {
    const { live } = await seedThenLive();
    expect(live.saved.map((saved) => saved.noticeId)).not.toContain(FX09);
  });

  it("LIVE 의 FX-09 는 skippedDuplicate 1 로 센다", async () => {
    const { live } = await seedThenLive();
    expect(live.summary.skippedDuplicate).toBe(1);
  });

  it("SEED 뒤 LIVE 를 돌려도 공고는 19건이다(FX-12 격리 제외)", async () => {
    const { repo } = await seedThenLive();
    expect(repo.state.bids.size).toBe(19);
  });
});

describe("G1 — FX-10 재공고(02차)는 같은 bid 의 다음 revision", () => {
  it("FX-10 은 같은 bid 아래 revision 1·2 를 가진다", async () => {
    const { repo } = await seedThenLive();
    const revisions = memoryRevisionsOf(repo, "fixture", FX10);
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(new Set(revisions.map((revision) => revision.bidId)).size).toBe(1);
  });

  it("FX-10 revision 1 의 amendmentNo 는 01, revision 2 는 02 다", async () => {
    const { repo } = await seedThenLive();
    expect(
      memoryRevisionsOf(repo, "fixture", FX10).map((revision) => revision.normalized.amendmentNo),
    ).toEqual(["01", "02"]);
  });

  it("FX-10 은 BID_CREATED(r1)와 BID_CHANGED(r2) 이벤트를 하나씩 가진다", async () => {
    const { repo } = await seedThenLive();
    expect(memoryEventsOf(repo, "fixture", FX10).map((event) => event.idempotencyKey)).toEqual([
      `fixture:${FX10}:1:BID_CREATED`,
      `fixture:${FX10}:2:BID_CHANGED`,
    ]);
  });
});

describe("G1 — LIVE 를 다른 jobKey 로 한 번 더", () => {
  const liveTwice = async () => {
    const scenario = await seedThenLive();
    const before = {
      revisions: scenario.repo.state.revisions.length,
      outbox: scenario.repo.state.outbox.length,
    };
    const again = await ingest(scenario.repo, "live-2", "LIVE", { now: LATER });
    return { ...scenario, before, again };
  };

  it("새 revision 을 만들지 않는다(fetchedAt 이 달라도)", async () => {
    const { repo, before } = await liveTwice();
    expect(before.revisions).toBe(23);
    expect(repo.state.revisions).toHaveLength(before.revisions);
  });

  it("새 이벤트를 만들지 않는다", async () => {
    const { repo, before } = await liveTwice();
    expect(before.outbox).toBe(23);
    expect(repo.state.outbox).toHaveLength(before.outbox);
  });

  it("다섯 건 모두 skippedDuplicate 로 센다", async () => {
    const { again } = await liveTwice();
    expect(again.summary).toEqual({
      created: 0,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 5,
      quarantined: 0,
      retried: 0,
    });
  });

  it("saved 는 비어 있다", async () => {
    const { again } = await liveTwice();
    expect(again.saved).toEqual([]);
  });

  it("새 run 이므로 alreadyFinished 는 false 이고 SUCCEEDED 로 끝난다", async () => {
    const { again } = await liveTwice();
    expect(again.alreadyFinished).toBe(false);
    expect(again.status).toBe("SUCCEEDED");
  });
});

describe("G1 — 같은 jobKey 재실행은 멱등(alreadyFinished)", () => {
  const rerunSameJob = async () => {
    const scenario = await seedThenLive();
    const before = {
      revisions: scenario.repo.state.revisions.length,
      outbox: scenario.repo.state.outbox.length,
      checkpoints: scenario.repo.state.checkpoints.length,
      finishes: scenario.repo.state.finishes.length,
    };
    const inner = createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "LIVE", manifest });
    const fetchPage = vi.fn((input: FetchPageInput) => inner.fetchPage(input));
    const connector: BidSourceConnector = { source: inner.source, fetchPage };
    const rerun = await ingest(scenario.repo, "live-1", "LIVE", { connector });
    return { ...scenario, before, rerun, fetchPage };
  };

  it("SUCCEEDED 로 끝난 jobKey 를 다시 돌리면 alreadyFinished true 다", async () => {
    const { rerun } = await rerunSameJob();
    expect(rerun.alreadyFinished).toBe(true);
  });

  it("다시 돌린 결과는 같은 runId·SUCCEEDED·처음 summary 를 돌려준다", async () => {
    const { live, rerun } = await rerunSameJob();
    expect(rerun.runId).toBe(live.runId);
    expect(rerun.status).toBe("SUCCEEDED");
    expect(rerun.summary).toEqual(live.summary);
  });

  it("다시 돌린 결과의 saved 는 비어 있다", async () => {
    const { rerun } = await rerunSameJob();
    expect(rerun.saved).toEqual([]);
  });

  it("다시 돌린 결과의 resumedFromCursor 는 null 이다", async () => {
    const { rerun } = await rerunSameJob();
    expect(rerun.resumedFromCursor).toBeNull();
  });

  it("다시 돌리면 connector 를 한 번도 부르지 않는다", async () => {
    const { fetchPage } = await rerunSameJob();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("다시 돌려도 revision·이벤트·체크포인트·종료 기록이 늘지 않는다", async () => {
    const { repo, before } = await rerunSameJob();
    expect({
      revisions: repo.state.revisions.length,
      outbox: repo.state.outbox.length,
      checkpoints: repo.state.checkpoints.length,
      finishes: repo.state.finishes.length,
    }).toEqual(before);
  });
});

describe("G1 — PARTIAL(일부 격리)로 끝난 jobKey 도 끝난 run 이다(04 §4)", () => {
  const rerunSeedJob = async () => {
    const scenario = await seedThenLive();
    const before = {
      errors: scenario.repo.state.errors.length,
      revisions: scenario.repo.state.revisions.length,
      finishes: scenario.repo.state.finishes.length,
    };
    const inner = createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "SEED", manifest });
    const fetchPage = vi.fn((input: FetchPageInput) => inner.fetchPage(input));
    const connector: BidSourceConnector = { source: inner.source, fetchPage };
    const rerun = await ingest(scenario.repo, "seed-1", "SEED", { connector });
    return { ...scenario, before, rerun, fetchPage };
  };

  it("SEED 는 FX-12 격리 때문에 PARTIAL 로 끝난다", async () => {
    const { seed } = await seedThenLive();
    expect(seed.status).toBe("PARTIAL");
  });

  it("PARTIAL 로 끝난 SEED jobKey 를 다시 돌리면 alreadyFinished true, 같은 runId·PARTIAL·처음 summary 다", async () => {
    const { seed, rerun } = await rerunSeedJob();
    expect(rerun.alreadyFinished).toBe(true);
    expect(rerun.runId).toBe(seed.runId);
    expect(rerun.status).toBe("PARTIAL");
    expect(rerun.summary).toEqual(seed.summary);
  });

  it("PARTIAL jobKey 재실행의 saved 는 비어 있고 resumedFromCursor 는 null 이다", async () => {
    const { rerun } = await rerunSeedJob();
    expect(rerun.saved).toEqual([]);
    expect(rerun.resumedFromCursor).toBeNull();
  });

  it("PARTIAL jobKey 재실행은 connector 를 부르지 않는다", async () => {
    const { fetchPage } = await rerunSeedJob();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("PARTIAL jobKey 재실행은 격리 오류·revision·종료 기록을 늘리지 않는다", async () => {
    const { repo, before } = await rerunSeedJob();
    expect({
      errors: repo.state.errors.length,
      revisions: repo.state.revisions.length,
      finishes: repo.state.finishes.length,
    }).toEqual(before);
  });
});
