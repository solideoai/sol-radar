import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ingestErrorCodeOf,
  type BidSourceConnector,
  type ConnectorFailure,
  type FetchPageInput,
  type FetchPageOutcome,
  type SourceRecord,
} from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureBatch, FixtureFile, FixtureManifest, FixtureRecord } from "./fixture.model";
import type { IngestSummary, StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// 수집 흐름(C3 계약 Stage 2 ingestion.service, 07 §5·§6.4, 15 §6, V2-11 서비스키 가림).
// 저장은 메모리 저장소, 대기·난수·시각은 주입한다. 네트워크는 부르지 않는다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z"); // KST 2026-10-19 12:00
const NOW = new Date("2026-10-19T09:00:00.000Z");
const ZERO: IngestSummary = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

let manifest: FixtureManifest;

beforeAll(async () => {
  manifest = await loadFixtureManifest(FIXTURES_DIR);
});

const readFixtureRecord = async (id: string, batch: FixtureBatch): Promise<FixtureRecord> => {
  const file: FixtureFile = JSON.parse(
    await readFile(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8"),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};

const deps = () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  const retry: RetryDeps = { sleep, random: () => 0 };
  return { sleep, retry };
};

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

type IngestOptions = {
  connector?: BidSourceConnector;
  run?: StartRunInput;
  anchor?: Date;
  now?: () => Date;
  secrets?: readonly string[];
  retry?: RetryDeps;
};

const ingest = (
  repo: MemoryIngestionRepo,
  jobKey: string,
  batch: FixtureBatch,
  options: IngestOptions = {},
) =>
  runIngest({
    connector: options.connector ?? fixtureConnector(batch),
    repo,
    run: options.run ?? fixtureRun(jobKey, batch),
    anchor: options.anchor ?? ANCHOR,
    now: options.now ?? (() => NOW),
    retry: options.retry ?? deps().retry,
    secrets: options.secrets,
  });

const seed = async () => {
  const repo = createMemoryIngestionRepo();
  const result = await ingest(repo, "seed-1", "SEED");
  return { repo, result };
};

const seedThenLive = async () => {
  const { repo, result: seedResult } = await seed();
  const outboxAfterSeed = repo.state.outbox.length;
  const live = await ingest(repo, "live-1", "LIVE");
  return { repo, seedResult, live, outboxAfterSeed };
};

// 정해 둔 cursor 에서 재시도할 수 없는 실패를 정해 둔 횟수만큼 낸 뒤 원래 connector 로 넘긴다.
const failingAt = (
  inner: BidSourceConnector,
  cursor: string | null,
  failure: ConnectorFailure,
  times = 1,
): BidSourceConnector => {
  const state = { remaining: times };
  return {
    source: inner.source,
    fetchPage: async (input) => {
      if (input.cursor === cursor && state.remaining > 0) {
        state.remaining -= 1;
        return { ok: false, failure };
      }
      return inner.fetchPage(input);
    },
  };
};

// 언제나 같은 결과를 주는 가짜 connector. 받은 입력을 기록한다.
const constant = (outcome: FetchPageOutcome, source: "fixture" | "g2b" = "fixture") => {
  const inputs: FetchPageInput[] = [];
  const connector: BidSourceConnector = {
    source,
    fetchPage: async (input) => {
      inputs.push(input);
      return outcome;
    },
  };
  return { connector, inputs };
};

const onePage = (records: SourceRecord[]): FetchPageOutcome => ({
  ok: true,
  page: { records, nextCursor: null, rateLimitInfo: null },
});

const RESULT_CODE_99: ConnectorFailure = {
  kind: "RESULT_CODE",
  resultCode: "99",
  detail: "결과 코드 99",
};

describe("ingestErrorCodeOf — connector 실패 → ingest_errors.error_code (04 §3.6)", () => {
  it.each<[ConnectorFailure, string]>([
    [{ kind: "RATE_LIMITED", status: 429, retryAfterSec: 2, detail: "429" }, "RATE_LIMITED"],
    [{ kind: "HTTP_ERROR", status: 503, detail: "503" }, "API_HTTP_ERROR"],
    [{ kind: "RESULT_CODE", resultCode: "99", detail: "99" }, "API_RESULT_CODE"],
    [{ kind: "QUOTA_EXCEEDED", resultCode: "22", detail: "22" }, "API_QUOTA_EXCEEDED"],
    [{ kind: "TIMEOUT", detail: "timeout" }, "API_TIMEOUT"],
    [{ kind: "FIXTURE_INVALID", detail: "fixture FX-01: invalid" }, "SCHEMA_INVALID"],
  ])("%o → %s", (failure, expected) => {
    expect(ingestErrorCodeOf(failure)).toBe(expected);
  });
});

describe("runIngest — SEED summary (07 §6.4)", () => {
  it("빈 저장소에 SEED 를 돌리면 summary 는 created 19·quarantined 1·retried 2 다", async () => {
    const { result } = await seed();
    expect(result.summary).toEqual({
      created: 19,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 1,
      retried: 2,
    });
  });

  it("끝까지 갔어도 격리(FX-12)가 있으면 PARTIAL 로 끝난다(04 §4 PARTIAL = 일부 격리)", async () => {
    const { result } = await seed();
    expect(result.status).toBe("PARTIAL");
  });

  it("새 run 의 결과는 alreadyFinished false, resumedFromCursor null 이다", async () => {
    const { result } = await seed();
    expect(result.alreadyFinished).toBe(false);
    expect(result.resumedFromCursor).toBeNull();
  });

  it("저장소의 run 도 같은 summary 와 PARTIAL 로 한 번 끝난다", async () => {
    const { repo, result } = await seed();
    expect(repo.state.finishes).toEqual([
      { runId: result.runId, status: "PARTIAL", summary: result.summary },
    ]);
  });

  // params 는 Stage 5-B 부터 fixture anchor 가 더해진다. 그 단언은 ingestion.service.anchor.test.ts 가 맡는다.
  it("startRun 에 받은 run 입력(source·runMode·jobKey·trigger·batch)을 그대로 넘긴다", async () => {
    const { repo } = await seed();
    const identity = (input: StartRunInput | undefined) =>
      input && {
        source: input.source,
        runMode: input.runMode,
        jobKey: input.jobKey,
        trigger: input.trigger,
        batch: input.batch,
      };
    expect(identity(repo.state.runs.get("seed-1")?.input)).toEqual(
      identity(fixtureRun("seed-1", "SEED")),
    );
  });
});

describe("runIngest — LIVE summary (07 §6.4)", () => {
  it("SEED 뒤 LIVE 는 changed 3·cancelled 1·skippedDuplicate 1 이다", async () => {
    const { live } = await seedThenLive();
    expect(live.summary).toEqual({
      created: 0,
      changed: 3,
      cancelled: 1,
      skippedDuplicate: 1,
      quarantined: 0,
      retried: 0,
    });
  });

  it("LIVE 는 격리가 없어 SUCCEEDED 로 끝난다", async () => {
    const { live } = await seedThenLive();
    expect(live.status).toBe("SUCCEEDED");
  });
});

describe("runIngest — SEED 를 다른 jobKey 로 다시(멱등, 07 §6.4)", () => {
  it("두 번째 SEED 는 19건 모두 skippedDuplicate, FX-12 는 다시 격리, 새 connector 의 429 재시도 2 다", async () => {
    const { repo } = await seed();
    const again = await ingest(repo, "seed-2", "SEED");
    expect(again.summary).toEqual({
      created: 0,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 19,
      quarantined: 1,
      retried: 2,
    });
  });

  it("두 번째 SEED 는 revision·이벤트를 늘리지 않는다", async () => {
    const { repo } = await seed();
    await ingest(repo, "seed-2", "SEED");
    expect(repo.state.revisions).toHaveLength(19);
    expect(repo.state.outbox).toHaveLength(19);
  });
});

describe("runIngest — FX-12 격리 (15 §6, 11 §3.1)", () => {
  it("SEED 의 오류 기록은 FX-12 격리 1건뿐이다", async () => {
    const { repo } = await seed();
    expect(repo.state.errors).toHaveLength(1);
  });

  it("격리 기록은 sourceKey fixture:DEMO-2026-0012, MISSING_REQUIRED_FIELD, resultCode null, 상세 missing: title 이다", async () => {
    const { repo, result } = await seed();
    expect(repo.state.errors[0]).toEqual({
      runId: result.runId,
      sourceKey: "fixture:DEMO-2026-0012",
      errorCode: "MISSING_REQUIRED_FIELD",
      resultCode: null,
      redactedDetail: "missing: title",
    });
  });

  it("격리 상세에는 FX-12 의 본문·기관명이 없다", async () => {
    const { repo } = await seed();
    const fx12 = await readFixtureRecord("FX-12", "SEED");
    const detail = repo.state.errors[0]?.redactedDetail ?? "";
    expect(detail).not.toContain(String(fx12.content));
    expect(detail).not.toContain(String(fx12.agency));
  });

  it("격리된 FX-12 는 적재하지 않는다(공고·revision·이벤트 없음)", async () => {
    const { repo } = await seed();
    expect(memoryRevisionsOf(repo, "fixture", "DEMO-2026-0012")).toEqual([]);
    expect(repo.state.outbox.map((event) => event.idempotencyKey).join(",")).not.toContain(
      "DEMO-2026-0012",
    );
  });
});

describe("runIngest — 경고는 기록하고 적재는 계속한다 (15 §6)", () => {
  const withUnparsedBudget = async () => {
    const base = await readFixtureRecord("FX-01", "SEED");
    const record: FixtureRecord = { ...base, noticeId: "DEMO-TEST-0001", budgetKrw: "미정" };
    const { connector } = constant(onePage([{ kind: "fixture", fixtureId: "FX-01", record }]));
    const repo = createMemoryIngestionRepo();
    const result = await ingest(repo, "warn-1", "SEED", { connector });
    return { repo, result };
  };

  it("금액을 읽지 못하면 BUDGET_UNPARSED 를 sourceKey 와 함께 기록한다", async () => {
    const { repo, result } = await withUnparsedBudget();
    expect(repo.state.errors).toEqual([
      {
        runId: result.runId,
        sourceKey: "fixture:DEMO-TEST-0001",
        errorCode: "BUDGET_UNPARSED",
        resultCode: null,
        redactedDetail: "budget unparsed",
      },
    ]);
  });

  it("경고가 있어도 공고는 CREATED 로 적재하고 격리로 세지 않는다", async () => {
    const { result } = await withUnparsedBudget();
    expect(result.saved.map((saved) => saved.kind)).toEqual(["CREATED"]);
    expect(result.summary).toEqual({ ...ZERO, created: 1 });
  });

  it("경고만 있고 격리가 없으면 SUCCEEDED 로 끝난다(경고는 PARTIAL 사유가 아니다)", async () => {
    const { result } = await withUnparsedBudget();
    expect(result.status).toBe("SUCCEEDED");
  });

  it("적재한 revision 의 budgetKrw 는 null 이다", async () => {
    const { repo } = await withUnparsedBudget();
    expect(
      memoryRevisionsOf(repo, "fixture", "DEMO-TEST-0001").map(
        (revision) => revision.normalized.budgetKrw,
      ),
    ).toEqual([null]);
  });
});

describe("runIngest — saved 와 재분석(07 §5)", () => {
  it("SEED 의 saved 는 19건 모두 CREATED·reanalyze true 다", async () => {
    const { result } = await seed();
    expect(result.saved).toHaveLength(19);
    expect(result.saved.every((saved) => saved.kind === "CREATED" && saved.reanalyze)).toBe(true);
  });

  it("LIVE 의 saved 는 FX-06·07 변경, FX-08 취소, FX-10 변경 순서다(FX-09 없음)", async () => {
    const { live } = await seedThenLive();
    expect(live.saved.map(({ noticeId, kind }) => [noticeId, kind])).toEqual([
      ["DEMO-2026-0006", "CHANGED"],
      ["DEMO-2026-0007", "CHANGED"],
      ["DEMO-2026-0008", "CANCELLED"],
      ["DEMO-2026-0010", "CHANGED"],
    ]);
  });

  it("FX-08 취소는 reanalyze false 다", async () => {
    const { live } = await seedThenLive();
    expect(live.saved.find((saved) => saved.noticeId === "DEMO-2026-0008")?.reanalyze).toBe(false);
  });

  it("LIVE 의 변경(FX-06·07·10)은 reanalyze true 다", async () => {
    const { live } = await seedThenLive();
    expect(
      live.saved.filter((saved) => saved.kind === "CHANGED").map((saved) => saved.reanalyze),
    ).toEqual([true, true, true]);
  });

  it("FX-08 취소 revision 2 의 status 는 CANCELLED 이고 revision 1 은 남아 있다", async () => {
    const { repo } = await seedThenLive();
    expect(
      memoryRevisionsOf(repo, "fixture", "DEMO-2026-0008").map((revision) => [
        revision.revision,
        revision.normalized.status,
      ]),
    ).toEqual([
      [1, "OPEN"],
      [2, "CANCELLED"],
    ]);
  });

  it("saved 의 bidId·revisionId 는 저장소가 돌려준 값이다", async () => {
    const { repo, live } = await seedThenLive();
    const fx08 = live.saved.find((saved) => saved.noticeId === "DEMO-2026-0008");
    const stored = memoryRevisionsOf(repo, "fixture", "DEMO-2026-0008").find(
      (revision) => revision.revision === 2,
    );
    expect(fx08?.bidId).toBe(stored?.bidId);
    expect(fx08?.revisionId).toBe(stored?.revisionId);
  });

  // 5-F: fixture rawPayload 는 레코드 원문에 fixture 파일의 id 를 최상위 키로 더한 것이다.
  it("rawPayload 로 fixture 레코드 원문(+ fixtureId)을 넘긴다", async () => {
    const { repo } = await seed();
    const fx01 = memoryRevisionsOf(repo, "fixture", "DEMO-2026-0001")[0];
    expect(fx01?.rawPayload).toEqual({
      fixtureId: "FX-01",
      ...(await readFixtureRecord("FX-01", "SEED")),
    });
  });

  // 5-C: 레코드에 status 가 없는 fixture 는 revision ≥ 2 에서 AMENDED, 레코드 status 가 있으면 그 값.
  it("LIVE 의 r2 status 는 FX-06·07·10 AMENDED, FX-08 CANCELLED 다", async () => {
    const { repo } = await seedThenLive();
    const r2StatusOf = (noticeId: string) =>
      memoryRevisionsOf(repo, "fixture", noticeId).find((revision) => revision.revision === 2)
        ?.normalized.status;
    expect(
      ["DEMO-2026-0006", "DEMO-2026-0007", "DEMO-2026-0008", "DEMO-2026-0010"].map(r2StatusOf),
    ).toEqual(["AMENDED", "AMENDED", "CANCELLED", "AMENDED"]);
  });
});

// 5-D: demo:reset 이 saved 를 { bids: saved, … } 로 감싼다. 각 항목에 checksum·fixtureId 가 있어야 한다.
describe("runIngest — saved 의 checksum·fixtureId (C3 계약 5-D)", () => {
  const SEED_SAVED_IDS = Array.from(
    { length: 20 },
    (_, index) => `FX-${String(index + 1).padStart(2, "0")}`,
  ).filter((id) => id !== "FX-12");

  it("SEED saved 의 fixtureId 는 FX-12 를 뺀 19건을 manifest 순서로 담는다", async () => {
    const { result } = await seed();
    expect(result.saved.map((saved) => saved.fixtureId)).toEqual(SEED_SAVED_IDS);
  });

  it("LIVE saved 의 fixtureId 는 FX-06·07·08·10 이다(FX-09 중복 없음)", async () => {
    const { live } = await seedThenLive();
    expect(live.saved.map((saved) => saved.fixtureId)).toEqual([
      "FX-06",
      "FX-07",
      "FX-08",
      "FX-10",
    ]);
  });

  it("saved 의 checksum 은 모두 소문자 16진 64자리다", async () => {
    const { result } = await seed();
    expect(result.saved.every((saved) => /^[0-9a-f]{64}$/.test(saved.checksum))).toBe(true);
  });

  it("saved 의 checksum 은 저장소에 남은 그 revision 의 checksum 과 같다", async () => {
    const { repo, live } = await seedThenLive();
    const storedChecksumOf = (revisionId: string) =>
      repo.state.revisions.find((revision) => revision.revisionId === revisionId)?.checksum;
    expect(live.saved.map((saved) => saved.checksum)).toEqual(
      live.saved.map((saved) => storedChecksumOf(saved.revisionId)),
    );
  });

  it("SEED saved 의 checksum 도 저장소의 revision checksum 과 같다", async () => {
    const { repo, result } = await seed();
    expect(result.saved.map((saved) => saved.checksum)).toEqual(
      repo.state.revisions.map((revision) => revision.checksum),
    );
  });
});

describe("runIngest — outbox 이벤트와 멱등키", () => {
  it("SEED 는 BID_CREATED 이벤트를 19건 만든다", async () => {
    const { repo } = await seed();
    expect(repo.state.outbox).toHaveLength(19);
    expect(repo.state.outbox.every((event) => event.type === "BID_CREATED")).toBe(true);
  });

  it("FX-01 의 멱등키는 fixture:DEMO-2026-0001:1:BID_CREATED 다", async () => {
    const { repo } = await seed();
    expect(repo.state.outbox[0]?.idempotencyKey).toBe("fixture:DEMO-2026-0001:1:BID_CREATED");
  });

  it("LIVE 는 BID_CHANGED 이벤트 4건(FX-06·07·08·10, revision 2)을 더한다", async () => {
    const { repo, outboxAfterSeed } = await seedThenLive();
    expect(repo.state.outbox.slice(outboxAfterSeed).map((event) => event.idempotencyKey)).toEqual([
      "fixture:DEMO-2026-0006:2:BID_CHANGED",
      "fixture:DEMO-2026-0007:2:BID_CHANGED",
      "fixture:DEMO-2026-0008:2:BID_CHANGED",
      "fixture:DEMO-2026-0010:2:BID_CHANGED",
    ]);
  });
});

describe("runIngest — 체크포인트", () => {
  it("SEED 는 페이지마다 다음 cursor 를 체크포인트로 남기고 마지막은 null 이다", async () => {
    const { repo, result } = await seed();
    expect(
      repo.state.checkpoints
        .filter((checkpoint) => checkpoint.runId === result.runId)
        .map((checkpoint) => checkpoint.cursor),
    ).toEqual([...Array.from({ length: 19 }, (_, index) => String(index + 1)), null]);
  });

  it("마지막 체크포인트의 summary 는 최종 summary 와 같다", async () => {
    const { repo, result } = await seed();
    expect(repo.state.checkpoints.at(-1)?.summary).toEqual(result.summary);
  });
});

describe("runIngest — connector 실패 (07 §2.6, 15 §6: 그 창의 수집 중단, 기존 공고 보존)", () => {
  it("첫 페이지부터 실패하면 FAILED 이고 summary 는 모두 0 이다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), null, RESULT_CODE_99);
    const result = await ingest(repo, "fail-1", "SEED", { connector });
    expect(result.status).toBe("FAILED");
    expect(result.summary).toEqual(ZERO);
  });

  it("첫 페이지 실패는 fixture:page:start 로 API_RESULT_CODE 와 resultCode 원문을 기록한다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), null, RESULT_CODE_99);
    const result = await ingest(repo, "fail-1", "SEED", { connector });
    expect(repo.state.errors).toEqual([
      {
        runId: result.runId,
        sourceKey: "fixture:page:start",
        errorCode: "API_RESULT_CODE",
        resultCode: "99",
        redactedDetail: "결과 코드 99",
      },
    ]);
  });

  it("실패하면 실패한 cursor 를 체크포인트로 남기고 run 을 그 상태로 끝낸다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), null, RESULT_CODE_99);
    const result = await ingest(repo, "fail-1", "SEED", { connector });
    expect(repo.state.checkpoints.at(-1)).toEqual({
      runId: result.runId,
      cursor: null,
      summary: ZERO,
    });
    expect(repo.state.finishes).toEqual([{ runId: result.runId, status: "FAILED", summary: ZERO }]);
  });

  it("두 번째 페이지에서 실패하면 처리한 페이지가 있어도 FAILED 이고 cursor 1 을 남긴다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), "1", RESULT_CODE_99);
    const result = await ingest(repo, "fail-2", "SEED", { connector });
    expect(result.status).toBe("FAILED");
    expect(result.summary).toEqual({ ...ZERO, created: 1 });
    expect(repo.state.runs.get("fail-2")?.cursor).toBe("1");
  });

  it("두 번째 페이지 실패의 sourceKey 는 fixture:page:1 이다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), "1", RESULT_CODE_99);
    await ingest(repo, "fail-2", "SEED", { connector });
    expect(repo.state.errors.map((error) => error.sourceKey)).toEqual(["fixture:page:1"]);
  });

  it("FAILED 로 끝난 jobKey 를 다시 돌리면 끝난 run 이 아니므로 저장된 cursor 부터 이어 간다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), "1", RESULT_CODE_99);
    const failed = await ingest(repo, "fail-2", "SEED", { connector });
    const resumed = await ingest(repo, "fail-2", "SEED", { connector });
    expect(resumed.runId).toBe(failed.runId);
    expect(resumed.alreadyFinished).toBe(false);
    expect(resumed.resumedFromCursor).toBe("1");
  });

  it("FAILED 에서 이어 간 실행이 끝까지 가면 summary 가 이어 쌓이고 FX-12 격리로 PARTIAL 이다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), "1", RESULT_CODE_99);
    await ingest(repo, "fail-2", "SEED", { connector });
    const resumed = await ingest(repo, "fail-2", "SEED", { connector });
    expect(resumed.status).toBe("PARTIAL");
    expect(resumed.summary).toEqual({ ...ZERO, created: 19, quarantined: 1, retried: 2 });
  });

  it("이어 가는 실행이 다시 실패해도 FAILED 이고 cursor 3 부터 이었다", async () => {
    const repo = createMemoryIngestionRepo();
    const connector = failingAt(fixtureConnector("SEED"), "3", RESULT_CODE_99, 2);
    await ingest(repo, "fail-3", "SEED", { connector });
    const resumed = await ingest(repo, "fail-3", "SEED", { connector });
    expect(resumed.resumedFromCursor).toBe("3");
    expect(resumed.status).toBe("FAILED");
  });

  it("RUNNING 으로 남은 run(중간에 멈춘 worker)은 저장된 cursor·summary 에서 이어 간다", async () => {
    const repo = createMemoryIngestionRepo();
    const started = await repo.startRun(fixtureRun("crash-1", "SEED"));
    await repo.saveCheckpoint(started.runId, { cursor: "15", summary: { ...ZERO, created: 14 } });
    const { connector, inputs } = constant(onePage([]));
    const resumed = await ingest(repo, "crash-1", "SEED", { connector });
    expect(resumed.alreadyFinished).toBe(false);
    expect(resumed.resumedFromCursor).toBe("15");
    expect(inputs.map((input) => input.cursor)).toEqual(["15"]);
    expect(resumed.summary).toEqual({ ...ZERO, created: 14 });
  });

  it.each(["SUCCEEDED", "PARTIAL"] as const)(
    "%s 로 끝난 run 은 cursor 가 남아 있어도 이어 가지 않는다(alreadyFinished, resumedFromCursor null, connector 미호출)",
    async (status) => {
      const repo = createMemoryIngestionRepo();
      const started = await repo.startRun(fixtureRun("done-1", "SEED"));
      const summary = { ...ZERO, created: 3, quarantined: status === "PARTIAL" ? 1 : 0 };
      await repo.saveCheckpoint(started.runId, { cursor: "7", summary });
      await repo.finishRun(started.runId, { status, summary });
      const { connector, inputs } = constant(onePage([]));
      const rerun = await ingest(repo, "done-1", "SEED", { connector });
      expect(rerun).toEqual({
        runId: started.runId,
        status,
        summary,
        saved: [],
        resumedFromCursor: null,
        alreadyFinished: true,
      });
      expect(inputs).toEqual([]);
    },
  );

  it("LIVE 첫 페이지가 실패하면 FAILED 이고 기존 공고 19건과 revision 은 그대로다", async () => {
    const { repo } = await seed();
    const connector = failingAt(fixtureConnector("LIVE"), null, RESULT_CODE_99);
    const result = await ingest(repo, "live-fail", "LIVE", { connector });
    expect(result.status).toBe("FAILED");
    expect(repo.state.bids.size).toBe(19);
    expect(repo.state.revisions).toHaveLength(19);
  });

  it("LIVE 가 FX-08 페이지에서 실패하면 FX-08 은 취소되지 않고 revision 1(OPEN)로 남는다", async () => {
    const { repo } = await seed();
    const connector = failingAt(fixtureConnector("LIVE"), "2", RESULT_CODE_99);
    const result = await ingest(repo, "live-fail", "LIVE", { connector });
    expect(result.status).toBe("FAILED");
    expect(
      memoryRevisionsOf(repo, "fixture", "DEMO-2026-0008").map((revision) => [
        revision.revision,
        revision.normalized.status,
      ]),
    ).toEqual([[1, "OPEN"]]);
  });

  it("429 가 재시도 3회 뒤에도 계속되면 RATE_LIMITED 로 기록하고 retried 3 이다", async () => {
    const repo = createMemoryIngestionRepo();
    const { connector } = constant({
      ok: false,
      failure: { kind: "RATE_LIMITED", status: 429, retryAfterSec: 2, detail: "429" },
    });
    const { sleep, retry } = deps();
    const result = await ingest(repo, "rl-1", "SEED", { connector, retry });
    expect(result.status).toBe("FAILED");
    expect(result.summary.retried).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000, 2000]);
    expect(repo.state.errors.map(({ errorCode, resultCode }) => [errorCode, resultCode])).toEqual([
      ["RATE_LIMITED", null],
    ]);
  });
});

describe("runIngest — 수집 창(run.params.window)", () => {
  const g2bRun = (params: Record<string, unknown> | null): StartRunInput => ({
    source: "g2b",
    runMode: "LIVE",
    jobKey: "window-1",
    trigger: "MANUAL",
    batch: null,
    params,
  });

  it("params.window 의 from·to 문자열을 fetchPage 에 넘긴다", async () => {
    const { connector, inputs } = constant(onePage([]), "g2b");
    const window = { from: "2026-10-18T00:00:00.000Z", to: "2026-10-19T00:00:00.000Z" };
    await ingest(createMemoryIngestionRepo(), "window-1", "SEED", {
      connector,
      run: g2bRun({ window }),
    });
    expect(inputs).toEqual([{ from: window.from, to: window.to, cursor: null }]);
  });

  it("params 가 없으면 from·to 는 null 이다", async () => {
    const { connector, inputs } = constant(onePage([]), "g2b");
    await ingest(createMemoryIngestionRepo(), "window-1", "SEED", {
      connector,
      run: g2bRun(null),
    });
    expect(inputs).toEqual([{ from: null, to: null, cursor: null }]);
  });

  it("window 의 from·to 가 문자열이 아니면 null 로 넘긴다", async () => {
    const { connector, inputs } = constant(onePage([]), "g2b");
    await ingest(createMemoryIngestionRepo(), "window-1", "SEED", {
      connector,
      run: g2bRun({ window: { from: 20261018, to: null } }),
    });
    expect(inputs).toEqual([{ from: null, to: null, cursor: null }]);
  });
});

describe("runIngest — 서비스키 가림 (V2-11, 15 §6)", () => {
  const SECRET = "svcKEY+test/value==";
  const ENCODED_ONCE = encodeURIComponent(SECRET);
  const ENCODED_TWICE = encodeURIComponent(ENCODED_ONCE);

  const failWith = async (detail: string) => {
    const repo = createMemoryIngestionRepo();
    const { connector } = constant(
      { ok: false, failure: { kind: "RESULT_CODE", resultCode: "30", detail } },
      "g2b",
    );
    await ingest(repo, "secret-1", "SEED", {
      connector,
      run: {
        source: "g2b",
        runMode: "LIVE",
        jobKey: "secret-1",
        trigger: "MANUAL",
        batch: null,
        params: null,
      },
      secrets: [SECRET],
    });
    return repo;
  };

  const detailOf = (repo: MemoryIngestionRepo) => repo.state.errors[0]?.redactedDetail ?? "";

  it("g2b 실패는 g2b:page:start 로 기록한다", async () => {
    const repo = await failWith("결과 코드 30");
    expect(repo.state.errors.map((error) => error.sourceKey)).toEqual(["g2b:page:start"]);
  });

  it("상세의 서비스키 원문을 [REDACTED] 로 바꾸고 나머지는 남긴다", async () => {
    const repo = await failWith(`인증 실패: ${SECRET} 거부`);
    expect(detailOf(repo)).toBe("인증 실패: [REDACTED] 거부");
  });

  it("상세의 서비스키 URL 인코딩 1회 형태를 가린다", async () => {
    const repo = await failWith(`거부 ${ENCODED_ONCE} 끝`);
    expect(detailOf(repo)).toBe("거부 [REDACTED] 끝");
  });

  it("상세의 서비스키 URL 인코딩 2회 형태를 가린다", async () => {
    const repo = await failWith(`거부 ${ENCODED_TWICE} 끝`);
    expect(detailOf(repo)).toBe("거부 [REDACTED] 끝");
  });

  it("secrets 에 없는 값이라도 요청 URL 의 serviceKey 쿼리 값은 가린다", async () => {
    const repo = await failWith(
      "요청 GET https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc?pageNo=1&serviceKey=UNLISTED-KEY-123&type=json",
    );
    expect(detailOf(repo)).not.toContain("UNLISTED-KEY-123");
    expect(detailOf(repo)).toContain("[REDACTED]");
    expect(detailOf(repo)).toContain("pageNo=1");
  });

  it("저장소에 남은 어떤 기록에도 서비스키가 어떤 형태로도 없다", async () => {
    const repo = await failWith(
      `키 ${SECRET} / ${ENCODED_ONCE} / ${ENCODED_TWICE} / https://apis.data.go.kr/x?serviceKey=${ENCODED_ONCE}&pageNo=1`,
    );
    const everything = JSON.stringify({
      errors: repo.state.errors,
      checkpoints: repo.state.checkpoints,
      finishes: repo.state.finishes,
      runs: [...repo.state.runs.values()],
    });
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(ENCODED_ONCE);
    expect(everything).not.toContain(ENCODED_TWICE);
  });
});

describe("runIngest — now·anchor 주입으로 결정적", () => {
  it("revision 의 fetchedAt 은 주입한 now() 다", async () => {
    const { repo } = await seed();
    expect(new Set(repo.state.revisions.map((revision) => revision.normalized.fetchedAt))).toEqual(
      new Set([NOW.toISOString()]),
    );
  });

  it("FX-01 의 상대 날짜는 anchor 기준 KST 18:00 이다(-5d → 10-14, +21d → 11-09)", async () => {
    const { repo } = await seed();
    const fx01 = memoryRevisionsOf(repo, "fixture", "DEMO-2026-0001")[0]?.normalized;
    expect([fx01?.noticeDate, fx01?.deadlineAt]).toEqual([
      "2026-10-14T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
  });

  it("같은 now·anchor 로 두 저장소에 SEED 를 돌리면 revision checksum 이 같다", async () => {
    const first = await seed();
    const second = await seed();
    expect(second.repo.state.revisions.map((revision) => revision.checksum)).toEqual(
      first.repo.state.revisions.map((revision) => revision.checksum),
    );
  });

  it("LIVE 를 다른 anchor 로 돌리면 날짜가 달라져 FX-09 도 변경으로 잡힌다", async () => {
    const { repo } = await seed();
    const live = await ingest(repo, "live-shifted", "LIVE", {
      anchor: new Date("2026-10-20T03:00:00.000Z"),
    });
    expect(live.summary).toEqual({ ...ZERO, changed: 4, cancelled: 1 });
  });
});
