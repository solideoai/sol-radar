import { describe, expect, expectTypeOf, it } from "vitest";
import * as analysisBarrel from "@/server/analysis";
import type {
  AnalysisStores,
  AttachmentTextReader,
  PreanalyzeStore,
  RevisionDocumentText,
} from "@/server/analysis";
import { ALGORITHM_VERSION } from "@/server/scoring";
import type { ExtractionCacheKey } from "./analysis-job.model";
import { toExtractionRecord, type AnalysisRunRecord } from "./analysis.model";
import { runAnalysis } from "./analysis.service";
import { createAnalysisStores, createPreanalyzeStore } from "./analysis.repo";
import {
  toExtractionRow,
  toFailedUpdate,
  toFinishScoreRunPayload,
  toLoadedContext,
  toRunningUpdate,
  type LoaderRows,
} from "./analysis-store.model";
import {
  LEAKY_ERROR_TEXT,
  ORG_ID,
  OTHER_ORG_ID,
  SEED_PROFILE,
  bodyRows,
  conflictColumns,
  contextFromLoaded,
  eqValue,
  fakeSupabase,
  filteredReply,
  inValues,
  loaderRoute,
  loaderRowsFor,
  postgrestError,
  projectedReply,
  seedBid,
  selectedColumns,
  toPostgrestTimestamp,
  type FakeRow,
  type PostgrestCall,
  type PostgrestRoute,
} from "./store.test-support";
import {
  G2B_BID_ID,
  NON_DEMO_BID_ID,
  bidTablesRoute,
  seedBidTables,
  seedTargets,
  toDemoBidRows,
  withForeignBids,
  withRevision2,
  type BidTables,
} from "./preanalyze.test-support";
import type { DemoBidRow } from "./preanalyze.model";
import {
  QUEUED_AT,
  buildContext,
  buildDeps,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  loadExtraction,
  withPatch,
} from "./test-support";

// 저장 port 의 Supabase 구현. 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어
// PostgREST 로 나가는 요청(표·방법·select 열·필터·Prefer·본문)과 순서를 본다. 규칙은 매핑 함수 몫이라 여기선 값이 그대로 가는지만 본다.
// service role 은 RLS 를 거치지 않으므로 조직 표의 모든 질의·쓰기에 org_id 가 걸려야 한다.

const RUN_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const CACHE_KEY: NonNullable<ExtractionCacheKey> = {
  modelName: "fixture",
  promptHash: "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e",
};
const ORG_TABLES = ["score_runs", "company_profiles", "team_member_scoring", "assignments"];

const DOCUMENTS: RevisionDocumentText[] = [
  {
    documentId: "doc-1",
    name: "제안요청서.pdf",
    downloadStatus: "OK",
    downloadErrorCode: null,
    parseStatus: "PARSED",
    parseErrorCode: null,
    text: "가상 제안요청서 본문",
    pages: [{ page: 1, charOffset: 0 }],
  },
];

const loaderRows = (): LoaderRows =>
  loaderRowsFor(
    "FX-01",
    { scoreRunId: RUN_ID, queuedAt: QUEUED_AT, idempotencyKey: `${ORG_ID}:req-1` },
    DOCUMENTS,
  );

/** 받은 revision_id 를 기록하는 가짜 첨부 port. */
function fakeAttachments(documents: RevisionDocumentText[] = DOCUMENTS) {
  const reads: string[] = [];
  const reader: AttachmentTextReader = {
    readRevisionDocuments: async (revisionId) => {
      reads.push(revisionId);
      return documents;
    },
  };
  return { reader, reads };
}

/** 앞의 라우트가 답하지 않으면 다음 라우트로 넘긴다. */
function routes(...list: PostgrestRoute[]): PostgrestRoute {
  return (call) =>
    list.reduce<ReturnType<PostgrestRoute>>((reply, route) => reply ?? route(call), undefined);
}

/** 그 표·방법 요청에만 답한다. */
function on(method: string, table: string, reply: ReturnType<PostgrestRoute>): PostgrestRoute {
  return (call) => (call.method === method && call.table === table ? reply : undefined);
}

async function load(
  options: { route?: PostgrestRoute; cacheKey?: ExtractionCacheKey; rows?: LoaderRows } = {},
) {
  const rows = options.rows ?? loaderRows();
  const fake = fakeSupabase(routes(options.route ?? (() => undefined), loaderRoute(rows)));
  const attachments = fakeAttachments(rows.documents);
  const stores = createAnalysisStores(fake.client, attachments.reader);
  const target = { orgId: rows.scoreRun.org_id, scoreRunId: rows.scoreRun.id };
  const loaded = await stores.loader.load(
    target,
    options.cacheKey === undefined ? CACHE_KEY : options.cacheKey,
  );
  return { loaded, fake, attachments, rows };
}

function only(calls: PostgrestCall[]): PostgrestCall {
  expect(calls).toHaveLength(1);
  return calls[0];
}

/** fixture 경로 FX-01 레코드(3b mock gateway). */
const RECORD: AnalysisRunRecord = await runAnalysis(
  buildContext("FX-01"),
  buildDeps(fakeGateway(healthyRoutes("FX-01")).gateway, fakeExtractionStore().store),
);

/** 실패한 store 호출이 던진 오류. 던지지 않으면 시험을 실패시킨다. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

// ── loader ──

describe("loader.load · 질의", () => {
  // started_at 은 run 잡기·닫기의 쓰기 조건(compare-and-set)이라 함께 읽는다. 예전 기대(여덟 열)에 더했다.
  it("score_runs 를 id·org_id 로 읽고 run 열(started_at 포함)만 고른다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(eqValue(call, "id")).toBe(RUN_ID);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      [
        "id",
        "org_id",
        "bid_id",
        "revision_id",
        "company_profile_id",
        "idempotency_key",
        "status",
        "queued_at",
        "started_at",
      ].toSorted(),
    );
  });

  it("started_at 원문(마이크로초·오프셋)을 바꾸지 않고 startedAt 으로 넘긴다", async () => {
    const raw = "2026-10-16T09:00:00.123456+00:00";
    const rows = loaderRowsFor(
      "FX-01",
      {
        scoreRunId: RUN_ID,
        queuedAt: QUEUED_AT,
        idempotencyKey: `${ORG_ID}:req-1`,
        status: "RUNNING",
        startedAt: raw,
      },
      DOCUMENTS,
    );
    const { loaded } = await load({ rows });
    expect(loaded?.startedAt).toBe(raw);
  });

  it("bid_revisions 를 score_runs 의 revision_id·bid_id 로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("bid_revisions", "GET"));
    expect(eqValue(call, "id")).toBe(rows.scoreRun.revision_id);
    expect(eqValue(call, "bid_id")).toBe(rows.scoreRun.bid_id);
    expect(selectedColumns(call)).toEqual(
      ["id", "bid_id", "revision", "raw_payload", "normalized", "fetched_at"].toSorted(),
    );
  });

  it("bid_structured_requirements 를 revision_id 로 (kind, seq) 순서로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("bid_structured_requirements", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(call.params.get("order")).toBe("kind.asc,seq.asc");
    expect(selectedColumns(call)).toEqual(
      ["kind", "seq", "code", "name", "value", "source_operation"].toSorted(),
    );
  });

  it("cacheKey 가 있으면 requirement_extractions 를 revision_id·성공 상태·model_name·prompt_hash 로 최신 1행 읽는다", async () => {
    const { fake, rows } = await load({ cacheKey: CACHE_KEY });
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(eqValue(call, "model_name")).toBe(CACHE_KEY.modelName);
    expect(eqValue(call, "prompt_hash")).toBe(CACHE_KEY.promptHash);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
  });

  it("cacheKey 가 null 이면 model_name·prompt_hash 조건 없이 그 revision 의 최신 성공 행 1개를 읽는다(S6)", async () => {
    const { fake, rows } = await load({ cacheKey: null });
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(call.params.has("model_name")).toBe(false);
    expect(call.params.has("prompt_hash")).toBe(false);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
  });

  it("requirement_extractions 는 id·status·payload·translations 만 고른다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(selectedColumns(call)).toEqual(["id", "status", "payload", "translations"].toSorted());
  });

  it("company_profiles 를 score_runs 의 company_profile_id 와 org_id 로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("company_profiles", "GET"));
    expect(eqValue(call, "id")).toBe(rows.scoreRun.company_profile_id);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      [
        "revision",
        "name",
        "is_demo",
        "technologies",
        "technologies_complete",
        "licenses",
        "industry_codes",
        "past_projects",
        "financials",
        "preferences",
      ].toSorted(),
    );
  });

  it("team_member_scoring 을 org_id 로 member_id 순서로 읽는다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("team_member_scoring", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(call.params.get("order")).toBe("member_id.asc");
    expect(selectedColumns(call)).toEqual(
      ["member_id", "role", "grade", "skills", "availability"].toSorted(),
    );
  });

  it("assignments 를 org_id 로 읽는다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("assignments", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      ["member_id", "starts_at", "ends_at", "allocation_percent"].toSorted(),
    );
  });

  it("조직 표(score_runs·company_profiles·team_member_scoring·assignments) 질의는 모두 org_id 조건이 있다", async () => {
    const { fake } = await load();
    const orgCalls = fake.calls.filter((call) => ORG_TABLES.includes(call.table));
    expect(orgCalls).toHaveLength(ORG_TABLES.length);
    for (const call of orgCalls) expect(eqValue(call, "org_id")).toBe(ORG_ID);
  });

  it("loader 는 읽기만 한다(GET 외 요청이 없다)", async () => {
    const { fake } = await load();
    expect(fake.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("첨부는 AttachmentTextReader 로 그 run 의 revision_id 를 한 번 읽는다", async () => {
    const { attachments, rows } = await load();
    expect(attachments.reads).toEqual([rows.scoreRun.revision_id]);
  });

  it("읽은 행을 toLoadedContext 로 바꾼 값을 돌려준다", async () => {
    const { loaded, rows } = await load();
    expect(loaded).toEqual(toLoadedContext(rows));
  });

  it("추출 행이 없으면 extraction 이 null 인 값을 돌려준다", async () => {
    const { loaded } = await load({
      route: on("GET", "requirement_extractions", { status: 200, body: [] }),
    });
    expect(loaded?.extraction).toBeNull();
  });

  it("cacheKey 가 null 이어도 읽은 성공 행을 extraction 으로 돌려준다(S6 캐시 재사용)", async () => {
    const { loaded, rows } = await load({ cacheKey: null });
    expect(loaded?.extraction?.id).toBe(rows.extraction?.id);
  });
});

describe("loader.load · 없음", () => {
  it("score_runs 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({ route: on("GET", "score_runs", { status: 200, body: [] }) });
    expect(loaded).toBeNull();
  });

  it("score_runs 행이 없으면 첨부를 읽지 않는다", async () => {
    const { attachments } = await load({
      route: on("GET", "score_runs", { status: 200, body: [] }),
    });
    expect(attachments.reads).toEqual([]);
  });

  it("revision 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({ route: on("GET", "bid_revisions", { status: 200, body: [] }) });
    expect(loaded).toBeNull();
  });

  it("회사 프로필 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({
      route: on("GET", "company_profiles", { status: 200, body: [] }),
    });
    expect(loaded).toBeNull();
  });
});

describe("loader.load · 질의 오류", () => {
  it.each([
    "score_runs",
    "bid_revisions",
    "bid_structured_requirements",
    "requirement_extractions",
    "company_profiles",
    "team_member_scoring",
    "assignments",
  ])("%s 질의 오류는 'analysis store 오류: <표>.<동작> <code>' 로 던진다", async (table) => {
    const error = await rejectionOf(load({ route: on("GET", table, postgrestError("42501")) }));
    expect(error.message).toMatch(new RegExp(`^analysis store 오류: ${table}\\.\\S+ 42501$`));
  });

  it("오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다", async () => {
    const error = await rejectionOf(
      load({ route: on("GET", "score_runs", postgrestError("42501")) }),
    );
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const error = await rejectionOf(
      load({ route: on("GET", "team_member_scoring", postgrestError(null)) }),
    );
    expect(error.message).toMatch(/^analysis store 오류: team_member_scoring\.\S+ UNKNOWN$/);
  });
});

// ── extraction ──

describe("extraction.loadSource", () => {
  async function loadSource() {
    const rows = loaderRows();
    const fake = fakeSupabase(loaderRoute(rows));
    const attachments = fakeAttachments();
    const stores = createAnalysisStores(fake.client, attachments.reader);
    const context = contextFromLoaded(toLoadedContext(rows), "req-1");
    const source = await stores.extraction.loadSource(context);
    return { source, fake, attachments, context, rows };
  }

  it("bid_revisions 의 normalized 를 context 의 revisionId·bidId 로 한 행 읽는다", async () => {
    const { fake, context } = await loadSource();
    const call = only(fake.callsTo("bid_revisions", "GET"));
    expect(eqValue(call, "id")).toBe(context.bid.revisionId);
    expect(eqValue(call, "bid_id")).toBe(context.bidId);
    expect(selectedColumns(call)).toEqual(["normalized"]);
  });

  it("첨부는 context 의 revisionId 로 읽는다", async () => {
    const { attachments, context } = await loadSource();
    expect(attachments.reads).toEqual([context.bid.revisionId]);
  });

  it("본문은 normalized.content, 첨부는 텍스트가 있는 문서다", async () => {
    const { source, rows } = await loadSource();
    expect(rows.revision.normalized).toMatchObject({ content: source.body });
    expect(source.attachments).toEqual([
      { documentId: "doc-1", text: "가상 제안요청서 본문", pages: [{ page: 1, charOffset: 0 }] },
    ]);
  });

  it("revision 이 없으면 analysis store 오류로 던진다", async () => {
    const rows = loaderRows();
    const fake = fakeSupabase(on("GET", "bid_revisions", postgrestError("PGRST116", 406)));
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    const context = contextFromLoaded(toLoadedContext(rows), "req-1");
    const error = await rejectionOf(stores.extraction.loadSource(context));
    expect(error.message).toMatch(/^analysis store 오류: bid_revisions\.\S+ PGRST116$/);
  });
});

// 보안 후속 (d): 추출 행은 조직 표가 아니라 (revision_id, model_name, prompt_hash) 키로 여러 조직의 분석이 함께 쓴다(03 §2.1 재사용 키).
// 같은 키의 행이 이미 있으면 덮지 않고(on conflict do nothing) 그 행을 쓴다. 저장 뒤 같은 키로 다시 읽어 id 를 돌려준다.
// 예전 기대 "충돌 시 병합하는 upsert(merge-duplicates)" 와 "upsert 응답의 id" 는 이 결정으로 바뀌었다(병합은 남의 분석이 쓰는 행을 덮는다).

describe("extraction.save", () => {
  const extraction = loadExtraction("FX-01");
  const record = toExtractionRecord(buildContext("FX-01"), extractBody(extraction), extraction);
  const ROW = toExtractionRow(record);
  const SAVED_ID = "6b5a4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d";
  const EXISTING_ID = "7c6b5a4d-3e2f-4b1a-8d9c-0e1f2a3b4c5d";
  const KEY_COLUMNS = ["revision_id", "model_name", "prompt_hash"] as const;

  /** 먼저 저장된 같은 키의 추출(다른 조직의 분석이 만든 행). 값은 이번 record 와 다르다. */
  const existingRow = (): FakeRow => ({
    ...ROW,
    id: EXISTING_ID,
    payload: { marker: "먼저 저장된 추출" },
    translations: { marker: "먼저 저장된 번역" },
    latency_ms: 1,
    created_at: "2026-10-16T08:00:00+00:00",
  });

  /**
   * requirement_extractions 표 흉내. 키(revision_id, model_name, prompt_hash)가 유일하다.
   * POST 는 Prefer resolution 대로 한다(merge-duplicates 는 덮고, ignore-duplicates 는 아무것도 하지 않고, 없으면 23505).
   * GET 은 필터를 그대로 적용해 고른다(filteredReply).
   */
  function extractionTable(initial: FakeRow[] = []) {
    const rows: FakeRow[] = initial.map((row) => ({ ...row }));
    const sameKey = (a: FakeRow, b: FakeRow) =>
      KEY_COLUMNS.every((column) => a[column] === b[column]);
    const route: PostgrestRoute = (call) => {
      if (call.table !== "requirement_extractions") return undefined;
      if (call.method === "GET") return filteredReply(call, rows);
      if (call.method !== "POST") return undefined;
      const touched: FakeRow[] = [];
      for (const body of bodyRows(call)) {
        const existing = rows.find((row) => sameKey(row, body));
        if (existing === undefined) {
          const inserted = { id: SAVED_ID, created_at: "2026-10-16T09:00:00+00:00", ...body };
          rows.push(inserted);
          touched.push(inserted);
        } else if (call.prefer.includes("resolution=merge-duplicates")) {
          Object.assign(existing, body);
          touched.push(existing);
        } else if (!call.prefer.includes("resolution=ignore-duplicates")) {
          return postgrestError("23505", 409);
        }
      }
      return call.prefer.includes("return=representation")
        ? projectedReply(call, touched, 201)
        : { status: 201 };
    };
    return { rows, route };
  }

  async function save(route: PostgrestRoute = extractionTable().route) {
    const fake = fakeSupabase(route);
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    return { promise: stores.extraction.save(record), fake };
  }

  it("requirement_extractions 에 (revision_id, model_name, prompt_hash) 충돌 시 아무것도 하지 않는 upsert(resolution=ignore-duplicates)를 보낸다", async () => {
    const { promise, fake } = await save();
    await promise;
    const call = only(fake.callsTo("requirement_extractions", "POST"));
    expect(conflictColumns(call)).toEqual(["model_name", "prompt_hash", "revision_id"]);
    expect(call.prefer).toContain("resolution=ignore-duplicates");
  });

  it("저장은 병합 upsert 가 아니다(resolution=merge-duplicates 가 없다)", async () => {
    const { promise, fake } = await save();
    await promise;
    expect(only(fake.callsTo("requirement_extractions", "POST")).prefer).not.toContain(
      "resolution=merge-duplicates",
    );
  });

  it("upsert 행은 toExtractionRow(record) 다", async () => {
    const { promise, fake } = await save();
    await promise;
    expect(bodyRows(only(fake.callsTo("requirement_extractions", "POST")))).toEqual([ROW]);
  });

  it("넣은 뒤 같은 키로 다시 읽는다(POST → GET)", async () => {
    const { promise, fake } = await save();
    await promise;
    expect(fake.sequence()).toEqual([
      "POST requirement_extractions",
      "GET requirement_extractions",
    ]);
  });

  it("다시 읽기는 저장한 행의 revision_id·model_name·prompt_hash 로 거르고 id 만 고른다", async () => {
    const { promise, fake } = await save();
    await promise;
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    for (const column of KEY_COLUMNS) expect(eqValue(call, column)).toBe(String(ROW[column]));
    expect(selectedColumns(call)).toEqual(["id"]);
  });

  it("새 키면 넣은 행의 id 를 { id } 로 돌려준다", async () => {
    const table = extractionTable();
    const { promise } = await save(table.route);
    await expect(promise).resolves.toEqual({ id: SAVED_ID });
    expect(table.rows.map((row) => row.id)).toEqual([SAVED_ID]);
  });

  it("같은 키의 행이 이미 있으면 그 행을 덮지 않는다(먼저 저장된 추출을 그대로 둔다)", async () => {
    const table = extractionTable([existingRow()]);
    const { promise } = await save(table.route);
    await promise;
    expect(table.rows).toEqual([existingRow()]);
  });

  it("같은 키의 행이 이미 있으면 그 행의 id 를 돌려준다", async () => {
    const table = extractionTable([existingRow()]);
    const { promise } = await save(table.route);
    await expect(promise).resolves.toEqual({ id: EXISTING_ID });
  });

  it("다른 키의 행만 있으면 덮지 않고 새 행을 넣어 그 id 를 돌려준다", async () => {
    const other: FakeRow = { ...existingRow(), prompt_hash: "0".repeat(64) };
    const table = extractionTable([other]);
    const { promise } = await save(table.route);
    await expect(promise).resolves.toEqual({ id: SAVED_ID });
    expect(table.rows[0]).toEqual(other);
    expect(table.rows).toHaveLength(2);
  });

  it("다시 읽어도 행이 없으면 'analysis store 오류: requirement_extractions.select NOT_FOUND' 를 던진다", async () => {
    // 넣기는 충돌로 아무것도 하지 않았는데 다시 읽을 때 행이 없다(그 사이 지워졌다).
    const route: PostgrestRoute = (call) => {
      if (call.table !== "requirement_extractions") return undefined;
      if (call.method === "POST") return projectedReply(call, [], 201);
      if (call.method === "GET") return filteredReply(call, []);
      return undefined;
    };
    const { promise } = await save(route);
    const error = await rejectionOf(promise);
    expect(error.message).toBe("analysis store 오류: requirement_extractions.select NOT_FOUND");
  });

  it("upsert 오류면 analysis store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { promise } = await save(on("POST", "requirement_extractions", postgrestError("23514")));
    const error = await rejectionOf(promise);
    expect(error.message).toMatch(/^analysis store 오류: requirement_extractions\.\S+ 23514$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("다시 읽기 오류면 analysis store 오류로 던지고 message 를 싣지 않는다", async () => {
    const table = extractionTable();
    const { promise } = await save(
      routes(on("GET", "requirement_extractions", postgrestError("42501")), table.route),
    );
    const error = await rejectionOf(promise);
    expect(error.message).toMatch(/^analysis store 오류: requirement_extractions\.\S+ 42501$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── tracker ──

// run 잡기·닫기는 compare-and-set 이다. markRunning·markFailed 는 읽은 시점의 run 상태(expected: status·started_at 원문)를
// 쓰기 조건으로 건다. 그 사이 다른 시도가 잡았거나 끝냈으면 0행이다. markRunning 은 잡았는지(1행)를 돌려준다.
// 예전 기대(markRunning·markFailed 의 status in (QUEUED, RUNNING) 조건, markFailed 의 선택 attemptStartedAt 경로,
// markRunning 반환 void)는 이 결정으로 바뀌었다.

describe("tracker", () => {
  /** PostgREST 가 준 started_at 원문(마이크로초·오프셋). Date 로 바꾸면 이 값과 같지 않다. */
  const RAW_STARTED_AT = "2026-10-16T08:58:00.123456+00:00";
  const QUEUED_CLAIM = { status: "QUEUED", startedAt: null } as const;
  const RUNNING_CLAIM = { status: "RUNNING", startedAt: RAW_STARTED_AT } as const;

  const running = {
    orgId: ORG_ID,
    scoreRunId: RUN_ID,
    runMode: "mock" as const,
    aiProvider: "mock" as const,
    startedAt: "2026-10-16T09:00:00.000Z",
    expected: QUEUED_CLAIM,
  };
  const failed = {
    orgId: ORG_ID,
    scoreRunId: RUN_ID,
    errorCode: "ANALYSIS_JOB_FAILED",
    finishedAt: "2026-10-16T09:00:05.000Z",
    expected: RUNNING_CLAIM,
  };

  function stores(route?: PostgrestRoute) {
    const fake = fakeSupabase(route);
    return { stores: createAnalysisStores(fake.client, fakeAttachments().reader), fake };
  }

  describe("markRunning", () => {
    it("QUEUED 로 읽었으면 id·org_id·status=eq.QUEUED·started_at=is.null 조건으로 갱신한다", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markRunning(running);
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(eqValue(call, "id")).toBe(RUN_ID);
      expect(eqValue(call, "org_id")).toBe(ORG_ID);
      expect(call.params.getAll("status")).toEqual(["eq.QUEUED"]);
      expect(call.params.getAll("started_at")).toEqual(["is.null"]);
    });

    it("RUNNING 으로 읽었으면 status=eq.RUNNING·started_at=eq.<읽은 원문> 조건으로 갱신한다", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markRunning({ ...running, expected: RUNNING_CLAIM });
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(call.params.getAll("status")).toEqual(["eq.RUNNING"]);
      expect(call.params.getAll("started_at")).toEqual([`eq.${RAW_STARTED_AT}`]);
    });

    it("status in (QUEUED, RUNNING) 조건을 걸지 않는다(읽은 상태 하나만 받는다)", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markRunning(running);
      expect(inValues(only(fake.callsTo("score_runs", "PATCH")), "status")).toBeUndefined();
    });

    it("본문은 toRunningUpdate(input) 다(expected 는 본문에 없다)", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markRunning(running);
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(call.body).toEqual(toRunningUpdate(running));
      expect(Object.keys(bodyRows(call)[0] ?? {})).not.toContain("expected");
    });

    it("바뀐 행을 돌려받는다(Prefer return=representation, select=id)", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markRunning(running);
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(call.prefer).toContain("return=representation");
      expect(selectedColumns(call)).toEqual(["id"]);
    });

    it("한 행이 바뀌면 true 다(이 시도가 run 을 잡았다)", async () => {
      const { stores: store } = stores(
        on("PATCH", "score_runs", { status: 200, body: [{ id: RUN_ID }] }),
      );
      await expect(store.tracker.markRunning(running)).resolves.toBe(true);
    });

    it("0행이면 false 다(그 사이 다른 시도가 잡았거나 끝냈다)", async () => {
      const { stores: store } = stores(on("PATCH", "score_runs", { status: 200, body: [] }));
      await expect(store.tracker.markRunning(running)).resolves.toBe(false);
    });

    it("갱신 오류면 analysis store 오류로 던진다", async () => {
      const { stores: store } = stores(on("PATCH", "score_runs", postgrestError("40001")));
      const error = await rejectionOf(store.tracker.markRunning(running));
      expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 40001$/);
    });
  });

  describe("markFailed", () => {
    it("RUNNING 으로 읽었으면 id·org_id·status=eq.RUNNING·started_at=eq.<읽은 원문> 조건으로 갱신한다", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markFailed(failed);
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(eqValue(call, "id")).toBe(RUN_ID);
      expect(eqValue(call, "org_id")).toBe(ORG_ID);
      expect(call.params.getAll("status")).toEqual(["eq.RUNNING"]);
      expect(call.params.getAll("started_at")).toEqual([`eq.${RAW_STARTED_AT}`]);
    });

    it("QUEUED 로 읽었으면 status=eq.QUEUED·started_at=is.null 조건으로 갱신한다", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markFailed({ ...failed, expected: QUEUED_CLAIM });
      const call = only(fake.callsTo("score_runs", "PATCH"));
      expect(call.params.getAll("status")).toEqual(["eq.QUEUED"]);
      expect(call.params.getAll("started_at")).toEqual(["is.null"]);
    });

    it("조건 없는 status in (QUEUED, RUNNING) 닫기가 없다", async () => {
      for (const expected of [QUEUED_CLAIM, RUNNING_CLAIM]) {
        const { stores: store, fake } = stores();
        await store.tracker.markFailed({ ...failed, expected });
        expect(inValues(only(fake.callsTo("score_runs", "PATCH")), "status")).toBeUndefined();
      }
    });

    it("본문은 FAILED·error_code·finished_at 뿐이다(started_at·expected 는 바꾸지 않는다)", async () => {
      const { stores: store, fake } = stores();
      await store.tracker.markFailed(failed);
      const body = only(fake.callsTo("score_runs", "PATCH")).body;
      expect(body).toEqual(toFailedUpdate(failed));
      expect(body).toEqual({
        status: "FAILED",
        error_code: "ANALYSIS_JOB_FAILED",
        finished_at: "2026-10-16T09:00:05.000Z",
      });
    });

    it("0행이 바뀌어도(다른 시도가 잡았거나 끝냈다) 던지지 않는다", async () => {
      const { stores: store } = stores(on("PATCH", "score_runs", { status: 200, body: [] }));
      await expect(store.tracker.markFailed(failed)).resolves.toBeUndefined();
    });

    it("갱신 오류면 analysis store 오류로 던진다", async () => {
      const { stores: store } = stores(on("PATCH", "score_runs", postgrestError("40001")));
      const error = await rejectionOf(store.tracker.markFailed(failed));
      expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 40001$/);
    });
  });

  // 메모리 score_runs 한 행에 요청의 필터를 그대로 적용해(filteredReply) 어떤 시도가 run 을 잡는지 본다.
  describe("compare-and-set · 메모리 행", () => {
    const OTHER_STARTED_AT = "2026-10-16T09:00:00.500000+00:00";

    /** 지금 run 행에 맞는 PATCH 만 바꾼 행(id)을 돌려준다. */
    function storesOver(row: FakeRow) {
      return stores((call) =>
        call.method === "PATCH" && call.table === "score_runs"
          ? filteredReply(call, [row])
          : undefined,
      );
    }
    const runRow = (status: string, startedAt: string | null): FakeRow => ({
      id: RUN_ID,
      org_id: ORG_ID,
      status,
      started_at: startedAt,
    });

    it("읽은 그대로(QUEUED·started_at null)면 markRunning 이 true 다", async () => {
      const { stores: store } = storesOver(runRow("QUEUED", null));
      await expect(store.tracker.markRunning(running)).resolves.toBe(true);
    });

    it("QUEUED 로 읽은 뒤 다른 시도가 잡았으면(RUNNING) markRunning 이 false 다", async () => {
      const { stores: store } = storesOver(runRow("RUNNING", OTHER_STARTED_AT));
      await expect(store.tracker.markRunning(running)).resolves.toBe(false);
    });

    it("RUNNING 으로 읽은 뒤 다른 시도가 다시 잡았으면(started_at 이 바뀜) markRunning 이 false 다", async () => {
      const { stores: store } = storesOver(runRow("RUNNING", OTHER_STARTED_AT));
      await expect(
        store.tracker.markRunning({ ...running, expected: RUNNING_CLAIM }),
      ).resolves.toBe(false);
    });

    it("RUNNING 으로 읽은 뒤 run 이 끝났으면(COMPLETED) markRunning 이 false 다", async () => {
      const { stores: store } = storesOver(runRow("COMPLETED", RAW_STARTED_AT));
      await expect(
        store.tracker.markRunning({ ...running, expected: RUNNING_CLAIM }),
      ).resolves.toBe(false);
    });
  });
});

// ── sink(보안 검토 후속) ──
// 결과 저장은 RPC finish_score_run(p) 한 번이다(20261019000011). 자식 3표·score_runs 마감을 한 트랜잭션으로 쓰고,
// 그 run 이 RUNNING 이고 started_at 이 이 시도의 시작 시각일 때만 쓴다. 예전 기대(자식 3표 → score_runs 마감의 다섯·여섯 요청,
// score_runs 마감이 0행이면 NOT_RUNNING)는 이 결정으로 바뀌었다. 거절은 DB 가 하고 sink 는 오류 코드만 옮긴다.

const FINISH_RPC = "rpc/finish_score_run";
const FINISHED: ReturnType<PostgrestRoute> = { status: 200, body: RECORD.scoreRunId };

function sinkStores(route?: PostgrestRoute) {
  const fake = fakeSupabase(routes(route ?? (() => undefined), on("POST", FINISH_RPC, FINISHED)));
  return { sink: createAnalysisStores(fake.client, fakeAttachments().reader).sink, fake };
}

/** PostgREST 가 plpgsql raise exception 을 돌려주는 모양(SQLSTATE P0001, message 가 곧 코드). */
function raised(message: string): ReturnType<PostgrestRoute> {
  return { status: 400, body: { code: "P0001", message, details: null, hint: null } };
}

describe("sink.save · finish_score_run 한 번", () => {
  it("FX-01 레코드에는 항목 판정·자격 판정이 있다(전제)", () => {
    expect(RECORD.result.requirementAssessments.length).toBeGreaterThan(0);
    expect(RECORD.result.qualificationChecks.length).toBeGreaterThan(0);
  });

  it("레코드의 attemptStartedAt 은 meta.startedAt 과 다르다(전제)", () => {
    expect(RECORD.attemptStartedAt).toEqual(expect.any(String));
    expect(RECORD.attemptStartedAt).not.toBe(RECORD.meta.startedAt);
  });

  it("POST /rpc/finish_score_run 한 번만 보낸다", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    expect(fake.sequence()).toEqual([`POST ${FINISH_RPC}`]);
  });

  it("자식 3표·score_runs 에 직접 쓰지 않는다(표 요청이 없다)", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    for (const table of [
      "score_factors",
      "requirement_assessments",
      "qualification_checks",
      "score_runs",
    ]) {
      expect(fake.callsTo(table)).toEqual([]);
    }
  });

  it("본문은 { p: toFinishScoreRunPayload(record) } 다", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    expect(only(fake.callsTo(FINISH_RPC, "POST")).body).toEqual({
      p: toFinishScoreRunPayload(RECORD),
    });
  });

  it("p 의 score_run_id·org_id·attempt_started_at 은 레코드의 scoreRunId·orgId·attemptStartedAt 이다", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    expect(only(fake.callsTo(FINISH_RPC, "POST")).body).toMatchObject({
      p: {
        score_run_id: RECORD.scoreRunId,
        org_id: RECORD.orgId,
        attempt_started_at: RECORD.attemptStartedAt,
      },
    });
  });

  it("p.run 에 started_at 이 없다(마감은 시도 시작 시각을 바꾸지 않는다)", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    expect(JSON.stringify(only(fake.callsTo(FINISH_RPC, "POST")).body)).not.toContain(
      '"started_at"',
    );
  });

  it("항목 판정·자격 판정이 없어도 RPC 한 번이고 p.assessments·p.checks 는 빈 배열이다", async () => {
    const record = withPatch(RECORD, (draft) => {
      draft.result.requirementAssessments = [];
      draft.result.qualificationChecks = [];
    });
    const { sink, fake } = sinkStores();
    await sink.save(record);
    expect(fake.sequence()).toEqual([`POST ${FINISH_RPC}`]);
    expect(only(fake.callsTo(FINISH_RPC, "POST")).body).toMatchObject({
      p: { assessments: [], checks: [] },
    });
  });

  it("RPC 가 성공하면 resolve 한다", async () => {
    const { sink } = sinkStores();
    await expect(sink.save(RECORD)).resolves.toBeUndefined();
  });
});

describe("sink.save · finish_score_run 오류", () => {
  it("SCORE_RUN_NOT_RUNNING 이면 'analysis store 오류: score_runs.finish NOT_RUNNING' 을 던진다", async () => {
    const { sink } = sinkStores(on("POST", FINISH_RPC, raised("SCORE_RUN_NOT_RUNNING")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish NOT_RUNNING");
  });

  it("SCORE_RUN_NOT_FOUND 면 'analysis store 오류: score_runs.finish NOT_FOUND' 를 던진다", async () => {
    const { sink } = sinkStores(on("POST", FINISH_RPC, raised("SCORE_RUN_NOT_FOUND")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish NOT_FOUND");
  });

  // 마감 status 는 COMPLETED·PARTIAL 만이다. 그 밖이면 DB 가 SCORE_RUN_INVALID_STATUS 로 거절한다.
  it("SCORE_RUN_INVALID_STATUS 면 'analysis store 오류: score_runs.finish INVALID_STATUS' 를 던진다", async () => {
    const { sink } = sinkStores(on("POST", FINISH_RPC, raised("SCORE_RUN_INVALID_STATUS")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish INVALID_STATUS");
  });

  it.each(["23514", "23503", "40001"])(
    "그 밖의 오류(%s)는 'analysis store 오류: score_runs.finish <code>' 이고 message·details·hint 를 싣지 않는다",
    async (code) => {
      const { sink } = sinkStores(on("POST", FINISH_RPC, postgrestError(code)));
      const error = await rejectionOf(sink.save(RECORD));
      expect(error.message).toBe(`analysis store 오류: score_runs.finish ${code}`);
      expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
    },
  );

  it("알려진 코드가 아닌 raise(P0001)는 message 를 코드로 쓰지 않고 P0001 만 싣는다", async () => {
    const { sink } = sinkStores(on("POST", FINISH_RPC, postgrestError("P0001")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish P0001");
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const { sink } = sinkStores(on("POST", FINISH_RPC, postgrestError(null, 500)));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish UNKNOWN");
  });

  it("오류가 나도 다른 요청을 더 보내지 않는다(재시도·되돌리기는 DB 트랜잭션과 job 몫)", async () => {
    const { sink, fake } = sinkStores(on("POST", FINISH_RPC, raised("SCORE_RUN_NOT_RUNNING")));
    await rejectionOf(sink.save(RECORD));
    expect(fake.sequence()).toEqual([`POST ${FINISH_RPC}`]);
  });
});

// ── staleRuns(멈춘 run 찾기, C5-B) ──
// 복구는 운영 작업이라 조직 조건 없이 모든 조직의 QUEUED·RUNNING run 을 본다(service role). 처리할 때는 행의 org_id 를 쓴다.

// 복구는 id keyset 페이지로 읽는다. 입력의 after 는 앞 페이지 마지막 run 의 id(첫 페이지는 null)이고 정렬은 id 다.
// StaleRun 은 markFailed 의 쓰기 조건으로 started_at 원문(startedAt)을 갖는다. 예전 기대((queued_at, id) 커서·정렬과
// StaleRun.queuedAt)는 밀리초 커서가 같은 밀리초 안의 run 을 다음 페이지에 다시 내던 문제로 바뀌었다. 처리 순서는 오래된 순이 아니라 id 순이다.

describe("staleRuns.findStaleRuns · 질의", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 7,
    after: null,
  };
  const AFTER_ID = "00000000-0000-4000-8000-000000000003";

  async function find(
    input: Parameters<analysisBarrel.StaleRunFinder["findStaleRuns"]>[0] = INPUT,
  ) {
    const fake = fakeSupabase();
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    await stores.staleRuns.findStaleRuns(input);
    return fake;
  }

  it("score_runs 를 GET 한 번으로 읽는다", async () => {
    const fake = await find();
    expect(fake.sequence()).toEqual(["GET score_runs"]);
  });

  it("id·org_id·idempotency_key·status·started_at 열만 고른다(queued_at 은 읽지 않는다)", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(selectedColumns(call)).toEqual(
      ["id", "org_id", "idempotency_key", "status", "started_at"].toSorted(),
    );
  });

  it("status in (QUEUED, RUNNING) 조건을 건다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(inValues(call, "status")).toEqual(["QUEUED", "RUNNING"]);
  });

  it("or 조건은 QUEUED 는 queued_at, RUNNING 은 started_at 을 각 기준 시각과 lt 로 비교한다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("or")).toBe(
      "(and(status.eq.QUEUED,queued_at.lt.2026-10-16T08:50:00.000Z),and(status.eq.RUNNING,started_at.lt.2026-10-16T08:40:00.000Z))",
    );
  });

  it("or 조건에 받은 기준 시각을 그대로 넣는다", async () => {
    const call = only(
      (
        await find({
          queuedBefore: "2026-01-02T03:04:05.678Z",
          runningBefore: "2025-12-31T23:59:59.999Z",
          limit: 1,
          after: null,
        })
      ).callsTo("score_runs", "GET"),
    );
    expect(call.params.get("or")).toBe(
      "(and(status.eq.QUEUED,queued_at.lt.2026-01-02T03:04:05.678Z),and(status.eq.RUNNING,started_at.lt.2025-12-31T23:59:59.999Z))",
    );
  });

  it("id 오름차순으로만 정렬한다(queued_at 으로 정렬하지 않는다)", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("order")).toBe("id.asc");
  });

  it("limit 건까지만 읽는다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("limit")).toBe("7");
  });

  it("org_id 조건을 걸지 않는다(모든 조직의 멈춘 run 을 본다)", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.has("org_id")).toBe(false);
  });

  it("after 가 null 이면 id 조건을 걸지 않는다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.has("id")).toBe(false);
  });

  it("after 가 있으면 id=gt.<after.id> 조건을 건다", async () => {
    const call = only(
      (await find({ ...INPUT, after: { id: AFTER_ID } })).callsTo("score_runs", "GET"),
    );
    expect(call.params.getAll("id")).toEqual([`gt.${AFTER_ID}`]);
  });

  it("after 가 있어도 queued_at 커서 조건이 없다(or 는 멈춘 run 조건 하나뿐이다)", async () => {
    const call = only(
      (await find({ ...INPUT, after: { id: AFTER_ID } })).callsTo("score_runs", "GET"),
    );
    expect(call.params.getAll("or")).toEqual([
      "(and(status.eq.QUEUED,queued_at.lt.2026-10-16T08:50:00.000Z),and(status.eq.RUNNING,started_at.lt.2026-10-16T08:40:00.000Z))",
    ]);
    expect(call.params.toString()).not.toContain("queued_at.gt");
  });
});

describe("staleRuns.findStaleRuns · 결과", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 50,
    after: null,
  };
  const OTHER_RUN_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
  /** PostgREST 가 준 started_at 원문(마이크로초·오프셋). */
  const RAW_STARTED_AT = "2026-10-16T08:31:02.500123+00:00";

  async function findWith(reply: ReturnType<PostgrestRoute>) {
    const fake = fakeSupabase(on("GET", "score_runs", reply));
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    return stores.staleRuns.findStaleRuns(INPUT);
  }

  it("행을 { orgId, scoreRunId, idempotencyKey, status, startedAt } 로 바꿔 받은 순서대로 돌려준다", async () => {
    const runs = await findWith({
      status: 200,
      body: [
        {
          id: RUN_ID,
          org_id: ORG_ID,
          idempotency_key: `${ORG_ID}:req-1`,
          status: "QUEUED",
          started_at: null,
        },
        {
          id: OTHER_RUN_ID,
          org_id: OTHER_ORG_ID,
          idempotency_key: null,
          status: "RUNNING",
          started_at: RAW_STARTED_AT,
        },
      ],
    });
    expect(runs).toEqual([
      {
        orgId: ORG_ID,
        scoreRunId: RUN_ID,
        idempotencyKey: `${ORG_ID}:req-1`,
        status: "QUEUED",
        startedAt: null,
      },
      {
        orgId: OTHER_ORG_ID,
        scoreRunId: OTHER_RUN_ID,
        idempotencyKey: null,
        status: "RUNNING",
        startedAt: RAW_STARTED_AT,
      },
    ]);
  });

  it("startedAt 은 started_at 원문 그대로다(Date 로 바꾸지 않는다, markFailed 의 쓰기 조건)", async () => {
    const [run] = await findWith({
      status: 200,
      body: [
        {
          id: RUN_ID,
          org_id: ORG_ID,
          idempotency_key: `${ORG_ID}:req-1`,
          status: "RUNNING",
          started_at: "2026-10-16T17:31:02.500123+09:00",
        },
      ],
    });
    expect(run?.startedAt).toBe("2026-10-16T17:31:02.500123+09:00");
  });

  it("행이 없으면 빈 목록을 돌려준다", async () => {
    await expect(findWith({ status: 200, body: [] })).resolves.toEqual([]);
  });
});

describe("staleRuns.findStaleRuns · 질의 오류", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 50,
    after: null,
  };

  function findWith(reply: ReturnType<PostgrestRoute>) {
    const fake = fakeSupabase(on("GET", "score_runs", reply));
    return createAnalysisStores(fake.client, fakeAttachments().reader).staleRuns.findStaleRuns(
      INPUT,
    );
  }

  it("질의 오류는 'analysis store 오류: score_runs.<동작> <code>' 로 던진다", async () => {
    const error = await rejectionOf(findWith(postgrestError("42501")));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 42501$/);
  });

  it("오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다", async () => {
    const error = await rejectionOf(findWith(postgrestError("42501")));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const error = await rejectionOf(findWith(postgrestError(null)));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ UNKNOWN$/);
  });
});

// keyset 페이지. 필터 문자열의 모양은 구현이 고른다. 시험은 메모리 score_runs 표에 요청의 필터를 그대로 적용해(filteredReply)
// 어떤 행이 골라지는지만 본다.

describe("staleRuns.findStaleRuns · keyset 페이지(after)", () => {
  const QUEUED_BEFORE = "2026-10-16T08:50:00.000Z";
  const RUNNING_BEFORE = "2026-10-16T08:40:00.000Z";
  const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const at = (hhmm: string) => `2026-10-16T${hhmm}:00.000Z`;

  type Cursor = { id: string };

  /** score_runs 행(PostgREST 가 돌려주는 시각 모양). 조직은 번갈아 둔다. */
  function runRow(n: number, status: string, queuedAt: string, startedAt: string | null = null) {
    const orgId = n % 2 === 0 ? ORG_ID : OTHER_ORG_ID;
    return {
      id: runId(n),
      org_id: orgId,
      idempotency_key: `${orgId}:req-${n}`,
      status,
      queued_at: toPostgrestTimestamp(queuedAt),
      started_at: startedAt === null ? null : toPostgrestTimestamp(startedAt),
    };
  }

  // 멈춘 run: 1(08:46) · 2(08:45) · 3(08:30) · 4(08:05) · 5(RUNNING, 08:36 시작) · 6(08:10). 나머지는 멈춘 run 이 아니다.
  // queued_at 순서(4·6·3·5·2·1)가 id 순서와 달라 정렬이 id 만 보는지 드러낸다.
  const TABLE: FakeRow[] = [
    runRow(9, "QUEUED", at("08:55")),
    runRow(4, "QUEUED", at("08:05")),
    runRow(6, "QUEUED", at("08:10")),
    runRow(7, "RUNNING", at("08:38"), at("08:45")),
    runRow(2, "QUEUED", at("08:45")),
    runRow(8, "COMPLETED", at("08:31")),
    runRow(5, "RUNNING", at("08:35"), at("08:36")),
    runRow(10, "RUNNING", at("08:10"), at("08:41")),
    runRow(3, "QUEUED", at("08:30")),
    runRow(11, "FAILED", at("08:05")),
    runRow(1, "QUEUED", at("08:46")),
  ];
  const STALE_IDS = [1, 2, 3, 4, 5, 6].map(runId);

  function finder(table: readonly FakeRow[] = TABLE) {
    const fake = fakeSupabase((call) =>
      call.method === "GET" && call.table === "score_runs" ? filteredReply(call, table) : undefined,
    );
    const { staleRuns } = createAnalysisStores(fake.client, fakeAttachments().reader);
    const page = (limit: number, after: Cursor | null) =>
      staleRuns.findStaleRuns({
        queuedBefore: QUEUED_BEFORE,
        runningBefore: RUNNING_BEFORE,
        limit,
        after,
      });
    return { page, fake };
  }

  const idsOf = (runs: { scoreRunId: string }[]) => runs.map((run) => run.scoreRunId);

  /** limit 건씩 앞 페이지 마지막 run 의 id 를 after 로 넘겨 끝까지 읽는다(최대 rounds 페이지). */
  async function readAll(page: ReturnType<typeof finder>["page"], limit: number, rounds: number) {
    const seen: string[] = [];
    let after: Cursor | null = null;
    for (let round = 0; round < rounds; round += 1) {
      const runs = await page(limit, after);
      if (runs.length === 0) break;
      seen.push(...idsOf(runs));
      after = { id: runs[runs.length - 1].scoreRunId };
    }
    return seen;
  }

  it("after 가 null 이면 멈춘 run 을 id 순서로 돌려준다(queued_at 순서가 아니다)", async () => {
    expect(idsOf(await finder().page(50, null))).toEqual(STALE_IDS);
  });

  it("after 가 null 이면 id 순서로 앞에서 limit 건만 돌려준다", async () => {
    expect(idsOf(await finder().page(3, null))).toEqual([1, 2, 3].map(runId));
  });

  it.each<[string, Cursor, number[]]>([
    ["모든 run 보다 작은 id 면 전부", { id: runId(0) }, [1, 2, 3, 4, 5, 6]],
    ["가운데 id 면 그보다 큰 것", { id: runId(3) }, [4, 5, 6]],
    ["after 와 같은 id 의 run 은 뺀다", { id: runId(4) }, [5, 6]],
    ["마지막 멈춘 run 의 id 면 없음", { id: runId(6) }, []],
    ["모든 run 보다 큰 id 면 없음", { id: runId(99) }, []],
  ])(
    "after 를 주면 id 가 after.id 보다 큰 멈춘 run 만 돌려준다: %s",
    async (_label, after, expected) => {
      expect(idsOf(await finder().page(50, after))).toEqual(expected.map(runId));
    },
  );

  it("after 를 주어도 멈춘 run 조건(QUEUED·RUNNING, 각 기준 시각)은 그대로 건다", async () => {
    // 7(RUNNING, 08:45 시작)·8(COMPLETED)·9(08:55 QUEUED)·10(RUNNING, 08:41 시작)·11(FAILED)은 after 뒤여도 멈춘 run 이 아니다.
    const runs = await finder().page(50, { id: runId(5) });
    expect(idsOf(runs)).toEqual([6].map(runId));
  });

  it("after 를 주어도 limit 건까지만 돌려준다", async () => {
    const runs = await finder().page(2, { id: runId(1) });
    expect(idsOf(runs)).toEqual([2, 3].map(runId));
  });

  it("앞 페이지 마지막 run 의 id 를 after 로 넘기면 빠짐·겹침 없이 모든 멈춘 run 을 읽는다", async () => {
    // 행이 6개라 limit 2 면 세 페이지 뒤 빈 페이지다. 커서가 나아가지 않으면 같은 페이지를 되풀이한다.
    expect(await readAll(finder().page, 2, 6)).toEqual(STALE_IDS);
  });

  // 같은 queued_at(마이크로초까지 같은 원문)의 run 이 한 페이지보다 많아도 id 커서는 같은 run 을 다시 내지 않는다.
  it("같은 queued_at 의 멈춘 run 60건을 limit 50 두 페이지로 한 번씩 읽는다", async () => {
    const SAME_QUEUED_AT = "2026-10-16T08:30:00.000123+00:00";
    const many: FakeRow[] = Array.from({ length: 60 }, (_, index) => {
      const n = 60 - index; // id 역순으로 넣는다
      return { ...runRow(n, "QUEUED", at("08:30")), queued_at: SAME_QUEUED_AT };
    });
    const { page, fake } = finder(many);
    const seen = await readAll(page, 50, 5);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen).toEqual(Array.from({ length: 60 }, (_, index) => runId(index + 1)));
    // 50건·10건·0건 페이지로 끝난다(빈 페이지에서 멈춘다).
    expect(fake.calls).toHaveLength(3);
  });

  it("after 를 주어도 score_runs 를 GET 한 번으로 읽고 org_id 조건을 걸지 않는다", async () => {
    const { page, fake } = finder();
    await page(50, { id: runId(3) });
    const call = only(fake.calls);
    expect(`${call.method} ${call.table}`).toBe("GET score_runs");
    expect(call.params.has("org_id")).toBe(false);
  });
});

describe("staleRuns.findStaleRuns · 잘못된 after 는 필터에 넣지 않는다", () => {
  const VALID: { id: string } = { id: "00000000-0000-4000-8000-000000000003" };
  const INJECTED = "status.eq.COMPLETED";

  async function findWith(after: { id: string }) {
    const fake = fakeSupabase();
    const { staleRuns } = createAnalysisStores(fake.client, fakeAttachments().reader);
    const promise = staleRuns.findStaleRuns({
      queuedBefore: "2026-10-16T08:50:00.000Z",
      runningBefore: "2026-10-16T08:40:00.000Z",
      limit: 50,
      after,
    });
    return { error: await rejectionOf(promise), fake };
  }

  // 커서가 id 하나라 queuedAt 쪽 거절 사례는 없어졌다.
  const BAD: [string, { id: string }][] = [
    ["id 가 빈 값", { id: "" }],
    ["id 가 uuid 가 아님", { id: "not-a-uuid" }],
    ["id 에 필터 조각", { id: `${VALID.id},${INJECTED}` }],
    ["id 에 닫는 괄호", { id: `${VALID.id})` }],
    ["id 에 16진수가 아닌 글자", { id: "00000000-0000-4000-8000-00000000000g" }],
  ];

  it.each(BAD)("%s 이면 analysis store 오류로 던진다", async (_label, after) => {
    const { error } = await findWith(after);
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ \S+$/);
  });

  it.each(BAD)("%s 이면 score_runs 를 읽지 않는다", async (_label, after) => {
    const { fake } = await findWith(after);
    expect(fake.calls).toEqual([]);
  });

  it.each(BAD)("%s 이면 오류 message 에 받은 값을 싣지 않는다", async (_label, after) => {
    const { error } = await findWith(after);
    expect(error.message).not.toContain(INJECTED);
    expect(error.message).not.toContain("not-a-");
  });
});

// ── 배럴 ──

describe("@/server/analysis 배럴 · 저장 port", () => {
  it.each(["createAnalysisStores", "EMPTY_ATTACHMENT_READER"])("값 %s 를 내보낸다", (name) => {
    expect(Object.keys(analysisBarrel)).toContain(name);
  });

  it.each([
    "toLoadedContext",
    "toExtractSource",
    "toExtractionRow",
    "toRunningUpdate",
    "toFailedUpdate",
    "toScoreRunResultUpdate",
    "toScoreFactorRows",
    "toQualificationCheckRows",
    "toRequirementAssessmentRows",
    "toFinishScoreRunPayload",
  ])("행 매핑 함수 %s 는 내보내지 않는다", (name) => {
    expect(Object.keys(analysisBarrel)).not.toContain(name);
  });

  it("배럴의 createAnalysisStores 는 analysis.repo 의 것이다", () => {
    expect(analysisBarrel.createAnalysisStores).toBe(createAnalysisStores);
  });

  // 등록 단계에서 멈춘 run 찾기(staleRuns)가 더해져 다섯 port 다.
  it("AnalysisStores 는 loader·tracker·extraction·sink·staleRuns 다섯 port 다", () => {
    expectTypeOf<AnalysisStores>().toEqualTypeOf<{
      loader: analysisBarrel.AnalysisContextLoader;
      tracker: analysisBarrel.AnalysisRunTracker;
      extraction: analysisBarrel.ExtractionStore;
      sink: analysisBarrel.AnalysisRunSink;
      staleRuns: analysisBarrel.StaleRunFinder;
    }>();
  });
});

describe("@/server/analysis 배럴 · 멈춘 run 찾기 port", () => {
  it("AnalysisStores.staleRuns 는 StaleRunFinder 다", () => {
    expectTypeOf<AnalysisStores["staleRuns"]>().toEqualTypeOf<analysisBarrel.StaleRunFinder>();
  });
});

// ── createPreanalyzeStore(사전 분석 `pnpm demo:preanalyze`, C5-B) ──
// worker 컨테이너에서 service role 클라이언트로 돈다. RLS 를 거치지 않으므로 조직 표(company_profiles·score_runs)의
// 모든 질의·쓰기에 org_id 를 직접 건다. score_runs 는 idempotency_key 충돌 시 아무것도 하지 않는(on conflict do nothing)
// insert 로 만들고 그 키로 다시 읽는다. 공고 행은 seed 의 행 계획 함수가 만든 것이다.

const PRE_RUN_ID = "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";
const PRE_OTHER_RUN_ID = "6c5d4e3f-2a1b-4c0d-8e9f-7a6b5c4d3e2f";
const FX01_TARGET = seedTargets().filter((target) => target.fixtureId === "FX-01")[0];
const FX01_EXTRACTION_ID = seedBid("FX-01").extraction.id;
const PRE_KEY = `${ORG_ID}:demo-pre-FX-01-r01`;

type EnsureInput = Parameters<PreanalyzeStore["ensureQueuedRun"]>[0];

/** ensureQueuedRun 입력(사전 분석 CLI 가 넘기는 값). */
const ENSURE_INPUT: EnsureInput = {
  orgId: ORG_ID,
  bidId: FX01_TARGET.bidId,
  revisionId: FX01_TARGET.revisionId,
  companyProfileId: SEED_PROFILE.id,
  profileRevision: SEED_PROFILE.revision,
  extractionId: FX01_EXTRACTION_ID,
  idempotencyKey: PRE_KEY,
};

/** 한 행 요청(object+json)이면 객체, 아니면 배열로 답한다. */
function rowsReply(call: PostgrestCall, rows: unknown[]): ReturnType<PostgrestRoute> {
  if (!call.accept.includes("vnd.pgrst.object+json")) return { status: 200, body: rows };
  return rows.length === 1 ? { status: 200, body: rows[0] } : postgrestError("PGRST116", 406);
}

/** 그 표 GET 에 rows 로 답한다. */
function getRows(table: string, rows: unknown[]): PostgrestRoute {
  return (call) =>
    call.method === "GET" && call.table === table ? rowsReply(call, rows) : undefined;
}

function preStore(route?: PostgrestRoute) {
  const fake = fakeSupabase(route);
  return { store: createPreanalyzeStore(fake.client), fake };
}

/**
 * 다시 읽은 run 행. 기본은 이 사전 분석이 넣은 run(requested_by null·입력과 같은 공고·revision·프로필)이다.
 * 다시 읽기가 이 판정 열까지 읽게 되어 예전 기대({ id, status } 두 열)에 넷을 더했다.
 */
const preRunRow = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: PRE_RUN_ID,
  status,
  requested_by: null,
  bid_id: ENSURE_INPUT.bidId,
  revision_id: ENSURE_INPUT.revisionId,
  company_profile_id: ENSURE_INPUT.companyProfileId,
  ...overrides,
});

/** 이미 있는 run 을 다시 읽은 것처럼 score_runs GET 에 그 행으로 답한다. */
const existingRun = (status: string, overrides: Record<string, unknown> = {}) =>
  getRows("score_runs", [preRunRow(status, overrides)]);

describe("createPreanalyzeStore · findDemoOrg", () => {
  it("organizations 를 slug=org-01·is_demo=true 로 id 만 골라 읽는다", async () => {
    const { store, fake } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await store.findDemoOrg();
    const call = only(fake.callsTo("organizations", "GET"));
    // 19 §1: 데모 조직은 솔리데오(org-01)다.
    expect(eqValue(call, "slug")).toBe("org-01");
    expect(eqValue(call, "is_demo")).toBe("true");
    expect(selectedColumns(call)).toEqual(["id"]);
  });

  it("찾으면 그 조직 id 를 돌려준다", async () => {
    const { store } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await expect(store.findDemoOrg()).resolves.toBe(ORG_ID);
  });

  it("없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("organizations", []));
    await expect(store.findDemoOrg()).resolves.toBeNull();
  });

  it("organizations 만 한 번 읽는다", async () => {
    const { store, fake } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await store.findDemoOrg();
    expect(fake.sequence()).toEqual(["GET organizations"]);
  });
});

describe("createPreanalyzeStore · latestProfile", () => {
  const PROFILE_ROW = { id: SEED_PROFILE.id, revision: SEED_PROFILE.revision };

  it("company_profiles 를 org_id 로 revision 내림차순 1행, id·revision 만 읽는다", async () => {
    const { store, fake } = preStore(getRows("company_profiles", [PROFILE_ROW]));
    await store.latestProfile(ORG_ID);
    const call = only(fake.callsTo("company_profiles", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(call.params.get("order")).toBe("revision.desc");
    expect(call.params.get("limit")).toBe("1");
    expect(selectedColumns(call)).toEqual(["id", "revision"]);
  });

  it("받은 orgId 를 그대로 org_id 조건에 쓴다", async () => {
    const { store, fake } = preStore(getRows("company_profiles", []));
    await store.latestProfile(OTHER_ORG_ID);
    expect(eqValue(only(fake.callsTo("company_profiles", "GET")), "org_id")).toBe(OTHER_ORG_ID);
  });

  it("최신 프로필의 { id, revision } 을 돌려준다", async () => {
    const { store } = preStore(getRows("company_profiles", [PROFILE_ROW]));
    await expect(store.latestProfile(ORG_ID)).resolves.toEqual({
      id: SEED_PROFILE.id,
      revision: SEED_PROFILE.revision,
    });
  });

  it("프로필이 없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("company_profiles", []));
    await expect(store.latestProfile(ORG_ID)).resolves.toBeNull();
  });
});

describe("createPreanalyzeStore · listDemoBids", () => {
  /** seed 공고 19건 + FX-06 r2(latest 2) + 대상 아닌 공고(g2b·데모 아님). */
  const tables = (): BidTables => withForeignBids(withRevision2(seedBidTables(), "FX-06"));

  async function list(source: BidTables = tables()) {
    const fake = fakeSupabase(bidTablesRoute(source));
    const rows = await createPreanalyzeStore(fake.client).listDemoBids();
    return { rows, fake, source };
  }

  const byRevisionId = (a: DemoBidRow, b: DemoBidRow) =>
    a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : 0;

  /** 데모 fixture 공고(seed 19건)의 revision 행 전부를 DemoBidRow 로. */
  const demoRows = (source: BidTables) =>
    toDemoBidRows(source).filter(
      (row) => row.bidId !== G2B_BID_ID && row.bidId !== NON_DEMO_BID_ID,
    );

  it("읽기만 한다(GET 외 요청이 없다)", async () => {
    const { fake } = await list();
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("bid_notices·bid_revisions 만 읽는다", async () => {
    const { fake } = await list();
    for (const call of fake.calls) expect(["bid_notices", "bid_revisions"]).toContain(call.table);
  });

  it("최신 revision 행(revision = latestRevision)을 데모 fixture 공고마다 하나씩 돌려준다", async () => {
    const { rows, source } = await list();
    const latest = rows.filter((row) => row.revision === row.latestRevision).toSorted(byRevisionId);
    const expected = demoRows(source)
      .filter((row) => row.revision === row.latestRevision)
      .toSorted(byRevisionId);
    expect(expected).toHaveLength(19);
    expect(latest).toEqual(expected);
  });

  it("행은 { bidId, revisionId, revision, rawPayload, latestRevision } 이고 값은 두 표의 값 그대로다", async () => {
    const { rows, source } = await list();
    const all = demoRows(source);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(all.find((candidate) => candidate.revisionId === row.revisionId)).toEqual(row);
    }
  });

  it("raw_payload 를 바꾸지 않고 그대로 싣는다(fixtureId 를 꺼낼 수 있다)", async () => {
    const { rows } = await list();
    const fx01 = rows.find((row) => row.revisionId === FX01_TARGET.revisionId);
    expect(fx01?.rawPayload).toMatchObject({ fixtureId: "FX-01" });
  });

  it("FX-06 은 latestRevision 2 로 읽고 r2 행이 있다", async () => {
    const { rows } = await list();
    const fx06 = rows.filter((row) => row.bidId === seedBid("FX-06").notice.id);
    expect(fx06.every((row) => row.latestRevision === 2)).toBe(true);
    expect(fx06.map((row) => row.revision)).toContain(2);
  });

  it("g2b 공고(source=g2b)는 is_demo=true 여도 돌려주지 않는다", async () => {
    const { rows } = await list();
    expect(rows.map((row) => row.bidId)).not.toContain(G2B_BID_ID);
  });

  it("데모가 아닌 공고(is_demo=false)는 source=fixture 여도 돌려주지 않는다", async () => {
    const { rows } = await list();
    expect(rows.map((row) => row.bidId)).not.toContain(NON_DEMO_BID_ID);
  });

  it("같은 revision 을 두 번 돌려주지 않는다", async () => {
    const { rows } = await list();
    const ids = rows.map((row) => row.revisionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("공고가 없으면 빈 목록이다", async () => {
    const { rows } = await list({ notices: [], revisions: [] });
    expect(rows).toEqual([]);
  });
});

describe("createPreanalyzeStore · latestExtractionId", () => {
  it("requirement_extractions 를 revision_id·성공 상태로 created_at 내림차순 1행, id 만 읽는다", async () => {
    const { store, fake } = preStore(
      getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]),
    );
    await store.latestExtractionId(FX01_TARGET.revisionId);
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(FX01_TARGET.revisionId);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
    expect(selectedColumns(call)).toEqual(["id"]);
  });

  it("찾으면 그 추출 id 를 돌려준다", async () => {
    const { store } = preStore(getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]));
    await expect(store.latestExtractionId(FX01_TARGET.revisionId)).resolves.toBe(
      FX01_EXTRACTION_ID,
    );
  });

  it("성공 추출이 없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("requirement_extractions", []));
    await expect(store.latestExtractionId(FX01_TARGET.revisionId)).resolves.toBeNull();
  });
});

describe("createPreanalyzeStore · ensureQueuedRun", () => {
  async function ensure(status = "QUEUED", input: EnsureInput = ENSURE_INPUT) {
    const { store, fake } = preStore(existingRun(status));
    const result = await store.ensureQueuedRun(input);
    return { result, fake };
  }

  it("score_runs 에 넣고 같은 키로 다시 읽는다(POST → GET)", async () => {
    const { fake } = await ensure();
    expect(fake.sequence()).toEqual(["POST score_runs", "GET score_runs"]);
  });

  it("넣기는 idempotency_key 충돌 시 아무것도 하지 않는다(Prefer resolution=ignore-duplicates)", async () => {
    const { fake } = await ensure();
    const call = only(fake.callsTo("score_runs", "POST"));
    expect(conflictColumns(call)).toEqual(["idempotency_key"]);
    expect(call.prefer).toContain("resolution=ignore-duplicates");
  });

  it("넣기는 병합 upsert 가 아니다(이미 있는 run 의 결과를 덮어쓰지 않는다)", async () => {
    const { fake } = await ensure();
    expect(only(fake.callsTo("score_runs", "POST")).prefer).not.toContain(
      "resolution=merge-duplicates",
    );
  });

  it("넣는 행은 조직·공고·revision·프로필·추출·ALGORITHM_VERSION·MOCK·MOCK·멱등 키 한 행이다", async () => {
    const { fake } = await ensure();
    expect(bodyRows(only(fake.callsTo("score_runs", "POST")))).toEqual([
      {
        org_id: ORG_ID,
        bid_id: FX01_TARGET.bidId,
        revision_id: FX01_TARGET.revisionId,
        company_profile_id: SEED_PROFILE.id,
        profile_revision: SEED_PROFILE.revision,
        extraction_id: FX01_EXTRACTION_ID,
        algorithm_version: ALGORITHM_VERSION,
        run_mode: "MOCK",
        ai_provider: "MOCK",
        idempotency_key: PRE_KEY,
      },
    ]);
  });

  it("추출이 없으면 extraction_id 는 null 이다", async () => {
    const { fake } = await ensure("QUEUED", { ...ENSURE_INPUT, extractionId: null });
    const [row] = bodyRows(only(fake.callsTo("score_runs", "POST")));
    expect(row).toHaveProperty("extraction_id", null);
  });

  // 같은 키의 run 이 이 사전 분석이 넣은 run 인지 가르려고 requested_by·bid_id·revision_id·company_profile_id 를 함께 읽는다.
  // 예전 기대(id·status 두 열)에 넷을 더했다.
  it("다시 읽기는 idempotency_key·org_id 조건이고 id·status·requested_by·bid_id·revision_id·company_profile_id 를 고른다", async () => {
    const { fake } = await ensure();
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(eqValue(call, "idempotency_key")).toBe(PRE_KEY);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      ["id", "status", "requested_by", "bid_id", "revision_id", "company_profile_id"].toSorted(),
    );
  });

  it("새로 만든 run 이면 { id, status: QUEUED } 를 돌려준다", async () => {
    const { result } = await ensure("QUEUED");
    expect(result).toEqual({ id: PRE_RUN_ID, status: "QUEUED" });
  });

  it("이미 끝난 run 이면 다시 읽은 상태(COMPLETED)를 그대로 돌려준다", async () => {
    const { result } = await ensure("COMPLETED");
    expect(result).toEqual({ id: PRE_RUN_ID, status: "COMPLETED" });
  });
});

// 같은 멱등 키의 run 을 화면 사용자가 먼저 넣었거나(requested_by 있음) 다른 공고·revision·프로필의 run 이면
// 사전 분석의 run 이 아니다. 돌려주지 않고 CONFLICT 로 던진다(CLI 는 그 대상을 준비 실패로 세고 큐에 넣지 않는다).
describe("createPreanalyzeStore · ensureQueuedRun 이 남이 넣은 run 을 돌려주지 않는다", () => {
  const CONFLICT = "analysis store 오류: score_runs.select CONFLICT";
  const SOMEONE = "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918";
  const OTHER_ID = "8f7e6d5c-4b3a-4291-8a0f-9e8d7c6b5a49";

  const CASES: [string, Record<string, unknown>][] = [
    ["requested_by 가 있다(화면 사용자가 넣은 run)", { requested_by: SOMEONE }],
    ["bid_id 가 입력과 다르다", { bid_id: OTHER_ID }],
    ["revision_id 가 입력과 다르다", { revision_id: OTHER_ID }],
    ["company_profile_id 가 입력과 다르다", { company_profile_id: OTHER_ID }],
  ];

  it.each(CASES)(
    "%s 면 'analysis store 오류: score_runs.select CONFLICT' 를 던진다",
    async (_label, overrides) => {
      const { store } = preStore(existingRun("QUEUED", overrides));
      const error = await rejectionOf(store.ensureQueuedRun(ENSURE_INPUT));
      expect(error.message).toBe(CONFLICT);
    },
  );

  it.each(CASES)(
    "%s 여도 오류 message 에 읽은 행의 값을 싣지 않는다",
    async (_label, overrides) => {
      const { store } = preStore(existingRun("COMPLETED", overrides));
      const error = await rejectionOf(store.ensureQueuedRun(ENSURE_INPUT));
      for (const value of [SOMEONE, OTHER_ID, PRE_RUN_ID])
        expect(error.message).not.toContain(value);
    },
  );

  it("requested_by 가 null 이고 공고·revision·프로필이 입력과 같으면 run 을 돌려준다", async () => {
    const { store } = preStore(existingRun("RUNNING"));
    await expect(store.ensureQueuedRun(ENSURE_INPUT)).resolves.toEqual({
      id: PRE_RUN_ID,
      status: "RUNNING",
    });
  });
});

describe("createPreanalyzeStore · readStatuses", () => {
  const ROWS = [
    { id: PRE_RUN_ID, status: "COMPLETED" },
    { id: PRE_OTHER_RUN_ID, status: "RUNNING" },
  ];

  it("score_runs 를 id in (…)·org_id 로 id·status 만 읽는다", async () => {
    const { store, fake } = preStore(getRows("score_runs", ROWS));
    await store.readStatuses(ORG_ID, [PRE_RUN_ID, PRE_OTHER_RUN_ID]);
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(inValues(call, "id")).toEqual([PRE_RUN_ID, PRE_OTHER_RUN_ID].toSorted());
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(["id", "status"]);
  });

  it("행을 { id, status } 로 돌려준다", async () => {
    const { store } = preStore(getRows("score_runs", ROWS));
    const statuses = await store.readStatuses(ORG_ID, [PRE_RUN_ID, PRE_OTHER_RUN_ID]);
    expect(statuses.toSorted((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      ROWS.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it("읽기만 한다", async () => {
    const { store, fake } = preStore(getRows("score_runs", ROWS));
    await store.readStatuses(ORG_ID, [PRE_RUN_ID]);
    expect(fake.sequence()).toEqual(["GET score_runs"]);
  });
});

describe("createPreanalyzeStore · 조직 조건과 쓰기", () => {
  /** 여섯 동작을 한 번씩 부르고 나간 요청을 모은다. */
  async function everyCall() {
    const fake = fakeSupabase(
      routes(
        getRows("organizations", [{ id: ORG_ID }]),
        getRows("company_profiles", [{ id: SEED_PROFILE.id, revision: SEED_PROFILE.revision }]),
        getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]),
        getRows("score_runs", [preRunRow("QUEUED")]),
        bidTablesRoute(seedBidTables()),
      ),
    );
    const store = createPreanalyzeStore(fake.client);
    await store.findDemoOrg();
    await store.latestProfile(ORG_ID);
    await store.listDemoBids();
    await store.latestExtractionId(FX01_TARGET.revisionId);
    await store.ensureQueuedRun(ENSURE_INPUT);
    await store.readStatuses(ORG_ID, [PRE_RUN_ID]);
    return fake;
  }

  // service role 은 RLS 를 거치지 않는다. 조직 표 요청은 모두 org_id 로 거른다.
  it("조직 표(company_profiles·score_runs) 읽기는 모두 org_id 조건이 있다", async () => {
    const fake = await everyCall();
    const reads = fake.calls.filter(
      (call) => call.method === "GET" && ["company_profiles", "score_runs"].includes(call.table),
    );
    expect(reads.length).toBe(3);
    for (const call of reads) expect(eqValue(call, "org_id")).toBe(ORG_ID);
  });

  it("score_runs 에 넣는 행은 모두 받은 orgId 를 갖는다", async () => {
    const fake = await everyCall();
    const rows = fake.callsTo("score_runs", "POST").flatMap(bodyRows);
    expect(rows.length).toBe(1);
    for (const row of rows) expect(row.org_id).toBe(ORG_ID);
  });

  it("쓰기는 ensureQueuedRun 의 score_runs 넣기 하나뿐이다(갱신·삭제가 없다)", async () => {
    const fake = await everyCall();
    expect(
      fake.calls
        .filter((call) => call.method !== "GET")
        .map((call) => `${call.method} ${call.table}`),
    ).toEqual(["POST score_runs"]);
  });
});

describe("createPreanalyzeStore · 질의 오류", () => {
  type Action = (store: PreanalyzeStore) => Promise<unknown>;
  const ACTIONS: [string, string, string, Action][] = [
    ["findDemoOrg", "GET", "organizations", (store) => store.findDemoOrg()],
    ["latestProfile", "GET", "company_profiles", (store) => store.latestProfile(ORG_ID)],
    [
      "latestExtractionId",
      "GET",
      "requirement_extractions",
      (store) => store.latestExtractionId(FX01_TARGET.revisionId),
    ],
    ["ensureQueuedRun 넣기", "POST", "score_runs", (store) => store.ensureQueuedRun(ENSURE_INPUT)],
    [
      "ensureQueuedRun 다시 읽기",
      "GET",
      "score_runs",
      (store) => store.ensureQueuedRun(ENSURE_INPUT),
    ],
    ["readStatuses", "GET", "score_runs", (store) => store.readStatuses(ORG_ID, [PRE_RUN_ID])],
  ];

  it.each(ACTIONS)(
    "%s 오류(%s %s)는 'analysis store 오류: <표>.<동작> <code>' 로 던진다",
    async (_label, method, table, action) => {
      const { store } = preStore(on(method, table, postgrestError("42501")));
      const error = await rejectionOf(action(store));
      expect(error.message).toMatch(new RegExp(`^analysis store 오류: ${table}\\.\\S+ 42501$`));
    },
  );

  it.each(ACTIONS)(
    "%s 오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다",
    async (_label, method, table, action) => {
      const { store } = preStore(on(method, table, postgrestError("42501")));
      const error = await rejectionOf(action(store));
      expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
    },
  );

  it("listDemoBids 질의 오류는 'analysis store 오류: <공고 표>.<동작> <code>' 로 던지고 message 를 싣지 않는다", async () => {
    const fake = fakeSupabase((call) =>
      call.method === "GET" ? postgrestError("42501") : undefined,
    );
    const error = await rejectionOf(createPreanalyzeStore(fake.client).listDemoBids());
    expect(error.message).toMatch(/^analysis store 오류: bid_(notices|revisions)\.\S+ 42501$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const { store } = preStore(on("GET", "company_profiles", postgrestError(null)));
    const error = await rejectionOf(store.latestProfile(ORG_ID));
    expect(error.message).toMatch(/^analysis store 오류: company_profiles\.\S+ UNKNOWN$/);
  });
});

describe("@/server/analysis 배럴 · 사전 분석 저장 port", () => {
  it("값 createPreanalyzeStore 를 내보낸다", () => {
    expect(Object.keys(analysisBarrel)).toContain("createPreanalyzeStore");
  });

  it("배럴의 createPreanalyzeStore 는 analysis.repo 의 것이다", () => {
    expect(typeof createPreanalyzeStore).toBe("function");
    expect(Reflect.get(analysisBarrel, "createPreanalyzeStore")).toBe(createPreanalyzeStore);
  });
});
