import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  BidSourceConnector,
  ConnectorFailure,
  FetchPageInput,
  FetchPageOutcome,
  G2bItem,
} from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureBatch, FixtureManifest } from "./fixture.model";
import type { IngestSummary, StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { FIXTURE_ANCHOR_PARAM, runIngest, SEED_ANCHOR_MISSING } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// C3 계약 Stage 5-B: fixture 날짜 기준(anchor)을 SEED run 의 params.anchor 에 보관하고, LIVE 는 따로 받지 않으면
// 가장 최근 SEED run(SUCCEEDED·PARTIAL)의 anchor 를 쓴다(07 §6.4: SEED·LIVE 가 같은 anchor 여야 FX-09 가 중복).
// 저장은 메모리 저장소, 시각·대기·난수는 주입한다. 네트워크는 부르지 않는다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z"); // KST 2026-10-19 12:00
const OTHER_ANCHOR = new Date("2026-10-25T03:00:00.000Z"); // KST 2026-10-25 12:00
// now() 는 anchor 와 KST 날짜가 다르게 둔다. 그래야 anchor 대신 now() 를 쓰면 날짜가 달라져 드러난다.
const SEED_NOW = new Date("2026-10-19T16:00:00.000Z"); // KST 2026-10-20 01:00
const LIVE_NOW = new Date("2026-10-21T09:00:00.000Z"); // KST 2026-10-21 18:00
const LATER_NOW = new Date("2026-10-23T09:00:00.000Z"); // KST 2026-10-23 18:00

const ZERO: IngestSummary = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};
// 07 §6.4 LIVE 기대값(SEED 와 같은 anchor)
const LIVE_SUMMARY: IngestSummary = { ...ZERO, changed: 3, cancelled: 1, skippedDuplicate: 1 };
const MISSING_DETAIL = "SEED run 이 없어 LIVE 배치의 날짜 기준이 없다";

const FX01 = "DEMO-2026-0001";
const FX05 = "DEMO-2026-0005";
const FX06 = "DEMO-2026-0006";
const FX09 = "DEMO-2026-0009";

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const retry = (): RetryDeps => ({ sleep: async () => undefined, random: () => 0 });

const fixtureRun = (
  jobKey: string,
  batch: FixtureBatch,
  params: Record<string, unknown> | null = null,
): StartRunInput => ({
  source: "fixture",
  runMode: "FIXTURE",
  jobKey,
  trigger: "DEMO",
  batch,
  params,
});

const fixtureConnector = (batch: FixtureBatch) =>
  createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch, manifest });

type IngestOptions = {
  anchor?: Date;
  now?: Date;
  connector?: BidSourceConnector;
  params?: Record<string, unknown> | null;
};

// anchor 를 주지 않을 때는 키 자체를 넣지 않는다(계약: RunIngestInput.anchor 는 선택).
const ingest = (
  repo: MemoryIngestionRepo,
  jobKey: string,
  batch: FixtureBatch,
  options: IngestOptions = {},
) =>
  runIngest({
    connector: options.connector ?? fixtureConnector(batch),
    repo,
    run: fixtureRun(jobKey, batch, options.params ?? null),
    ...(options.anchor === undefined ? {} : { anchor: options.anchor }),
    now: () => options.now ?? (batch === "SEED" ? SEED_NOW : LIVE_NOW),
    retry: retry(),
  });

// 받은 cursor 를 기록하는 connector 래퍼.
const spying = (inner: BidSourceConnector) => {
  const fetchPage = vi.fn((input: FetchPageInput) => inner.fetchPage(input));
  const connector: BidSourceConnector = { source: inner.source, fetchPage };
  return { connector, fetchPage };
};

// 정해 둔 cursor 에서 재시도할 수 없는 실패를 한 번 낸 뒤 원래 connector 로 넘긴다.
const failingOnceAt = (inner: BidSourceConnector, cursor: string | null): BidSourceConnector => {
  const state = { failed: false };
  return {
    source: inner.source,
    fetchPage: async (input) => {
      if (!state.failed && input.cursor === cursor) {
        state.failed = true;
        return {
          ok: false,
          failure: { kind: "RESULT_CODE", resultCode: "99", detail: "fixture 중단 흉내" },
        };
      }
      return inner.fetchPage(input);
    },
  };
};

const constant = (outcome: FetchPageOutcome, source: "fixture" | "g2b" = "fixture") => {
  const fetchPage = vi.fn(async () => outcome);
  const connector: BidSourceConnector = { source, fetchPage };
  return { connector, fetchPage };
};

const EMPTY_PAGE: FetchPageOutcome = {
  ok: true,
  page: { records: [], nextCursor: null, rateLimitInfo: null },
};
const ALWAYS_FAIL: ConnectorFailure = {
  kind: "RESULT_CODE",
  resultCode: "99",
  detail: "실패 흉내",
};

const storedParams = (repo: MemoryIngestionRepo, jobKey: string) =>
  repo.state.runs.get(jobKey)?.input.params;

const latestNormalized = (repo: MemoryIngestionRepo, noticeId: string) =>
  memoryRevisionsOf(repo, "fixture", noticeId).at(-1)?.normalized;

// 실제 SEED 를 돌린 저장소. 기본은 anchor ANCHOR(FX-12 격리로 PARTIAL).
const seeded = async (options: IngestOptions = { anchor: ANCHOR }) => {
  const repo = createMemoryIngestionRepo();
  const seed = await ingest(repo, "seed-1", "SEED", options);
  return { repo, seed };
};

describe("상수 (C3 계약 5-B)", () => {
  it("anchor 를 담는 params 키는 anchor 다", () => {
    expect(FIXTURE_ANCHOR_PARAM).toBe("anchor");
  });

  it("SEED 가 없을 때의 오류 코드는 SEED_ANCHOR_MISSING 이다", () => {
    expect(SEED_ANCHOR_MISSING).toBe("SEED_ANCHOR_MISSING");
  });
});

// 5-F: b3 가 bid_revisions.raw_payload->>'fixtureId' 로 mock 추출 파일을 고른다. normalized·checksum 에는 넣지 않는다.
describe("SEED — rawPayload 의 fixtureId (C3 계약 5-F)", () => {
  const SEED_SAVED_IDS = Array.from(
    { length: 20 },
    (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
  ).filter((id) => id !== "FX-12");

  it("SEED 뒤 저장소의 revision rawPayload.fixtureId 는 FX-12 를 뺀 FX-id 19개를 manifest 순서로 담는다", async () => {
    const { repo } = await seeded();
    expect(repo.state.revisions.map((revision) => revision.rawPayload.fixtureId)).toEqual(
      SEED_SAVED_IDS,
    );
  });

  it("rawPayload.fixtureId 는 그 revision 의 공고와 맞다(FX-01 → DEMO-2026-0001)", async () => {
    const { repo } = await seeded();
    expect(memoryRevisionsOf(repo, "fixture", FX01)[0]?.rawPayload.fixtureId).toBe("FX-01");
  });

  it("normalized 에는 fixtureId 키가 없다", async () => {
    const { repo } = await seeded();
    expect(repo.state.revisions.some((revision) => "fixtureId" in revision.normalized)).toBe(false);
  });
});

describe("SEED — anchor 를 run params 에 ISO 로 보관", () => {
  it("SEED 에 anchor 를 주면 params.anchor 에 그 ISO 문자열을 저장한다", async () => {
    const { repo } = await seeded();
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: ANCHOR.toISOString() });
  });

  it("SEED 에 anchor 를 주지 않으면 now() 를 params.anchor 로 저장한다", async () => {
    const { repo } = await seeded({});
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: SEED_NOW.toISOString() });
  });

  it("anchor 없는 SEED 는 now() 를 날짜 기준으로 쓴다(FX-01 -5d → KST 10-15 18:00)", async () => {
    const { repo } = await seeded({});
    expect(latestNormalized(repo, FX01)?.noticeDate).toBe("2026-10-15T09:00:00.000Z");
  });

  it("anchor 를 준 SEED 는 그 anchor 를 날짜 기준으로 쓴다(FX-01 -5d → KST 10-14 18:00)", async () => {
    const { repo } = await seeded();
    expect(latestNormalized(repo, FX01)?.noticeDate).toBe("2026-10-14T09:00:00.000Z");
  });

  it("run.params.anchor 가 ISO 면 그 값을 쓰고 그대로 저장한다", async () => {
    const { repo } = await seeded({ params: { anchor: OTHER_ANCHOR.toISOString() } });
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: OTHER_ANCHOR.toISOString() });
    expect(latestNormalized(repo, FX01)?.noticeDate).toBe("2026-10-20T09:00:00.000Z");
  });

  it("input.anchor 가 run.params.anchor 보다 먼저다", async () => {
    const { repo } = await seeded({
      anchor: ANCHOR,
      params: { anchor: OTHER_ANCHOR.toISOString() },
    });
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: ANCHOR.toISOString() });
  });

  it("run.params.anchor 가 ISO 가 아니면 무시하고 now() 를 저장한다", async () => {
    const { repo } = await seeded({ params: { anchor: "어제" } });
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: SEED_NOW.toISOString() });
  });

  it("다른 params 는 그대로 두고 anchor 만 더한다", async () => {
    const { repo } = await seeded({ anchor: ANCHOR, params: { note: "demo-reset" } });
    expect(storedParams(repo, "seed-1")).toEqual({
      note: "demo-reset",
      anchor: ANCHOR.toISOString(),
    });
  });
});

describe("LIVE — anchor 를 따로 받지 않으면 가장 최근 SEED 의 anchor", () => {
  const seedThenLive = async (seedOptions: IngestOptions = { anchor: ANCHOR }) => {
    const { repo, seed } = await seeded(seedOptions);
    const live = await ingest(repo, "live-1", "LIVE");
    return { repo, seed, live };
  };

  it("PARTIAL SEED 뒤 anchor 없는 LIVE 는 07 §6.4 LIVE summary 를 낸다", async () => {
    const { seed, live } = await seedThenLive();
    expect(seed.status).toBe("PARTIAL");
    expect(live.summary).toEqual(LIVE_SUMMARY);
  });

  it("anchor 없는 LIVE 에서 FX-09 는 DUPLICATE 라 revision 1 그대로다", async () => {
    const { repo } = await seedThenLive();
    expect(memoryRevisionsOf(repo, "fixture", FX09).map((revision) => revision.revision)).toEqual([
      1,
    ]);
  });

  it("anchor 없는 LIVE 에서 FX-06 은 CHANGED 로 revision 2 가 된다", async () => {
    const { repo, live } = await seedThenLive();
    expect(live.saved.find((saved) => saved.noticeId === FX06)?.kind).toBe("CHANGED");
    expect(memoryRevisionsOf(repo, "fixture", FX06).map((revision) => revision.revision)).toEqual([
      1, 2,
    ]);
  });

  it("anchor 없는 LIVE 는 쓴 SEED anchor 를 자기 params.anchor 에 남긴다", async () => {
    const { repo } = await seedThenLive();
    expect(storedParams(repo, "live-1")).toEqual({ anchor: ANCHOR.toISOString() });
  });

  it("anchor 없이 돌린 SEED(now 가 anchor) 뒤 anchor 없는 LIVE 도 07 §6.4 LIVE summary 다", async () => {
    const { live } = await seedThenLive({});
    expect(live.summary).toEqual(LIVE_SUMMARY);
  });

  it("SEED 가 여럿이면 가장 최근에 시작한 SEED(SUCCEEDED)의 anchor 를 쓴다", async () => {
    const { repo } = await seeded();
    const empty = constant(EMPTY_PAGE);
    const second = await ingest(repo, "seed-2", "SEED", {
      anchor: OTHER_ANCHOR,
      connector: empty.connector,
    });
    await ingest(repo, "live-1", "LIVE");
    expect(second.status).toBe("SUCCEEDED");
    expect(storedParams(repo, "live-1")).toEqual({ anchor: OTHER_ANCHOR.toISOString() });
  });

  it("FAILED 로 끝난 SEED 의 anchor 는 쓰지 않는다", async () => {
    const { repo } = await seeded();
    const failing = constant({ ok: false, failure: ALWAYS_FAIL });
    const failedSeed = await ingest(repo, "seed-2", "SEED", {
      anchor: OTHER_ANCHOR,
      connector: failing.connector,
    });
    const live = await ingest(repo, "live-1", "LIVE");
    expect(failedSeed.status).toBe("FAILED");
    expect(storedParams(repo, "live-1")).toEqual({ anchor: ANCHOR.toISOString() });
    expect(live.summary).toEqual(LIVE_SUMMARY);
  });

  it("끝나지 않은(RUNNING) SEED 의 anchor 는 쓰지 않는다", async () => {
    const { repo } = await seeded();
    await repo.startRun(fixtureRun("seed-running", "SEED", { anchor: OTHER_ANCHOR.toISOString() }));
    await ingest(repo, "live-1", "LIVE");
    expect(storedParams(repo, "live-1")).toEqual({ anchor: ANCHOR.toISOString() });
  });
});

describe("LIVE — SEED 가 없으면 실패한다(seed 먼저)", () => {
  const liveWithoutSeed = async () => {
    const repo = createMemoryIngestionRepo();
    const { connector, fetchPage } = spying(fixtureConnector("LIVE"));
    const result = await ingest(repo, "live-1", "LIVE", { connector });
    return { repo, result, fetchPage };
  };

  it("SEED run 이 없으면 anchor 없는 LIVE 는 FAILED 이고 아무것도 저장하지 않는다", async () => {
    const { repo, result } = await liveWithoutSeed();
    expect(result).toMatchObject({
      status: "FAILED",
      alreadyFinished: false,
      saved: [],
      resumedFromCursor: null,
      summary: ZERO,
    });
    expect(repo.state.revisions).toEqual([]);
  });

  it("SEED_ANCHOR_MISSING 을 sourceKey fixture:anchor 로 정확히 1건 기록한다", async () => {
    const { repo, result } = await liveWithoutSeed();
    expect(repo.state.errors).toEqual([
      {
        runId: result.runId,
        sourceKey: "fixture:anchor",
        errorCode: "SEED_ANCHOR_MISSING",
        resultCode: null,
        redactedDetail: MISSING_DETAIL,
      },
    ]);
  });

  it("connector 를 한 번도 부르지 않는다", async () => {
    const { fetchPage } = await liveWithoutSeed();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("run 을 FAILED 로 한 번 끝낸다", async () => {
    const { repo, result } = await liveWithoutSeed();
    expect(repo.state.finishes).toEqual([{ runId: result.runId, status: "FAILED", summary: ZERO }]);
  });

  it("정할 anchor 가 없으니 params 에 anchor 를 넣지 않는다", async () => {
    const { repo } = await liveWithoutSeed();
    expect(storedParams(repo, "live-1")).toBeNull();
  });

  it("그 뒤 SEED 를 돌리고 같은 LIVE jobKey 를 다시 돌리면 이어서 07 §6.4 LIVE summary 로 성공한다", async () => {
    const { repo, result: failed } = await liveWithoutSeed();
    await ingest(repo, "seed-1", "SEED", { anchor: ANCHOR });
    const resumed = await ingest(repo, "live-1", "LIVE");
    expect(resumed).toMatchObject({
      runId: failed.runId,
      alreadyFinished: false,
      status: "SUCCEEDED",
      summary: LIVE_SUMMARY,
    });
  });
});

describe("이어 가는 run — 처음 정한 params.anchor 를 쓴다", () => {
  // SEED(ANCHOR) → LIVE 가 FX-08 페이지(cursor 2)에서 멈춤 → 다른 SEED(OTHER_ANCHOR, 빈 페이지라 SUCCEEDED) → LIVE 재실행
  const interruptedLive = async () => {
    const { repo } = await seeded();
    const live = failingOnceAt(fixtureConnector("LIVE"), "2");
    const failed = await ingest(repo, "live-1", "LIVE", { connector: live });
    await ingest(repo, "seed-2", "SEED", {
      anchor: OTHER_ANCHOR,
      connector: constant(EMPTY_PAGE).connector,
    });
    return { repo, live, failed };
  };

  it("멈춘 LIVE 는 FAILED 이고 그때 쓴 SEED anchor 를 params 에 남긴다", async () => {
    const { repo, failed } = await interruptedLive();
    expect(failed.status).toBe("FAILED");
    expect(storedParams(repo, "live-1")).toEqual({ anchor: ANCHOR.toISOString() });
  });

  it("그사이 다른 SEED 가 있어도 이어 가는 LIVE 는 처음 anchor 로 끝까지 가 07 §6.4 LIVE summary 를 낸다", async () => {
    const { repo, live } = await interruptedLive();
    const resumed = await ingest(repo, "live-1", "LIVE", { connector: live });
    expect(resumed.resumedFromCursor).toBe("2");
    expect(resumed.summary).toEqual(LIVE_SUMMARY);
  });

  it("이어 가는 LIVE 에서도 FX-09 는 중복이라 revision 1 그대로다", async () => {
    const { repo, live } = await interruptedLive();
    await ingest(repo, "live-1", "LIVE", { connector: live });
    expect(memoryRevisionsOf(repo, "fixture", FX09).map((revision) => revision.revision)).toEqual([
      1,
    ]);
  });

  it("이어 가는 run 은 input.anchor 를 새로 줘도 처음 정한 anchor 를 쓴다", async () => {
    const { repo, live } = await interruptedLive();
    const resumed = await ingest(repo, "live-1", "LIVE", { connector: live, anchor: OTHER_ANCHOR });
    expect(resumed.summary).toEqual(LIVE_SUMMARY);
  });

  it("이어 가는 SEED 는 처음 실행의 now() anchor 를 쓴다(FX-05 -6d → KST 10-14 18:00)", async () => {
    const repo = createMemoryIngestionRepo();
    const seed = failingOnceAt(fixtureConnector("SEED"), "3");
    await ingest(repo, "seed-1", "SEED", { connector: seed, now: SEED_NOW });
    await ingest(repo, "seed-1", "SEED", { connector: seed, now: LATER_NOW });
    expect(storedParams(repo, "seed-1")).toEqual({ anchor: SEED_NOW.toISOString() });
    expect(latestNormalized(repo, FX05)?.noticeDate).toBe("2026-10-14T09:00:00.000Z");
  });
});

describe("LIVE — anchor 를 직접 주면 그 값", () => {
  it("LIVE 에 anchor 를 직접 주면 SEED anchor 대신 그 값을 쓰고 저장한다", async () => {
    const { repo } = await seeded();
    const live = await ingest(repo, "live-1", "LIVE", { anchor: OTHER_ANCHOR });
    expect(storedParams(repo, "live-1")).toEqual({ anchor: OTHER_ANCHOR.toISOString() });
    // anchor 가 달라 FX-09 도 날짜가 바뀌어 변경으로 잡힌다
    expect(live.summary).toEqual({ ...ZERO, changed: 4, cancelled: 1 });
  });

  it("LIVE 에 anchor 를 직접 주면 SEED 가 없어도 실패하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const live = await ingest(repo, "live-1", "LIVE", { anchor: ANCHOR });
    expect(live.status).toBe("SUCCEEDED");
    expect(live.summary).toEqual({ ...ZERO, created: 5 });
    expect(repo.state.errors.map((error) => error.errorCode)).not.toContain(SEED_ANCHOR_MISSING);
  });

  it("LIVE 의 run.params.anchor(ISO)도 직접 준 anchor 로 친다", async () => {
    const repo = createMemoryIngestionRepo();
    const live = await ingest(repo, "live-1", "LIVE", {
      params: { anchor: ANCHOR.toISOString() },
    });
    expect(live.status).toBe("SUCCEEDED");
  });
});

describe("g2b run — anchor 를 쓰지 않는다", () => {
  const WINDOW = { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" };
  const g2bRun = (jobKey: string): StartRunInput => ({
    source: "g2b",
    runMode: "LIVE",
    jobKey,
    trigger: "MANUAL",
    batch: null,
    params: { window: WINDOW },
  });
  // 가상 값. 2026-10-19 실측 응답의 필드 이름만 본떴다.
  const G2B_ITEM: G2bItem = {
    bidNtceNo: "R26BK00000099",
    bidNtceOrd: "000",
    ntceKindNm: "등록공고",
    bidNtceDt: "2026-10-19 09:10:00",
    bidNtceNm: "가상 정보시스템 유지관리 용역",
    ntceInsttNm: "가상공고기관",
    dminsttNm: "가상수요기관",
    bidClseDt: "2026-11-23 12:00:00",
    asignBdgtAmt: "1264200000",
    bidNtceDtlUrl:
      "https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK00000099&bidPbancOrd=000",
    infoBizYn: "Y",
  };

  const ingestG2b = (
    repo: MemoryIngestionRepo,
    connector: BidSourceConnector,
    options: { anchor?: Date } = {},
  ) =>
    runIngest({
      connector,
      repo,
      run: g2bRun("g2b-1"),
      ...(options.anchor === undefined ? {} : { anchor: options.anchor }),
      now: () => LIVE_NOW,
      retry: retry(),
    });

  it("g2b run 은 anchor 를 줘도 params 에 anchor 를 넣지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingestG2b(repo, constant(EMPTY_PAGE, "g2b").connector, { anchor: ANCHOR });
    expect(storedParams(repo, "g2b-1")).toEqual({ window: WINDOW });
  });

  it("g2b run 은 SEED 가 없어도 anchor 때문에 실패하지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const result = await ingestG2b(repo, constant(EMPTY_PAGE, "g2b").connector);
    expect(result.status).toBe("SUCCEEDED");
    expect(repo.state.errors).toEqual([]);
  });

  it("g2b saved 의 fixtureId 는 null 이다(C3 계약 5-D)", async () => {
    const repo = createMemoryIngestionRepo();
    const page: FetchPageOutcome = {
      ok: true,
      page: {
        records: [{ kind: "g2b-bid-notice", item: G2B_ITEM }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    };
    const result = await ingestG2b(repo, constant(page, "g2b").connector);
    expect(result.saved.map((saved) => saved.fixtureId)).toEqual([null]);
  });

  it("g2b revision 의 rawPayload 는 item 그대로이고 fixtureId 를 더하지 않는다(C3 계약 5-F)", async () => {
    const repo = createMemoryIngestionRepo();
    const page: FetchPageOutcome = {
      ok: true,
      page: {
        records: [{ kind: "g2b-bid-notice", item: G2B_ITEM }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    };
    await ingestG2b(repo, constant(page, "g2b").connector);
    expect(repo.state.revisions.map((revision) => revision.rawPayload)).toEqual([G2B_ITEM]);
  });

  it("g2b saved 의 checksum 은 저장소에 남은 revision 의 checksum 이다(C3 계약 5-D)", async () => {
    const repo = createMemoryIngestionRepo();
    const page: FetchPageOutcome = {
      ok: true,
      page: {
        records: [{ kind: "g2b-bid-notice", item: G2B_ITEM }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    };
    const result = await ingestG2b(repo, constant(page, "g2b").connector);
    expect(result.saved.map((saved) => saved.checksum)).toEqual(
      repo.state.revisions.map((revision) => revision.checksum),
    );
    expect(result.saved[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
