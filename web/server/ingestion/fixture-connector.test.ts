import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BidSourceConnector,
  FetchedPage,
  FetchPageOutcome,
  SourceRecord,
} from "./connector.model";
import {
  createFixtureConnector,
  FIXTURE_RATE_LIMIT_FAILURES,
  FIXTURE_RETRY_AFTER_SEC,
  loadFixtureManifest,
} from "./fixture-connector";
import type { FixtureBatch, FixtureFile, FixtureManifest } from "./fixture.model";

// FixtureConnector 계약(07 §2·§6.1·§6.4·§7, C3 계약 Stage 2). 저장소의 fixtures/ 는 읽기만 한다.
// 깨진 manifest·fixture 는 os.tmpdir 아래 임시 폴더에 만들고 시험마다 지운다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

const SEED_IDS = Array.from(
  { length: 20 },
  (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
);
const LIVE_IDS = ["FX-06", "FX-07", "FX-08", "FX-09", "FX-10"];

const readFixtureFile = async (dir: string, id: string): Promise<FixtureFile> =>
  JSON.parse(await readFile(join(dir, "bids", `${id}.json`), "utf8"));

const recordOf = async (id: string, batch: FixtureBatch) => {
  const file = await readFixtureFile(FIXTURES_DIR, id);
  return file.records.find((record) => record.ingestBatch === batch);
};

const pageOf = (outcome: FetchPageOutcome): FetchedPage => {
  if (!outcome.ok) throw new Error(`페이지 대신 실패를 받았다: ${outcome.failure.kind}`);
  return outcome.page;
};

// FixtureConnector 는 fixture 레코드만 준다. 다른 종류(g2b 등)가 섞이면 그 자리에서 실패시킨다.
const fixtureRecordsOf = (page: FetchedPage): Extract<SourceRecord, { kind: "fixture" }>[] =>
  page.records.map((record) => {
    if (record.kind !== "fixture") throw new Error(`fixture 레코드가 아니다: ${record.kind}`);
    return record;
  });

const first = { from: null, to: null, cursor: null };
const at = (cursor: string) => ({ from: null, to: null, cursor });

// nextCursor 를 끝까지 따라간다. RATE_LIMITED 는 같은 cursor 로 다시 부른다(재시도는 retry.ts 의 몫이라 여기선 대기 없이).
const walk = async (connector: BidSourceConnector) => {
  const pages: { cursor: string | null; page: FetchedPage }[] = [];
  const rateLimited: (string | null)[] = [];
  let cursor: string | null = null;
  for (let calls = 0; calls < 100; calls += 1) {
    const outcome = await connector.fetchPage({ from: null, to: null, cursor });
    if (!outcome.ok) {
      if (outcome.failure.kind !== "RATE_LIMITED") {
        throw new Error(`예상하지 못한 실패: ${outcome.failure.kind}`);
      }
      rateLimited.push(cursor);
      continue;
    }
    pages.push({ cursor, page: outcome.page });
    if (outcome.page.nextCursor === null) return { pages, rateLimited };
    cursor = outcome.page.nextCursor;
  }
  throw new Error("페이지가 100번 안에 끝나지 않았다");
};

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const seedConnector = () =>
  createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "SEED", manifest });
const liveConnector = () =>
  createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch: "LIVE", manifest });

describe("loadFixtureManifest — 저장소의 manifest", () => {
  it("schemaVersion 은 sol-fixtures/v1.0 이다", () => {
    expect(manifest.schemaVersion).toBe("sol-fixtures/v1.0");
  });

  it("SEED 배치는 FX-01~FX-20 을 그 순서로 담는다", () => {
    expect(manifest.batches.SEED).toEqual(SEED_IDS);
  });

  it("LIVE 배치는 FX-06·FX-07·FX-08·FX-09·FX-10 을 그 순서로 담는다", () => {
    expect(manifest.batches.LIVE).toEqual(LIVE_IDS);
  });

  it("fixtures 항목은 20개이고 FX-12 의 기대 결과는 QUARANTINED 이다", () => {
    expect(manifest.fixtures).toHaveLength(20);
    expect(manifest.fixtures.find((entry) => entry.id === "FX-12")?.expected.outcome).toBe(
      "QUARANTINED",
    );
  });
});

describe("loadFixtureManifest — 잘못된 manifest 는 던진다(07 §7: 조용히 건너뛰지 않는다)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sol-radar-manifest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const validManifest = [
    "schemaVersion: sol-fixtures/v1.0",
    'calculationDate: "2026-10-16"',
    "batches:",
    "  SEED: [FX-01]",
    "  LIVE: [FX-01]",
    "fixtures:",
    "  - id: FX-01",
    "    stage: NOTICE",
    "    tags: [normal]",
    "    expected: { outcome: BID, designScore: 94 }",
    "",
  ].join("\n");

  const writeManifest = (text: string) => writeFile(join(dir, "manifest.yaml"), text, "utf8");

  it("최소한의 올바른 manifest 는 읽힌다(대조군)", async () => {
    await writeManifest(validManifest);
    const loaded = await loadFixtureManifest(dir);
    expect(loaded.batches.SEED).toEqual(["FX-01"]);
  });

  it("manifest.yaml 이 없으면 던진다", async () => {
    await expect(loadFixtureManifest(dir)).rejects.toThrow();
  });

  it("YAML 문법이 깨졌으면 던진다", async () => {
    await writeManifest("schemaVersion: [sol-fixtures/v1.0\nbatches: {SEED: [FX-01]");
    await expect(loadFixtureManifest(dir)).rejects.toThrow();
  });

  it("schemaVersion 이 sol-fixtures/v1.0 이 아니면 던진다", async () => {
    await writeManifest(validManifest.replace("sol-fixtures/v1.0", "sol-fixtures/v0.9"));
    await expect(loadFixtureManifest(dir)).rejects.toThrow();
  });

  it("batches 가 없으면 던진다", async () => {
    await writeManifest(
      validManifest.replace(/batches:\n {2}SEED: \[FX-01\]\n {2}LIVE: \[FX-01\]\n/, ""),
    );
    await expect(loadFixtureManifest(dir)).rejects.toThrow();
  });

  it("designScore 가 숫자도 null 도 아니면 던진다", async () => {
    await writeManifest(validManifest.replace("designScore: 94", 'designScore: "94"'));
    await expect(loadFixtureManifest(dir)).rejects.toThrow();
  });
});

describe("createFixtureConnector — SEED 배치", () => {
  it("source 는 fixture 다", () => {
    expect(seedConnector().source).toBe("fixture");
  });

  it("cursor null 은 첫 fixture(FX-01)의 SEED 레코드를 nextCursor 1 과 함께 준다", async () => {
    const outcome = await seedConnector().fetchPage(first);
    expect(outcome).toEqual({
      ok: true,
      page: {
        records: [{ kind: "fixture", fixtureId: "FX-01", record: await recordOf("FX-01", "SEED") }],
        nextCursor: "1",
        rateLimitInfo: null,
      },
    });
  });

  it("cursor 는 manifest 순서의 index 다: cursor 5 는 FX-06 이다", async () => {
    const page = pageOf(await seedConnector().fetchPage(at("5")));
    expect(fixtureRecordsOf(page).map((record) => record.fixtureId)).toEqual(["FX-06"]);
    expect(page.nextCursor).toBe("6");
  });

  it("nextCursor 를 끝까지 따라가면 FX-01~FX-20 순서로 20페이지다", async () => {
    const { pages } = await walk(seedConnector());
    expect(
      pages.map(({ page }) => fixtureRecordsOf(page).map((record) => record.fixtureId)),
    ).toEqual(SEED_IDS.map((id) => [id]));
  });

  it("페이지를 부른 cursor 는 null, 1, 2, …, 19 다", async () => {
    const { pages } = await walk(seedConnector());
    expect(pages.map(({ cursor }) => cursor)).toEqual([
      null,
      ...Array.from({ length: 19 }, (_, index) => String(index + 1)),
    ]);
  });

  it("마지막 페이지(FX-20)의 nextCursor 는 null 이다", async () => {
    const connector = seedConnector();
    await connector.fetchPage(at("19"));
    await connector.fetchPage(at("19"));
    const page = pageOf(await connector.fetchPage(at("19")));
    expect(fixtureRecordsOf(page).map((record) => record.fixtureId)).toEqual(["FX-20"]);
    expect(page.nextCursor).toBeNull();
  });

  it("SEED 페이지는 SEED 레코드만 준다: FX-06 은 정정 전(01차) 1건이다", async () => {
    const page = pageOf(await seedConnector().fetchPage(at("5")));
    expect(fixtureRecordsOf(page).map((record) => record.record.amendmentNo)).toEqual(["01"]);
    expect(fixtureRecordsOf(page).map((record) => record.record.ingestBatch)).toEqual(["SEED"]);
  });

  it("duplicate-delivery 인 FX-09 도 SEED 에서는 SEED 레코드 1건만 준다", async () => {
    const page = pageOf(await seedConnector().fetchPage(at("8")));
    expect(page.records).toEqual([
      { kind: "fixture", fixtureId: "FX-09", record: await recordOf("FX-09", "SEED") },
    ]);
  });

  it("레코드 필드 검사는 하지 않는다: 제목이 없는 FX-12 도 페이지로 준다(격리는 정규화의 몫)", async () => {
    const page = pageOf(await seedConnector().fetchPage(at("11")));
    expect(page.records).toEqual([
      { kind: "fixture", fixtureId: "FX-12", record: await recordOf("FX-12", "SEED") },
    ]);
  });

  it("SEED 전체 레코드는 20건이고 모두 ingestBatch SEED 다", async () => {
    const { pages } = await walk(seedConnector());
    const batches = pages.flatMap(({ page }) =>
      fixtureRecordsOf(page).map((record) => record.record.ingestBatch),
    );
    expect(batches).toEqual(Array.from({ length: 20 }, () => "SEED"));
  });

  it("rateLimitInfo 는 모든 페이지에서 null 이다", async () => {
    const { pages } = await walk(seedConnector());
    expect(pages.every(({ page }) => page.rateLimitInfo === null)).toBe(true);
  });

  it("from·to 는 무시한다: 값을 줘도 cursor null 이면 FX-01 이다", async () => {
    const page = pageOf(
      await seedConnector().fetchPage({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-02T00:00:00.000Z",
        cursor: null,
      }),
    );
    expect(fixtureRecordsOf(page).map((record) => record.fixtureId)).toEqual(["FX-01"]);
  });
});

describe("createFixtureConnector — LIVE 배치", () => {
  it("nextCursor 를 끝까지 따라가면 FX-06~FX-10 순서로 5페이지다", async () => {
    const { pages } = await walk(liveConnector());
    expect(
      pages.map(({ page }) => fixtureRecordsOf(page).map((record) => record.fixtureId)),
    ).toEqual(LIVE_IDS.map((id) => [id]));
  });

  it("LIVE 페이지는 LIVE 레코드만 준다", async () => {
    const { pages } = await walk(liveConnector());
    const batches = pages.flatMap(({ page }) =>
      fixtureRecordsOf(page).map((record) => record.record.ingestBatch),
    );
    expect(batches).toEqual(["LIVE", "LIVE", "LIVE", "LIVE", "LIVE"]);
  });

  it("LIVE 의 cursor null 은 FX-06 의 정정(02차) 레코드다", async () => {
    const outcome = await liveConnector().fetchPage(first);
    expect(outcome).toEqual({
      ok: true,
      page: {
        records: [{ kind: "fixture", fixtureId: "FX-06", record: await recordOf("FX-06", "LIVE") }],
        nextCursor: "1",
        rateLimitInfo: null,
      },
    });
  });

  it("LIVE 의 마지막 cursor 4 는 FX-10 이고 nextCursor 는 null 이다", async () => {
    const page = pageOf(await liveConnector().fetchPage(at("4")));
    expect(fixtureRecordsOf(page).map((record) => record.fixtureId)).toEqual(["FX-10"]);
    expect(page.nextCursor).toBeNull();
  });

  it("LIVE 의 FX-09 는 재전송된 같은 payload(01차) 레코드다", async () => {
    const page = pageOf(await liveConnector().fetchPage(at("3")));
    expect(page.records).toEqual([
      { kind: "fixture", fixtureId: "FX-09", record: await recordOf("FX-09", "LIVE") },
    ]);
    expect(fixtureRecordsOf(page).map((record) => record.record.amendmentNo)).toEqual(["01"]);
  });

  it("LIVE 에는 429 를 흉내 내는 fixture 가 없어 한 번도 RATE_LIMITED 를 주지 않는다", async () => {
    const { rateLimited } = await walk(liveConnector());
    expect(rateLimited).toEqual([]);
  });
});

describe("createFixtureConnector — FX-20 rate-limit-then-ok (07 §6.1, G7)", () => {
  const RATE_LIMITED = {
    ok: false,
    failure: { kind: "RATE_LIMITED", status: 429, retryAfterSec: 2, detail: "fixture rate limit" },
  };

  it("상수: 처음 실패 횟수는 2, Retry-After 는 2초다", () => {
    expect(FIXTURE_RATE_LIMIT_FAILURES).toBe(2);
    expect(FIXTURE_RETRY_AFTER_SEC).toBe(2);
  });

  it("FX-20 페이지의 첫 호출은 429 RATE_LIMITED(retryAfterSec 2)다", async () => {
    await expect(seedConnector().fetchPage(at("19"))).resolves.toEqual(RATE_LIMITED);
  });

  it("FX-20 페이지의 두 번째 호출도 RATE_LIMITED 다", async () => {
    const connector = seedConnector();
    await connector.fetchPage(at("19"));
    await expect(connector.fetchPage(at("19"))).resolves.toEqual(RATE_LIMITED);
  });

  it("FX-20 페이지의 세 번째 호출은 FX-20 SEED 레코드를 준다", async () => {
    const connector = seedConnector();
    await connector.fetchPage(at("19"));
    await connector.fetchPage(at("19"));
    await expect(connector.fetchPage(at("19"))).resolves.toEqual({
      ok: true,
      page: {
        records: [{ kind: "fixture", fixtureId: "FX-20", record: await recordOf("FX-20", "SEED") }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    });
  });

  it("정상이 된 뒤에는 다시 RATE_LIMITED 를 주지 않는다", async () => {
    const connector = seedConnector();
    await connector.fetchPage(at("19"));
    await connector.fetchPage(at("19"));
    await connector.fetchPage(at("19"));
    const fourth = await connector.fetchPage(at("19"));
    expect(fourth.ok).toBe(true);
  });

  it("SEED 를 끝까지 따라가면 RATE_LIMITED 는 FX-20 cursor 19 에서만 정확히 2번 난다", async () => {
    const { rateLimited } = await walk(seedConnector());
    expect(rateLimited).toEqual(["19", "19"]);
  });

  it("429 횟수는 connector 인스턴스마다 따로 센다: 새 인스턴스는 다시 처음부터 2번 실패한다", async () => {
    const used = seedConnector();
    await used.fetchPage(at("19"));
    await used.fetchPage(at("19"));
    await used.fetchPage(at("19"));
    await expect(seedConnector().fetchPage(at("19"))).resolves.toEqual(RATE_LIMITED);
  });

  it("FX-20 의 429 는 다른 페이지 호출에 영향을 주지 않는다", async () => {
    const connector = seedConnector();
    await connector.fetchPage(at("19"));
    const other = await connector.fetchPage(at("18"));
    expect(fixtureRecordsOf(pageOf(other)).map((record) => record.fixtureId)).toEqual(["FX-19"]);
  });
});

describe("createFixtureConnector — 잘못된 cursor 는 FIXTURE_INVALID 로 돌려준다(던지지 않는다)", () => {
  it.each(["abc", "-1", "1.5", ""])("SEED 의 cursor %j 는 FIXTURE_INVALID 다", async (cursor) => {
    await expect(seedConnector().fetchPage(at(cursor))).resolves.toMatchObject({
      ok: false,
      failure: { kind: "FIXTURE_INVALID" },
    });
  });

  it("SEED 범위 밖 cursor 20 은 FIXTURE_INVALID 다", async () => {
    await expect(seedConnector().fetchPage(at("20"))).resolves.toMatchObject({
      ok: false,
      failure: { kind: "FIXTURE_INVALID" },
    });
  });

  it("LIVE 범위 밖 cursor 5 는 FIXTURE_INVALID 다", async () => {
    await expect(liveConnector().fetchPage(at("5"))).resolves.toMatchObject({
      ok: false,
      failure: { kind: "FIXTURE_INVALID" },
    });
  });
});

describe("createFixtureConnector — 깨진 fixture 파일은 FIXTURE_INVALID 로 돌려준다(던지지 않는다)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sol-radar-fixture-"));
    await mkdir(join(dir, "bids"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const oneFixtureManifest = (): FixtureManifest => {
    const entry: FixtureManifest["fixtures"][number] = {
      id: "FX-01",
      stage: "NOTICE",
      tags: ["normal"],
      expected: { outcome: "BID", designScore: 94 },
    };
    return {
      schemaVersion: "sol-fixtures/v1.0",
      calculationDate: "2026-10-16",
      batches: { SEED: ["FX-01"], LIVE: ["FX-01"] },
      fixtures: [entry],
    };
  };

  const tempConnector = () =>
    createFixtureConnector({ fixturesDir: dir, batch: "SEED", manifest: oneFixtureManifest() });

  const writeFx01 = (text: string) => writeFile(join(dir, "bids", "FX-01.json"), text, "utf8");

  const realFx01 = async () => readFixtureFile(FIXTURES_DIR, "FX-01");

  const INVALID = {
    ok: false,
    failure: { kind: "FIXTURE_INVALID", detail: "fixture FX-01: invalid" },
  };

  it("임시 폴더의 올바른 FX-01 은 정상 페이지다(대조군)", async () => {
    const file = await realFx01();
    await writeFx01(JSON.stringify(file));
    const page = pageOf(await tempConnector().fetchPage(first));
    expect(page.records).toEqual([
      { kind: "fixture", fixtureId: "FX-01", record: file.records[0] },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("파일이 없으면 FIXTURE_INVALID(fixture FX-01: invalid)다", async () => {
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("JSON 이 깨졌으면 FIXTURE_INVALID 다", async () => {
    await writeFx01('{ "fixtureId": "FX-01", ');
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("isDemo 가 true 가 아니면 FIXTURE_INVALID 다", async () => {
    await writeFx01(JSON.stringify({ ...(await realFx01()), isDemo: false }));
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("records 가 비어 있으면 FIXTURE_INVALID 다", async () => {
    await writeFx01(JSON.stringify({ ...(await realFx01()), records: [] }));
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("모르는 최상위 키가 있으면 FIXTURE_INVALID 다", async () => {
    await writeFx01(JSON.stringify({ ...(await realFx01()), unexpected: true }));
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("레코드의 ingestBatch 가 SEED·LIVE 밖이면 FIXTURE_INVALID 다", async () => {
    const file = await realFx01();
    await writeFx01(
      JSON.stringify({
        ...file,
        records: file.records.map((record) => ({ ...record, ingestBatch: "OTHER" })),
      }),
    );
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });

  it("파일 안의 fixtureId 가 manifest id 와 다르면 FIXTURE_INVALID 다", async () => {
    await writeFx01(JSON.stringify({ ...(await realFx01()), fixtureId: "FX-02" }));
    await expect(tempConnector().fetchPage(first)).resolves.toEqual(INVALID);
  });
});

describe("createFixtureConnector — 네트워크를 부르지 않는다(07 §2.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SEED·LIVE 를 끝까지 읽는 동안 fetch 를 한 번도 부르지 않는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("FixtureConnector 는 네트워크를 부르면 안 된다");
    });
    await walk(seedConnector());
    await walk(liveConnector());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
