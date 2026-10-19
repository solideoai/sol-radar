import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { BidSourceConnector, FetchPageOutcome, G2bItem } from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureBatch, FixtureFile, FixtureManifest, FixtureRecord } from "./fixture.model";
import type { StartRunInput } from "./ingestion.repo";
import { createMemoryIngestionRepo, type MemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// C3 계약 6-5: IngestRunResult.quarantined = 이번 실행에서 격리한 레코드의 { sourceKey, errorCode, fixtureId }.
// demo:reset 이 seed 로그·결과에 그대로 싣는다. 경고(적재는 함)·connector 실패·anchor 없음은 레코드 격리가 아니다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const NOW = new Date("2026-10-19T09:00:00.000Z");
const FX12_QUARANTINE = {
  sourceKey: "fixture:DEMO-2026-0012",
  errorCode: "MISSING_REQUIRED_FIELD",
  fixtureId: "FX-12",
};

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const retry = (): RetryDeps => ({ sleep: async () => undefined, random: () => 0 });

const fixtureRun = (jobKey: string, batch: FixtureBatch): StartRunInput => ({
  source: "fixture",
  runMode: "FIXTURE",
  jobKey,
  trigger: "DEMO",
  batch,
  params: null,
});

const fixtureConnector = (batch: FixtureBatch) =>
  createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch, manifest });

const ingest = (
  repo: MemoryIngestionRepo,
  jobKey: string,
  batch: FixtureBatch,
  options: { connector?: BidSourceConnector; anchor?: Date | null } = {},
) =>
  runIngest({
    connector: options.connector ?? fixtureConnector(batch),
    repo,
    run: fixtureRun(jobKey, batch),
    ...(options.anchor === null ? {} : { anchor: options.anchor ?? ANCHOR }),
    now: () => NOW,
    retry: retry(),
  });

const onePage = (connectorSource: "fixture" | "g2b", records: FetchPageOutcome) => {
  const connector: BidSourceConnector = { source: connectorSource, fetchPage: async () => records };
  return connector;
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

const readRecord = async (id: string, batch: FixtureBatch): Promise<FixtureRecord> => {
  const file: FixtureFile = JSON.parse(
    await readFile(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8"),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};

describe("IngestRunResult.quarantined — fixture", () => {
  it("SEED 는 FX-12 격리 1건(sourceKey·errorCode·fixtureId)을 돌려준다", async () => {
    const result = await ingest(createMemoryIngestionRepo(), "seed-1", "SEED");
    expect(result.quarantined).toEqual([FX12_QUARANTINE]);
  });

  it("quarantined 수는 summary.quarantined 와 같다(새 run)", async () => {
    const result = await ingest(createMemoryIngestionRepo(), "seed-1", "SEED");
    expect(result.quarantined).toHaveLength(result.summary.quarantined);
  });

  it("SEED 뒤 LIVE 는 격리가 없어 빈 배열이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingest(repo, "seed-1", "SEED");
    const live = await ingest(repo, "live-1", "LIVE");
    expect(live.quarantined).toEqual([]);
  });

  it("경고(BUDGET_UNPARSED)는 오류로 기록되지만 quarantined 에는 들어가지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const record: FixtureRecord = {
      ...(await readRecord("FX-01", "SEED")),
      noticeId: "DEMO-TEST-0001",
      budgetKrw: "미정",
    };
    const connector = onePage("fixture", {
      ok: true,
      page: {
        records: [{ kind: "fixture", fixtureId: "FX-01", record }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    });
    const result = await ingest(repo, "warn-1", "SEED", { connector });
    expect(repo.state.errors.map((error) => error.errorCode)).toEqual(["BUDGET_UNPARSED"]);
    expect(result.quarantined).toEqual([]);
  });

  it("이어 가는 실행은 이번 실행에서 격리한 것만 담는다(앞 실행의 FX-12 는 빠진다)", async () => {
    const repo = createMemoryIngestionRepo();
    // FX-12(cursor 11)를 처리한 뒤 FX-14 페이지(cursor 13)에서 멈춘다
    const connector = failingOnceAt(fixtureConnector("SEED"), "13");
    const first = await ingest(repo, "seed-1", "SEED", { connector });
    const resumed = await ingest(repo, "seed-1", "SEED", { connector });
    expect(first.quarantined).toEqual([FX12_QUARANTINE]);
    expect(resumed.quarantined).toEqual([]);
    expect(resumed.summary.quarantined).toBe(1);
  });

  it("connector 실패(페이지 오류)는 레코드 격리가 아니라 quarantined 에 들어가지 않는다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingOnceAt(fixtureConnector("SEED"), null);
    const result = await ingest(repo, "seed-1", "SEED", { connector });
    expect(result.status).toBe("FAILED");
    expect(result.quarantined).toEqual([]);
  });

  it("SEED 없이 LIVE 를 돌려 난 SEED_ANCHOR_MISSING 도 quarantined 에 들어가지 않는다", async () => {
    const result = await ingest(createMemoryIngestionRepo(), "live-1", "LIVE", { anchor: null });
    expect(result.status).toBe("FAILED");
    expect(result.quarantined).toEqual([]);
  });
});

describe("IngestRunResult.quarantined — g2b", () => {
  const NOTICE_NO = "R26BK00000055";
  // 가상 값. 2026-10-19 실측 응답의 필드 이름만 본떴다.
  const g2bItem = (overrides: G2bItem = {}): G2bItem => ({
    bidNtceNo: NOTICE_NO,
    bidNtceOrd: "000",
    ntceKindNm: "등록공고",
    bidNtceDt: "2026-10-19 09:10:00",
    bidNtceNm: "가상 정보시스템 유지관리 용역",
    ntceInsttNm: "가상공고기관",
    dminsttNm: "가상수요기관",
    bidClseDt: "2026-11-23 12:00:00",
    asignBdgtAmt: "500000000",
    bidNtceDtlUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
    infoBizYn: "Y",
    ...overrides,
  });
  const ingestG2b = (items: G2bItem[]) =>
    runIngest({
      connector: onePage("g2b", {
        ok: true,
        page: {
          records: items.map((item) => ({ kind: "g2b-bid-notice", item })),
          nextCursor: null,
          rateLimitInfo: null,
        },
      }),
      repo: createMemoryIngestionRepo(),
      run: {
        source: "g2b",
        runMode: "LIVE",
        jobKey: "g2b-1",
        trigger: "MANUAL",
        batch: null,
        params: { window: { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" } },
      },
      now: () => NOW,
      retry: retry(),
    });

  it("g2b 격리 행(공고명 없음)의 fixtureId 는 null 이다", async () => {
    const result = await ingestG2b([g2bItem({ bidNtceNm: "" })]);
    expect(result.quarantined).toEqual([
      {
        sourceKey: `g2b-bid-notice:${NOTICE_NO}`,
        errorCode: "MISSING_REQUIRED_FIELD",
        fixtureId: null,
      },
    ]);
  });

  it("g2b SCHEMA_INVALID 격리(모르는 공고 종류)도 담고 정상 행은 담지 않는다", async () => {
    const result = await ingestG2b([
      g2bItem(),
      g2bItem({ bidNtceNo: "R26BK00000056", ntceKindNm: "알수없는공고" }),
    ]);
    expect(result.quarantined).toEqual([
      { sourceKey: "g2b-bid-notice:R26BK00000056", errorCode: "SCHEMA_INVALID", fixtureId: null },
    ]);
    expect(result.saved).toHaveLength(1);
  });
});
