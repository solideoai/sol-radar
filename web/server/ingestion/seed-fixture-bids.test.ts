import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
// 계약 6-5 는 배럴 공개만 정한다(파일 이름은 정하지 않는다). 그래서 배럴에서 불러온다.
import { seedFixtureBids, type IdFor } from "./index";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";

// C3 계약 6-5: demo:reset 의 공고 SEED 진입점 seedFixtureBids. 메모리 저장소와 실제 fixtures 폴더로 본다.
// 실제 Supabase·네트워크는 부르지 않는다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const NOW = new Date("2026-10-19T09:00:00.000Z");
const DEFAULT_JOB_KEY = "fixture:SEED:demo-reset";

const SEED_IDS = Array.from(
  { length: 20 },
  (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
);
const SAVED_IDS = SEED_IDS.filter((id) => id !== "FX-12");
const noticeIdOf = (fixtureId: string) => `DEMO-2026-00${fixtureId.slice(3)}`;

// 07 §6.4 SEED 기대값
const SEED_SUMMARY = {
  created: 19,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 1,
  retried: 2,
};

const fastRetry = { sleep: async () => undefined, random: () => 0 };

const seed = async (
  options: { repo?: MemoryIngestionRepo; jobKey?: string; idFor?: IdFor; withRetry?: boolean } = {},
) => {
  const repo = options.repo ?? createMemoryIngestionRepo();
  const result = await seedFixtureBids({
    repo,
    fixturesDir: FIXTURES_DIR,
    anchor: ANCHOR,
    runMode: "FIXTURE",
    now: () => NOW,
    ...(options.withRetry === false ? {} : { retry: fastRetry }),
    ...(options.jobKey === undefined ? {} : { jobKey: options.jobKey }),
    ...(options.idFor === undefined ? {} : { idFor: options.idFor }),
  });
  return { repo, result };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedFixtureBids — bids", () => {
  it("bids 는 FX-12 를 뺀 19건을 manifest 순서로 담는다", async () => {
    const { result } = await seed();
    expect(result.bids.map((bid) => bid.fixtureId)).toEqual(SAVED_IDS);
  });

  it("bids 의 noticeId 는 그 fixture 의 공고번호다", async () => {
    const { result } = await seed();
    expect(result.bids.map((bid) => [bid.fixtureId, bid.noticeId])).toEqual(
      SAVED_IDS.map((id) => [id, noticeIdOf(id)]),
    );
  });

  it("bids 의 bidId·revisionId·checksum 은 저장소에 남은 revision 과 같다", async () => {
    const { repo, result } = await seed();
    const stored = SAVED_IDS.map((id) => {
      const revision = memoryRevisionsOf(repo, "fixture", noticeIdOf(id))[0];
      return expect.objectContaining({
        fixtureId: id,
        noticeId: noticeIdOf(id),
        bidId: revision?.bidId,
        revisionId: revision?.revisionId,
        checksum: revision?.checksum,
      });
    });
    expect(result.bids).toEqual(stored);
  });

  it("bids 의 checksum 은 소문자 16진 64자리다", async () => {
    const { result } = await seed();
    expect(result.bids.every((bid) => /^[0-9a-f]{64}$/.test(bid.checksum))).toBe(true);
  });
});

describe("seedFixtureBids — 격리·요약·상태", () => {
  it("quarantined 는 FX-12 1건(MISSING_REQUIRED_FIELD)이다", async () => {
    const { result } = await seed();
    expect(result.quarantined).toEqual([
      {
        fixtureId: "FX-12",
        sourceKey: "fixture:DEMO-2026-0012",
        errorCode: "MISSING_REQUIRED_FIELD",
      },
    ]);
  });

  it("summary 는 07 §6.4 SEED 기대값이다", async () => {
    const { result } = await seed();
    expect(result.summary).toEqual(SEED_SUMMARY);
  });

  it("status 는 FX-12 격리 때문에 PARTIAL 이다", async () => {
    const { result } = await seed();
    expect(result.status).toBe("PARTIAL");
  });
});

describe("seedFixtureBids — ingest run", () => {
  it("ingestRunId 는 저장소에 남은 그 run 의 id 다", async () => {
    const { repo, result } = await seed();
    expect(result.ingestRunId).toBe(repo.state.runs.get(DEFAULT_JOB_KEY)?.runId);
  });

  it("jobKey 를 주지 않으면 fixture:SEED:demo-reset 으로 run 을 연다", async () => {
    const { repo } = await seed();
    expect([...repo.state.runs.keys()]).toEqual([DEFAULT_JOB_KEY]);
  });

  it("jobKey 를 주면 그 jobKey 로 run 을 연다", async () => {
    const { repo, result } = await seed({ jobKey: "demo-reset:test" });
    expect(repo.state.runs.get("demo-reset:test")?.runId).toBe(result.ingestRunId);
  });

  it("run 은 source fixture·받은 runMode·trigger DEMO·batch SEED 다", async () => {
    const { repo } = await seed();
    expect(repo.state.runs.get(DEFAULT_JOB_KEY)?.input).toMatchObject({
      source: "fixture",
      runMode: "FIXTURE",
      jobKey: DEFAULT_JOB_KEY,
      trigger: "DEMO",
      batch: "SEED",
    });
  });

  it("run.params.fixtures 는 manifest SEED 순서의 FX-id 20개다", async () => {
    const { repo } = await seed();
    expect(repo.state.runs.get(DEFAULT_JOB_KEY)?.input.params?.fixtures).toEqual(SEED_IDS);
  });

  it("run.params.anchor 는 받은 anchor 의 ISO 문자열이다", async () => {
    const { repo } = await seed();
    expect(repo.state.runs.get(DEFAULT_JOB_KEY)?.input.params?.anchor).toBe(ANCHOR.toISOString());
  });

  it("받은 anchor 로 상대 날짜를 푼다(FX-01 -5d → KST 10-14 18:00)", async () => {
    const { repo } = await seed();
    expect(memoryRevisionsOf(repo, "fixture", "DEMO-2026-0001")[0]?.normalized.noticeDate).toBe(
      "2026-10-14T09:00:00.000Z",
    );
  });
});

describe("seedFixtureBids — idFor", () => {
  const uuidOf = (text: string): string => {
    const hex = createHash("sha256").update(text).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const idFor: IdFor = (kind, keys) =>
    uuidOf(
      kind === "bid"
        ? `bid|${keys.source}|${keys.noticeId}`
        : `revision|${keys.source}|${keys.noticeId}|${keys.revision}`,
    );

  it("idFor 를 주면 bids 의 bidId·revisionId 가 idFor 가 만든 값이다", async () => {
    const { result } = await seed({ idFor });
    expect(result.bids.map(({ bidId, revisionId }) => ({ bidId, revisionId }))).toEqual(
      result.bids.map(({ noticeId }) => ({
        bidId: idFor("bid", { source: "fixture", noticeId }),
        revisionId: idFor("revision", { source: "fixture", noticeId, revision: 1 }),
      })),
    );
  });

  it("같은 anchor·idFor 로 새 저장소에 두 번 돌리면 bids 가 같다(demo-reset 재실행)", async () => {
    const first = await seed({ idFor });
    const second = await seed({ idFor });
    expect(second.result.bids).toEqual(first.result.bids);
  });
});

describe("seedFixtureBids — 기본 retry", () => {
  it("retry 를 주지 않아도 FX-20 의 429 두 번을 넘기고 끝난다(summary.retried 2)", async () => {
    const { result } = await seed({ withRetry: false });
    expect(result.summary).toEqual(SEED_SUMMARY);
    expect(result.bids.map((bid) => bid.fixtureId)).toContain("FX-20");
  });

  it("기본 retry 는 Retry-After(2초)만큼 실제로 기다리지 않는다(1초 이상 타이머를 걸지 않는다)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    await seed({ withRetry: false });
    const longDelays = setTimeoutSpy.mock.calls
      .map(([, delay]) => delay ?? 0)
      .filter((delay) => delay >= 1000);
    expect(longDelays).toEqual([]);
  });
});
