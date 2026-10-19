import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BidSourceConnector, FetchPageOutcome, G2bItem } from "./connector.model";
import { createFixtureConnector, loadFixtureManifest } from "./fixture-connector";
import type { FixtureBatch, FixtureManifest } from "./fixture.model";
import type { SaveRevisionInput, StartRunInput } from "./ingestion.repo";
import {
  createMemoryIngestionRepo,
  memoryRevisionsOf,
  type MemoryIngestionRepo,
} from "./ingestion.repo.memory";
import { runIngest, type IdFor } from "./ingestion.service";
import type { RetryDeps } from "./retry";

// C3 계약 6-2 서비스: idFor 를 주면 saveRevision 에 결정적 id(ids)를 넘긴다(2f demo-reset 의 고정 id 를 대신한다).
// saved.attachmentCount 는 documents job 등록 판단용이다. 저장은 메모리 저장소, 시각·대기는 주입한다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const NOW = new Date("2026-10-19T09:00:00.000Z");

// 결정적 UUID 모양 id(RPC 의 bid_id·revision_id 는 uuid 다). 시험 안에서만 쓰는 규칙이다.
const uuidOf = (text: string): string => {
  const hex = createHash("sha256").update(text).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const namespacedIdFor =
  (namespace: string): IdFor =>
  (kind, keys) =>
    uuidOf(
      kind === "bid"
        ? `${namespace}|bid|${keys.source}|${keys.noticeId}`
        : `${namespace}|revision|${keys.source}|${keys.noticeId}|${keys.revision}`,
    );
const idFor = namespacedIdFor("sol-radar-demo");

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

// saveRevision 입력을 기록하는 메모리 저장소.
const recordingRepo = () => {
  const memory = createMemoryIngestionRepo();
  const inputs: SaveRevisionInput[] = [];
  const repo: MemoryIngestionRepo = {
    ...memory,
    saveRevision: async (input) => {
      inputs.push(structuredClone(input));
      return memory.saveRevision(input);
    },
  };
  return { repo, inputs };
};

const ingest = (
  repo: MemoryIngestionRepo,
  jobKey: string,
  batch: FixtureBatch,
  options: { idFor?: IdFor; connector?: BidSourceConnector } = {},
) =>
  runIngest({
    connector:
      options.connector ?? createFixtureConnector({ fixturesDir: FIXTURES_DIR, batch, manifest }),
    repo,
    run: fixtureRun(jobKey, batch),
    anchor: ANCHOR,
    now: () => NOW,
    retry: retry(),
    ...(options.idFor === undefined ? {} : { idFor: options.idFor }),
  });

const idsOf = (input: SaveRevisionInput) => ("ids" in input ? input.ids : undefined);

const expectedIds = (input: SaveRevisionInput) => {
  const { source, noticeId, revision } = input.decision.bid;
  return {
    bidId: idFor("bid", { source, noticeId }),
    revisionId: idFor("revision", { source, noticeId, revision }),
  };
};

describe("idFor — saveRevision 의 ids", () => {
  it("idFor 를 주면 SEED 의 저장 19건마다 ids 가 idFor('bid')·idFor('revision', revision 1) 이다", async () => {
    const { repo, inputs } = recordingRepo();
    await ingest(repo, "seed-1", "SEED", { idFor });
    expect(inputs).toHaveLength(19);
    expect(inputs.map(idsOf)).toEqual(inputs.map(expectedIds));
  });

  it("idFor 는 bid 에 {source, noticeId}, revision 에 {source, noticeId, revision} 을 받는다", async () => {
    const { repo } = recordingRepo();
    const spy = vi.fn(idFor);
    await ingest(repo, "seed-1", "SEED", { idFor: spy });
    expect(spy).toHaveBeenCalledWith("bid", { source: "fixture", noticeId: "DEMO-2026-0001" });
    expect(spy).toHaveBeenCalledWith("revision", {
      source: "fixture",
      noticeId: "DEMO-2026-0001",
      revision: 1,
    });
  });

  it("CHANGED(FX-06 r2)·CANCELLED(FX-08 r2) 저장에도 ids 를 넘긴다(revision 2, bidId 는 r1 과 같다)", async () => {
    const { repo, inputs } = recordingRepo();
    await ingest(repo, "seed-1", "SEED", { idFor });
    const seedCount = inputs.length;
    await ingest(repo, "live-1", "LIVE", { idFor });
    const live = inputs.slice(seedCount);
    expect(live.map((input) => [input.decision.kind, input.decision.bid.noticeId])).toEqual([
      ["CHANGED", "DEMO-2026-0006"],
      ["CHANGED", "DEMO-2026-0007"],
      ["CANCELLED", "DEMO-2026-0008"],
      ["CHANGED", "DEMO-2026-0010"],
    ]);
    // expectedIds 의 bidId 는 revision 과 무관한 idFor("bid") 라 r1 과 같은 값이다.
    expect(live.map(idsOf)).toEqual(live.map(expectedIds));
  });

  it("idFor 가 없으면 ids 를 넘기지 않는다(DB 가 id 를 만든다)", async () => {
    const { repo, inputs } = recordingRepo();
    await ingest(repo, "seed-1", "SEED");
    expect(inputs.map(idsOf)).toEqual(inputs.map(() => undefined));
  });

  it("idFor 를 주면 saved 의 bidId·revisionId 가 idFor 가 만든 값이다", async () => {
    const { repo } = recordingRepo();
    const result = await ingest(repo, "seed-1", "SEED", { idFor });
    expect(result.saved.map(({ bidId, revisionId }) => ({ bidId, revisionId }))).toEqual(
      result.saved.map(({ noticeId }) => ({
        bidId: idFor("bid", { source: "fixture", noticeId }),
        revisionId: idFor("revision", { source: "fixture", noticeId, revision: 1 }),
      })),
    );
  });

  it("같은 anchor·같은 idFor 로 새 저장소에 SEED 를 두 번 돌리면 bid·revision id 가 같다(demo-reset 재실행)", async () => {
    const first = await ingest(createMemoryIngestionRepo(), "seed-1", "SEED", { idFor });
    const second = await ingest(createMemoryIngestionRepo(), "seed-1", "SEED", { idFor });
    const idPairs = (saved: typeof first.saved) =>
      saved.map(({ bidId, revisionId }) => [bidId, revisionId]);
    expect(idPairs(second.saved)).toEqual(idPairs(first.saved));
    expect(first.saved[0]?.bidId).toBe(
      idFor("bid", { source: "fixture", noticeId: "DEMO-2026-0001" }),
    );
  });
});

describe("메모리 저장소 — RPC 거부 규칙 흉내(C3 계약 6-1)", () => {
  it("같은 공고에 다른 bidId 로 다음 revision 을 저장하면 INGEST_BID_ID_MISMATCH 로 거부한다", async () => {
    const { repo, inputs } = recordingRepo();
    await ingest(repo, "seed-1", "SEED", { idFor });
    await ingest(repo, "live-1", "LIVE", { idFor });
    const fx06r2 = inputs.find(
      (input) =>
        input.decision.bid.noticeId === "DEMO-2026-0006" && input.decision.kind === "CHANGED",
    );
    if (!fx06r2) throw new Error("FX-06 r2 저장 입력이 없다");
    const fresh = createMemoryIngestionRepo();
    const fx06r1 = inputs.find(
      (input) =>
        input.decision.bid.noticeId === "DEMO-2026-0006" && input.decision.kind === "CREATED",
    );
    if (!fx06r1) throw new Error("FX-06 r1 저장 입력이 없다");
    await fresh.saveRevision(fx06r1);
    await expect(
      fresh.saveRevision({ ...fx06r2, ids: { bidId: "00000000-0000-5000-a000-000000000000" } }),
    ).rejects.toThrow(/INGEST_BID_ID_MISMATCH/);
  });
});

describe("saved.attachmentCount — documents job 등록 판단용", () => {
  it("SEED saved 의 attachmentCount 는 fixture 첨부 수다(FX-04 만 0, 나머지 1)", async () => {
    const result = await ingest(createMemoryIngestionRepo(), "seed-1", "SEED");
    expect(
      Object.fromEntries(result.saved.map((saved) => [saved.fixtureId, saved.attachmentCount])),
    ).toEqual(
      Object.fromEntries(
        result.saved.map((saved) => [saved.fixtureId, saved.fixtureId === "FX-04" ? 0 : 1]),
      ),
    );
  });

  it("attachmentCount 는 저장한 revision 의 첨부 수와 같다", async () => {
    const repo = createMemoryIngestionRepo();
    const result = await ingest(repo, "seed-1", "SEED");
    expect(result.saved.map((saved) => saved.attachmentCount)).toEqual(
      result.saved.map(
        (saved) =>
          memoryRevisionsOf(repo, "fixture", saved.noticeId).at(-1)?.normalized.attachments.length,
      ),
    );
  });

  it("LIVE saved 의 attachmentCount 는 모두 1 이다", async () => {
    const repo = createMemoryIngestionRepo();
    await ingest(repo, "seed-1", "SEED");
    const live = await ingest(repo, "live-1", "LIVE");
    expect(live.saved.map((saved) => saved.attachmentCount)).toEqual([1, 1, 1, 1]);
  });

  const g2bRun: StartRunInput = {
    source: "g2b",
    runMode: "LIVE",
    jobKey: "g2b-1",
    trigger: "MANUAL",
    batch: null,
    params: { window: { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" } },
  };
  const NOTICE_NO = "R26BK00000077";
  const docUrl = (seq: number) =>
    `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000&fileSeq=${seq}`;
  // 가상 값. 2026-10-19 실측 응답의 필드 이름만 본떴다.
  const g2bItem = (overrides: G2bItem = {}): G2bItem => ({
    bidNtceNo: NOTICE_NO,
    bidNtceOrd: "000",
    ntceKindNm: "등록공고",
    bidNtceDt: "2026-10-19 09:10:00",
    bidNtceNm: "가상 정보시스템 개발 용역",
    ntceInsttNm: "가상공고기관",
    dminsttNm: "가상수요기관",
    bidClseDt: "2026-11-23 12:00:00",
    asignBdgtAmt: "500000000",
    bidNtceDtlUrl: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${NOTICE_NO}&bidPbancOrd=000`,
    infoBizYn: "Y",
    ...overrides,
  });
  const g2bConnector = (item: G2bItem): BidSourceConnector => {
    const outcome: FetchPageOutcome = {
      ok: true,
      page: {
        records: [{ kind: "g2b-bid-notice", item }],
        nextCursor: null,
        rateLimitInfo: null,
      },
    };
    return { source: "g2b", fetchPage: async () => outcome };
  };
  const ingestG2b = (item: G2bItem) =>
    runIngest({
      connector: g2bConnector(item),
      repo: createMemoryIngestionRepo(),
      run: g2bRun,
      now: () => NOW,
      retry: retry(),
    });

  it("g2b saved 의 attachmentCount 는 서로 다른 첨부 url 수다(같은 url 은 한 번)", async () => {
    const result = await ingestG2b(
      g2bItem({
        ntceSpecDocUrl1: docUrl(1),
        ntceSpecFileNm1: "1.제안요청서.pdf",
        ntceSpecDocUrl2: docUrl(2),
        ntceSpecFileNm2: "2.과업지시서.hwp",
        ntceSpecDocUrl3: docUrl(1),
        ntceSpecFileNm3: "1.제안요청서(중복).pdf",
      }),
    );
    expect(result.saved.map((saved) => saved.attachmentCount)).toEqual([2]);
  });

  it("첨부 url 이 없는 g2b 공고의 attachmentCount 는 0 이다", async () => {
    const result = await ingestG2b(g2bItem());
    expect(result.saved.map((saved) => saved.attachmentCount)).toEqual([0]);
  });
});
