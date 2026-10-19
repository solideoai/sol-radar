import "server-only";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type {
  IngestionRepo,
  IngestRunMode,
  IngestRunStatus,
  IngestSummary,
} from "./ingestion.port";
import { runIngest, type IdFor } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// ── 공고 SEED 진입점(6-5). demo:reset 이 fixture 20건을 수집 흐름 그대로 적재한다 ──
// checksum·정규화·변경 감지의 정본은 수집 도메인 하나다. demo:reset 은 결과(공고 id·격리)만 받아 나머지 seed 에 쓴다.
export const DEMO_RESET_SEED_JOB_KEY = "fixture:SEED:demo-reset";

// FX-20 의 429 흉내(Retry-After 2초 × 2)가 seed 를 늦추지 않게 기다리지 않는다. 재시도 횟수(retried 2)는 그대로 센다.
const NO_WAIT_RETRY: RetryDeps = { sleep: () => Promise.resolve(), random: () => 0 };

export type SeedFixtureBidsInput = {
  repo: IngestionRepo;
  fixturesDir: string;
  anchor: Date;
  runMode: IngestRunMode;
  /** 기본 fixture:SEED:demo-reset */
  jobKey?: string;
  idFor?: IdFor;
  /** fetchedAt. 기본은 지금 시각 */
  now?: () => Date;
  /** 기본은 기다리지 않는 재시도 */
  retry?: RetryDeps;
};

export type SeedFixtureBid = {
  fixtureId: string;
  bidId: string;
  revisionId: string;
  noticeId: string;
  checksum: string;
};

export type SeedFixtureBidsResult = {
  bids: SeedFixtureBid[];
  quarantined: { fixtureId: string | null; sourceKey: string; errorCode: string }[];
  summary: IngestSummary;
  ingestRunId: string;
  status: IngestRunStatus;
};

export async function seedFixtureBids(input: SeedFixtureBidsInput): Promise<SeedFixtureBidsResult> {
  const manifest = await loadFixtureManifest(input.fixturesDir);
  const result = await runIngest({
    connector: createFixtureConnector({ fixturesDir: input.fixturesDir, batch: "SEED", manifest }),
    repo: input.repo,
    run: {
      source: "fixture",
      runMode: input.runMode,
      jobKey: input.jobKey ?? DEMO_RESET_SEED_JOB_KEY,
      trigger: "DEMO",
      batch: "SEED",
      params: { fixtures: [...manifest.batches.SEED] },
    },
    anchor: input.anchor,
    now: input.now ?? (() => new Date()),
    retry: input.retry ?? NO_WAIT_RETRY,
    ...(input.idFor === undefined ? {} : { idFor: input.idFor }),
  });
  return {
    bids: result.saved.flatMap(({ fixtureId, bidId, revisionId, noticeId, checksum }) =>
      fixtureId === null ? [] : [{ fixtureId, bidId, revisionId, noticeId, checksum }],
    ),
    quarantined: result.quarantined.map(({ fixtureId, sourceKey, errorCode }) => ({
      fixtureId,
      sourceKey,
      errorCode,
    })),
    summary: result.summary,
    ingestRunId: result.runId,
    status: result.status,
  };
}
