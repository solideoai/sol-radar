import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database.types";
import type { FixtureBatch, FixtureFile, FixtureRecord } from "./fixture.model";
import type { SavedRevisionDecision, SaveRevisionInput } from "./ingestion.repo";
import {
  toQuotaUsedUpdate,
  toSaveRevisionParams,
  toStartedRun,
  toStoredRevision,
  toStructuredRequirementInserts,
} from "./ingestion.store";
import type { StructuredRequirement } from "./normalized-bid.model";
import { normalizeFixtureRecord } from "./normalize";
import type { NormalizedBidDraft } from "./normalized-bid.model";
import { decideRevision, type StoredRevision } from "./revision";

// C3 계약 6-2 ingestion.store(순수): 저장 포트 ↔ RPC ingest_save_revision 의 p(6-1)·DB 행 변환.
// 입력은 실제 fixture(FX-06 r1·r2, FX-08 r2 등)를 정규화·decideRevision 해서 만든다. DB·네트워크는 부르지 않는다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ANCHOR = new Date("2026-10-19T03:00:00.000Z"); // KST 2026-10-19 12:00
const FETCHED_AT = new Date("2026-10-19T09:00:00.000Z");
const BID_UUID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const REVISION_UUID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

type IngestRunRow = Tables<"ingest_runs">;

const readRecord = async (id: string, batch: FixtureBatch): Promise<FixtureRecord> => {
  const file: FixtureFile = JSON.parse(
    await readFile(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8"),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};

const draftOf = async (id: string, batch: FixtureBatch): Promise<NormalizedBidDraft> => {
  const outcome = normalizeFixtureRecord(await readRecord(id, batch), {
    fetchedAt: FETCHED_AT,
    anchor: ANCHOR,
  });
  if (!outcome.ok) throw new Error(`${id} 정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};

const saved = (decision: ReturnType<typeof decideRevision>): SavedRevisionDecision => {
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE") {
    throw new Error(`저장할 결정이 아니다: ${decision.kind}`);
  }
  return decision;
};

const createdOf = async (id: string) => saved(decideRevision(null, await draftOf(id, "SEED")));

// SEED 레코드를 revision 1 로 저장했다고 두고 LIVE 레코드로 다음 revision 을 정한다.
const nextOf = async (id: string) => {
  const first = await createdOf(id);
  const previous: StoredRevision = {
    bidId: BID_UUID,
    revision: 1,
    checksum: first.bid.checksum,
    normalized: first.bid,
  };
  return saved(decideRevision(previous, await draftOf(id, "LIVE")));
};

const rawPayloadOf = async (id: string, batch: FixtureBatch) => ({
  fixtureId: id,
  ...(await readRecord(id, batch)),
});

const inputOf = async (
  id: string,
  batch: FixtureBatch,
  decision: SavedRevisionDecision,
  ids?: { bidId?: string; revisionId?: string },
): Promise<SaveRevisionInput> => ({
  decision,
  rawPayload: await rawPayloadOf(id, batch),
  ...(ids === undefined ? {} : { ids }),
});

const FX06_DOCUMENTS = [{ name: "제안요청서.pdf", original_url: "fixtures/docs/FX-06-rfp.pdf" }];

describe("toSaveRevisionParams — CREATED(FX-06 r1)", () => {
  it("notice 는 decision.bid 의 공고 필드를 snake_case 로 옮긴다(noticeDate → published_at)", async () => {
    const decision = await createdOf("FX-06");
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", decision));
    expect(p).toMatchObject({
      notice: {
        source: "fixture",
        notice_id: "DEMO-2026-0006",
        plan_ref: null,
        pre_spec_ref: null,
        title: "대전광역시 스마트시티 통합플랫폼 유지보수 (가상)",
        agency: "대전광역시",
        stage: "NOTICE",
        status: "OPEN",
        budget_krw: "900000000",
        published_at: "2026-10-16T09:00:00.000Z",
        deadline_at: "2026-11-02T09:00:00.000Z",
        source_url: "https://demo.sol-radar.invalid/notices/FX-06",
        is_demo: true,
      },
    });
  });

  it("notice 는 위 13개 키만 가진다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", await createdOf("FX-06")));
    expect(Object.keys((p as { notice: object }).notice).sort()).toEqual(
      [
        "source",
        "notice_id",
        "plan_ref",
        "pre_spec_ref",
        "title",
        "agency",
        "stage",
        "status",
        "budget_krw",
        "published_at",
        "deadline_at",
        "source_url",
        "is_demo",
      ].sort(),
    );
  });

  it("revision 은 번호·차수·rawPayload·normalized(bid 전체)·checksum·빈 changed_fields·fetched_at 이다", async () => {
    const decision = await createdOf("FX-06");
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", decision));
    expect(p).toMatchObject({
      revision: {
        revision: 1,
        amendment_no: "01",
        raw_payload: await rawPayloadOf("FX-06", "SEED"),
        normalized: decision.bid,
        checksum: decision.bid.checksum,
        changed_fields: [],
        fetched_at: "2026-10-19T09:00:00.000Z",
      },
    });
  });

  it("documents 는 bid.attachments 의 {name, original_url: url} 이다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", await createdOf("FX-06")));
    expect(p).toMatchObject({ documents: FX06_DOCUMENTS });
  });

  it("event 는 BID_CREATED·멱등키·payload{source, noticeId, revision, kind, changedFields} 이다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", await createdOf("FX-06")));
    expect(p).toMatchObject({
      event: {
        event_type: "BID_CREATED",
        idempotency_key: "fixture:DEMO-2026-0006:1:BID_CREATED",
        payload: {
          source: "fixture",
          noticeId: "DEMO-2026-0006",
          revision: 1,
          kind: "CREATED",
          changedFields: [],
        },
      },
    });
  });

  it("ids 가 없으면 bid_id·revision_id 키가 없다(DB 가 만든다)", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", await createdOf("FX-06")));
    expect(p).not.toHaveProperty("bid_id");
    expect(p).not.toHaveProperty("revision_id");
  });

  it("p 의 최상위 키는 notice·revision·documents·event 뿐이다(ids 없을 때)", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", await createdOf("FX-06")));
    expect(Object.keys(p as object).sort()).toEqual(["documents", "event", "notice", "revision"]);
  });
});

describe("toSaveRevisionParams — ids", () => {
  it("ids 를 주면 bid_id·revision_id 로 싣는다", async () => {
    const decision = await createdOf("FX-06");
    const p = toSaveRevisionParams(
      await inputOf("FX-06", "SEED", decision, { bidId: BID_UUID, revisionId: REVISION_UUID }),
    );
    expect(p).toMatchObject({ bid_id: BID_UUID, revision_id: REVISION_UUID });
  });

  it("bidId 만 주면 bid_id 만 싣고 revision_id 키는 없다", async () => {
    const decision = await createdOf("FX-06");
    const p = toSaveRevisionParams(await inputOf("FX-06", "SEED", decision, { bidId: BID_UUID }));
    expect(p).toMatchObject({ bid_id: BID_UUID });
    expect(p).not.toHaveProperty("revision_id");
  });
});

describe("toSaveRevisionParams — CHANGED(FX-06 r2)", () => {
  it("notice 는 r2 의 status AMENDED·늘어난 마감을 싣는다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "LIVE", await nextOf("FX-06")));
    expect(p).toMatchObject({
      notice: { status: "AMENDED", deadline_at: "2026-11-16T09:00:00.000Z" },
    });
  });

  it("changed_fields 는 decision.changes 의 field 를 TRACKED_FIELDS 순서 그대로 싣는다", async () => {
    const decision = await nextOf("FX-06");
    const p = toSaveRevisionParams(await inputOf("FX-06", "LIVE", decision));
    expect(p).toMatchObject({
      revision: {
        revision: 2,
        amendment_no: "02",
        changed_fields: ["amendmentNo", "status", "deadlineAt", "content"],
      },
    });
    expect(decision.changes.map((change) => change.field)).toEqual([
      "amendmentNo",
      "status",
      "deadlineAt",
      "content",
    ]);
  });

  it("event 는 BID_CHANGED·r2 멱등키·payload.kind CHANGED·changedFields 다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "LIVE", await nextOf("FX-06")));
    expect(p).toMatchObject({
      event: {
        event_type: "BID_CHANGED",
        idempotency_key: "fixture:DEMO-2026-0006:2:BID_CHANGED",
        payload: {
          source: "fixture",
          noticeId: "DEMO-2026-0006",
          revision: 2,
          kind: "CHANGED",
          changedFields: ["amendmentNo", "status", "deadlineAt", "content"],
        },
      },
    });
  });

  it("r2 의 documents 도 그 revision 의 첨부다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-06", "LIVE", await nextOf("FX-06")));
    expect(p).toMatchObject({ documents: FX06_DOCUMENTS });
  });
});

describe("toSaveRevisionParams — CANCELLED(FX-08 r2)", () => {
  it("notice.status 는 CANCELLED 다", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-08", "LIVE", await nextOf("FX-08")));
    expect(p).toMatchObject({ notice: { notice_id: "DEMO-2026-0008", status: "CANCELLED" } });
  });

  it("event 는 BID_CHANGED 이고 payload.kind 는 CANCELLED 다", async () => {
    const decision = await nextOf("FX-08");
    const p = toSaveRevisionParams(await inputOf("FX-08", "LIVE", decision));
    expect(p).toMatchObject({
      event: {
        event_type: "BID_CHANGED",
        idempotency_key: "fixture:DEMO-2026-0008:2:BID_CHANGED",
        payload: {
          revision: 2,
          kind: "CANCELLED",
          changedFields: decision.changes.map((change) => change.field),
        },
      },
    });
  });
});

describe("toSaveRevisionParams — 값이 없는 필드", () => {
  it("예산이 null 이면 budget_krw null, 마감이 null 이면 deadline_at null 이다(FX-11)", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-11", "SEED", await createdOf("FX-11")));
    expect(p).toMatchObject({
      notice: {
        budget_krw: null,
        published_at: "2026-10-18T09:00:00.000Z",
        deadline_at: null,
      },
    });
  });

  it("budget_krw 는 정규화한 숫자 문자열이다(FX-13 '1,500백만원' → '1500000000')", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-13", "SEED", await createdOf("FX-13")));
    expect(p).toMatchObject({ notice: { budget_krw: "1500000000" } });
  });

  it("planRef 가 있으면 plan_ref 로 싣고, preSpecRef 키가 없으면 pre_spec_ref 는 null 이다(FX-17)", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-17", "SEED", await createdOf("FX-17")));
    expect(p).toMatchObject({
      notice: { plan_ref: "DEMO-PLAN-0042", pre_spec_ref: null, stage: "PLAN" },
    });
  });

  it("첨부가 없으면 documents 는 빈 배열이다(FX-04)", async () => {
    const p = toSaveRevisionParams(await inputOf("FX-04", "SEED", await createdOf("FX-04")));
    expect(p).toMatchObject({ documents: [] });
  });
});

describe("toSaveRevisionParams — 순수·JSON", () => {
  it("입력을 바꾸지 않는다", async () => {
    const input = await inputOf("FX-06", "LIVE", await nextOf("FX-06"), { bidId: BID_UUID });
    const before = structuredClone(input);
    toSaveRevisionParams(input);
    expect(input).toEqual(before);
  });

  it("p 는 JSON 으로 왕복해도 같다(undefined·Date 가 없다)", async () => {
    const p = toSaveRevisionParams(
      await inputOf("FX-06", "LIVE", await nextOf("FX-06"), {
        bidId: BID_UUID,
        revisionId: REVISION_UUID,
      }),
    );
    expect(JSON.parse(JSON.stringify(p))).toStrictEqual(p);
  });
});

describe("toStoredRevision", () => {
  it("행을 StoredRevision 으로 읽는다(normalized 는 스키마 검증을 거친 bid)", async () => {
    const { bid } = await createdOf("FX-06");
    const row = {
      bid_id: BID_UUID,
      revision: 1,
      checksum: bid.checksum,
      normalized: JSON.parse(JSON.stringify(bid)),
    };
    expect(toStoredRevision(row)).toEqual({
      bidId: BID_UUID,
      revision: 1,
      checksum: bid.checksum,
      normalized: bid,
    });
  });

  it("normalized 가 NormalizedBid 스키마를 어기면 Error 를 던진다", async () => {
    const { bid } = await createdOf("FX-06");
    const row = {
      bid_id: BID_UUID,
      revision: 1,
      checksum: bid.checksum,
      normalized: { ...bid, budgetKrw: "12억-SECRET-VALUE" },
    };
    expect(() => toStoredRevision(row)).toThrow(Error);
  });

  it("스키마 위반 오류 메시지에는 경로만 있고 값은 없다", async () => {
    const { bid } = await createdOf("FX-06");
    const row = {
      bid_id: BID_UUID,
      revision: 1,
      checksum: bid.checksum,
      normalized: { ...bid, budgetKrw: "12억-SECRET-VALUE" },
    };
    const message = (() => {
      try {
        toStoredRevision(row);
        return "던지지 않았다";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    expect(message).toContain("budgetKrw");
    expect(message).not.toContain("SECRET-VALUE");
    expect(message).not.toContain("12억");
  });

  it("normalized 가 객체가 아니면 Error 를 던진다", () => {
    expect(() =>
      toStoredRevision({
        bid_id: BID_UUID,
        revision: 1,
        checksum: "a".repeat(64),
        normalized: null,
      }),
    ).toThrow(Error);
  });
});

describe("toStartedRun", () => {
  const SUMMARY = {
    created: 3,
    changed: 1,
    cancelled: 0,
    skippedDuplicate: 2,
    quarantined: 1,
    retried: 2,
  };
  const ZERO = {
    created: 0,
    changed: 0,
    cancelled: 0,
    skippedDuplicate: 0,
    quarantined: 0,
    retried: 0,
  };
  const runRow = (overrides: Partial<IngestRunRow> = {}): IngestRunRow => ({
    id: REVISION_UUID,
    source: "fixture",
    run_mode: "FIXTURE",
    job_key: "seed-1",
    trigger: "DEMO",
    batch: "SEED",
    params: { anchor: "2026-10-19T03:00:00.000Z" },
    cursor: "5",
    status: "FAILED",
    summary: SUMMARY,
    quota_used: 0,
    requested_by: null,
    idempotency_key: null,
    started_at: "2026-10-19T09:00:00.000Z",
    finished_at: "2026-10-19T09:01:00.000Z",
    ...overrides,
  });

  it("행을 StartedRun(runId·status·cursor·summary·params·quotaUsed)으로 읽는다", () => {
    const row = runRow();
    expect(toStartedRun(row)).toEqual({
      runId: REVISION_UUID,
      status: "FAILED",
      cursor: "5",
      summary: SUMMARY,
      params: { anchor: "2026-10-19T03:00:00.000Z" },
      quotaUsed: 0,
    });
  });

  it("quota_used 는 그대로 읽는다(이어 가는 g2b run 이 여기서부터 더 센다)", () => {
    expect(toStartedRun(runRow({ quota_used: 37 })).quotaUsed).toBe(37);
  });

  it("quota_used 가 음수면 0 으로 읽는다", () => {
    expect(toStartedRun(runRow({ quota_used: -1 })).quotaUsed).toBe(0);
  });

  it("cursor 가 null 이면 null 이다", () => {
    const row = runRow({ cursor: null, status: "RUNNING" });
    expect(toStartedRun(row)).toMatchObject({ cursor: null, status: "RUNNING" });
  });

  it("summary 에 빠진 키는 0 으로 읽는다", () => {
    const row = runRow({ summary: { created: 2, retried: 1 } });
    expect(toStartedRun(row).summary).toEqual({ ...ZERO, created: 2, retried: 1 });
  });

  it.each<[string, Record<string, unknown>]>([
    ["음수", { created: -1 }],
    ["정수가 아닌 수", { created: 1.5 }],
    ["숫자 문자열", { created: "3" }],
    ["null", { created: null }],
    ["불리언", { created: true }],
  ])("summary 값이 %s 이면 0 으로 읽는다", (_name, summary) => {
    const row = runRow({ summary: summary as IngestRunRow["summary"] });
    expect(toStartedRun(row).summary.created).toBe(0);
  });

  it("잘못된 값이 있어도 다른 키는 그대로 읽는다", () => {
    const row = runRow({ summary: { ...SUMMARY, changed: -5 } });
    expect(toStartedRun(row).summary).toEqual({ ...SUMMARY, changed: 0 });
  });

  it("summary 의 6키 밖 키는 버린다", () => {
    const row = runRow({ summary: { ...SUMMARY, unexpected: 9 } });
    expect(toStartedRun(row).summary).toEqual(SUMMARY);
  });

  it.each<[string, IngestRunRow["summary"]]>([
    ["null", null],
    ["문자열", "summary"],
    ["배열", [1, 2, 3]],
  ])("summary 가 객체가 아니면(%s) 6키 모두 0 이다", (_name, summary) => {
    const row = runRow({ summary });
    expect(toStartedRun(row).summary).toEqual(ZERO);
  });

  it.each<[string, IngestRunRow["params"]]>([
    ["null", null],
    ["문자열", "anchor"],
    ["숫자", 3],
    ["불리언", true],
  ])("params 가 객체가 아니면(%s) null 이다", (_name, params) => {
    const row = runRow({ params });
    expect(toStartedRun(row).params).toBeNull();
  });

  it("params 객체는 그대로 읽는다", () => {
    const params = { window: { from: "2026-10-18T15:00:00.000Z", to: "2026-10-19T15:00:00.000Z" } };
    const row = runRow({ params });
    expect(toStartedRun(row).params).toEqual(params);
  });
});

describe("toQuotaUsedUpdate", () => {
  it("quotaUsed 를 주지 않으면 빈 객체다(fixture run 은 quota_used 를 건드리지 않는다)", () => {
    expect(toQuotaUsedUpdate(undefined)).toEqual({});
  });

  it("quotaUsed 를 주면 quota_used 로 싣는다", () => {
    expect(toQuotaUsedUpdate(12)).toEqual({ quota_used: 12 });
  });

  it("0 이상 정수가 아니면 0 으로 싣는다", () => {
    expect([toQuotaUsedUpdate(-3), toQuotaUsedUpdate(1.5)]).toEqual([
      { quota_used: 0 },
      { quota_used: 0 },
    ]);
  });
});

describe("toStructuredRequirementInserts", () => {
  const IDS = { bidId: BID_UUID, revisionId: REVISION_UUID };
  const LICENSE: StructuredRequirement = {
    kind: "LICENSE_LIMIT",
    code: "0036",
    name: "정보통신공사업",
    value: {
      bidNtceNo: "R26BK00000001",
      lcnsLmtNm: "정보통신공사업/0036",
      lmtGrpNo: "1",
      lmtSno: "1",
    },
    sourceOperation: "getBidPblancListInfoLicenseLimit",
  };
  const REGION: StructuredRequirement = {
    kind: "PARTICIPATION_REGION",
    code: null,
    name: "대구광역시",
    value: { bidNtceNo: "R26BK00000001", prtcptPsblRgnNm: "대구광역시", lmtSno: "1" },
    sourceOperation: "getBidPblancListInfoPrtcptPsblRgn",
  };

  it("행마다 bid_id·revision_id·kind·seq(배열 index)·code·name·value·source_operation 을 싣는다", () => {
    expect(toStructuredRequirementInserts(IDS, [LICENSE, REGION])).toEqual([
      {
        bid_id: BID_UUID,
        revision_id: REVISION_UUID,
        kind: "LICENSE_LIMIT",
        seq: 0,
        code: "0036",
        name: "정보통신공사업",
        value: LICENSE.value,
        source_operation: "getBidPblancListInfoLicenseLimit",
      },
      {
        bid_id: BID_UUID,
        revision_id: REVISION_UUID,
        kind: "PARTICIPATION_REGION",
        seq: 1,
        code: null,
        name: "대구광역시",
        value: REGION.value,
        source_operation: "getBidPblancListInfoPrtcptPsblRgn",
      },
    ]);
  });

  it("빈 배열이면 빈 배열이다", () => {
    expect(toStructuredRequirementInserts(IDS, [])).toEqual([]);
  });

  it("value 는 복사본이다(입력 객체를 그대로 넣지 않는다)", () => {
    const [row] = toStructuredRequirementInserts(IDS, [LICENSE]);
    expect(row?.value).not.toBe(LICENSE.value);
  });
});
