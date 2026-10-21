import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BidListQuery } from "./bid-query";
import type { BidListItemRow } from "./bid-row.mapper";
import type { ScoreRunRow } from "./analysis-row.mapper";
import { createBidsRepo } from "./bids.supabase";
import { keysetFilter } from "./postgrest";
import {
  callsOf,
  fakeDb,
  listRow,
  topLevelParts,
  unquote,
  type FakeQuery,
} from "./supabase-fake.test-data";

vi.mock("@/server/supabase", async () => {
  const { fakeDb: db } = await import("./supabase-fake.test-data");
  return { getSupabase: async () => db.client };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const BID = "22222222-2222-4222-8222-222222222222";
const T0 = "2026-10-16T00:00:00+00:00";
const repo = createBidsRepo({ runMode: "fixture", algorithmVersion: "sol-v0.1.0" });

const query = (patch: Partial<BidListQuery> = {}): BidListQuery => ({
  q: null,
  stage: [],
  status: ["OPEN", "AMENDED"],
  deadlineFrom: null,
  deadlineTo: null,
  recommendation: [],
  decision: [],
  origin: "all",
  sort: "publishedAt:desc",
  cursor: null,
  limit: 20,
  ...patch,
});

// 저장 run 행 + 임베드(revision·자식 표). QUEUED 라 자식 표가 비어도 뷰가 된다.
function storedRun(patch: Partial<ScoreRunRow> = {}) {
  const run: Partial<ScoreRunRow> = {
    ai_provider: "MOCK",
    algorithm_version: "sol-v0.1.0",
    bid_id: BID,
    company_profile_id: "cp-1",
    created_at: T0,
    error_code: null,
    explanation: null,
    extraction_id: null,
    fallback_reason: null,
    finished_at: null,
    id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: null,
    injection_suspected: false,
    input_snapshot_hash: null,
    kev_assist: null,
    kev_calibration: null,
    kev_model: null,
    missing_factors: [],
    model_metadata: {},
    org_id: ORG,
    profile_revision: 3,
    prompt_hash: null,
    question_set_version: null,
    queued_at: T0,
    qwen_model: null,
    recommendation: null,
    recommendation_basis: null,
    request_hash: null,
    requested_by: null,
    review_flags: [],
    revision_id: "r2",
    run_mode: "FIXTURE",
    score: null,
    started_at: null,
    status: "QUEUED",
    ...patch,
  };
  return {
    ...run,
    revision: { revision: 2 },
    score_factors: [],
    qualification_checks: [],
    requirement_assessments: [],
  };
}

const only = (target: string): FakeQuery => {
  const found = fakeDb.queries(target);
  expect(found).toHaveLength(1);
  return found[0] as FakeQuery;
};

beforeEach(() => fakeDb.reset());
afterEach(() => vi.restoreAllMocks());

describe("listBids", () => {
  it("q 예약 문자: `a,b)` 의 or 인자는 정확히 세 조건이고 값은 글자 그대로다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, query({ q: "a,b)" }), null);
    const ors = callsOf(only("bid_list_items"), "or");
    expect(ors).toHaveLength(1);
    const parts = topLevelParts(String(ors[0]?.[0]));
    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.slice(0, part.indexOf(".ilike.")))).toEqual([
      "title",
      "agency",
      "notice_id",
    ]);
    for (const part of parts) {
      expect(unquote(part.slice(part.indexOf(".ilike.") + ".ilike.".length))).toBe("*a,b)*");
    }
  });

  it("q 의 큰따옴표·역슬래시·LIKE 문자도 조건 수를 바꾸지 않고 LIKE 이스케이프로 남는다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, query({ q: 'x"),id.gt.(0%_\\' }), null);
    const parts = topLevelParts(String(callsOf(only("bid_list_items"), "or")[0]?.[0]));
    expect(parts).toHaveLength(3);
    const value = parts[0]?.slice("title.ilike.".length) ?? "";
    expect(unquote(value)).toBe('*x"),id.gt.(0\\%\\_\\\\*');
  });

  it("score:desc 는 scored_score 내림차순(nulls last) 다음 id 오름차순이다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, query({ sort: "score:desc" }), null);
    expect(callsOf(only("bid_list_items"), "order")).toEqual([
      ["scored_score", { ascending: false, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
  });

  it("limit+1 행을 읽어 hasNext 를 정하고 마지막 행의 정렬 값으로 커서 키를 만든다", async () => {
    const rows = [
      listRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        published_at: "2026-10-03T00:00:00+00:00",
      }),
      listRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        published_at: "2026-10-02T00:00:00+00:00",
      }),
      listRow({
        id: "aaaaaaaa-0000-4000-8000-000000000003",
        published_at: "2026-10-01T00:00:00+00:00",
      }),
    ];
    fakeDb.on("bid_list_items", fakeDb.rows(rows));
    const page = await repo.listBids(ORG, query({ limit: 2 }), null);
    expect(callsOf(only("bid_list_items"), "limit")).toEqual([[3]]);
    expect(page.items.map((item) => item.id)).toEqual([rows[0]?.id, rows[1]?.id]);
    expect(page.hasNext).toBe(true);
    expect(page.last).toEqual({ sortValue: "2026-10-02T00:00:00+00:00", id: rows[1]?.id });
  });

  it("마지막 쪽이면 hasNext 가 false 이고, 금액 정렬은 금액 문자열을 커서 값으로 쓴다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([listRow({ budget_krw_text: "9007199254740993" })]));
    const page = await repo.listBids(ORG, query({ sort: "budgetKrw:desc" }), null);
    expect(page.hasNext).toBe(false);
    expect(page.last).toEqual({ sortValue: "9007199254740993", id: BID });
    expect(callsOf(only("bid_list_items"), "order")[0]).toEqual([
      "budget_krw",
      { ascending: false, nullsFirst: false },
    ]);
  });

  it("커서가 있으면 정렬 열의 키셋 필터를 or 로 붙인다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    const after = {
      sortValue: "2026-12-01T00:00:00+00:00",
      id: BID,
      queryFingerprint: "fp",
      issuedAt: 0,
    };
    await repo.listBids(ORG, query({ sort: "deadlineAt:asc" }), after);
    expect(callsOf(only("bid_list_items"), "or")).toEqual([
      [keysetFilter("deadline_at", "asc", after)],
    ]);
  });

  it("단계·상태·마감·권고 필터를 뷰 열 조건으로 옮긴다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(
      ORG,
      query({
        stage: ["NOTICE"],
        status: ["OPEN", "CLOSED"],
        deadlineFrom: "2026-10-01T00:00:00+09:00",
        deadlineTo: "2026-10-31T00:00:00+09:00",
        recommendation: ["BID", "WATCH"],
      }),
      null,
    );
    const q = only("bid_list_items");
    expect(callsOf(q, "in")).toEqual([
      ["status", ["OPEN", "CLOSED"]],
      ["stage", ["NOTICE"]],
      ["scored_recommendation", ["BID", "WATCH"]],
    ]);
    expect(callsOf(q, "gte")).toEqual([["deadline_at", "2026-10-01T00:00:00+09:00"]]);
    expect(callsOf(q, "lte")).toEqual([["deadline_at", "2026-10-31T00:00:00+09:00"]]);
  });

  it("결정 NONE 은 latest_decision is null 과 or 로 묶는다", async () => {
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, query({ decision: ["BID", "NONE"] }), null);
    expect(callsOf(only("bid_list_items"), "or")).toEqual([
      ['latest_decision.in.("BID"),latest_decision.is.null'],
    ]);
  });

  it("DB 오류는 빈 목록으로 바꾸지 않고 던진다", async () => {
    fakeDb.on("bid_list_items", { error: new Error("db down") });
    await expect(repo.listBids(ORG, query(), null)).rejects.toThrow("db down");
  });

  // N3: watched=me 는 같은 열의 관심 공고 뷰를 읽는다. 필터·정렬·쪽은 bid_list_items 와 같은 길이다.
  it("watched=me 면 watched_bid_list_items 만 읽고 같은 필터·정렬을 건다", async () => {
    const filters = query({ stage: ["NOTICE"], decision: ["NONE"], origin: "demo" });
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, filters, null);
    const all = only("bid_list_items");

    fakeDb.reset();
    fakeDb.on("watched_bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, { ...filters, watched: "me" }, null);
    expect(fakeDb.queries("bid_list_items")).toHaveLength(0);
    const watched = only("watched_bid_list_items");
    for (const method of ["select", "in", "eq", "or", "gte", "lte", "order", "limit"]) {
      expect(callsOf(watched, method), method).toEqual(callsOf(all, method));
    }
  });

  it("watched=me 건수도 관심 공고 뷰에서 센다", async () => {
    fakeDb.on("watched_bid_list_items", { data: null, count: 2 });
    expect(await repo.countBids(ORG, query({ watched: "me" }))).toBe(2);
    expect(fakeDb.queries("bid_list_items")).toHaveLength(0);
    expect(callsOf(only("watched_bid_list_items"), "select")).toEqual([
      ["*", { count: "exact", head: true }],
    ]);
  });
});

// M4: 대시보드 "BID 권고" 카드는 BID 표와 같은 조건(같은 BidListQuery)의 건수다. 필터는 listBids 와 같은 길을 쓴다.
describe("countBids", () => {
  const filters = query({
    stage: ["NOTICE"],
    deadlineFrom: "2026-10-01T00:00:00+09:00",
    deadlineTo: "2026-10-31T00:00:00+09:00",
    recommendation: ["BID"],
    decision: ["NONE"],
    q: "a,b",
    origin: "demo",
    limit: 5,
  });

  it("listBids 와 같은 필터를 걸고 행 없이 head count 만 읽는다", async () => {
    fakeDb.on("bid_list_items", { data: null, count: 3 });
    expect(await repo.countBids(ORG, filters)).toBe(3);
    const counted = only("bid_list_items");
    expect(callsOf(counted, "select")).toEqual([["*", { count: "exact", head: true }]]);
    expect(callsOf(counted, "order")).toEqual([]);
    expect(callsOf(counted, "limit")).toEqual([]);

    fakeDb.reset();
    fakeDb.on("bid_list_items", fakeDb.rows([]));
    await repo.listBids(ORG, filters, null);
    const listed = only("bid_list_items");
    for (const method of ["in", "eq", "or", "gte", "lte"]) {
      expect(callsOf(counted, method), method).toEqual(callsOf(listed, method));
    }
    expect(callsOf(counted, "in")).toEqual([
      ["status", ["OPEN", "AMENDED"]],
      ["stage", ["NOTICE"]],
      ["scored_recommendation", ["BID"]],
    ]);
    expect(callsOf(counted, "eq")).toEqual([["is_demo", true]]);
  });

  it("count 가 없으면 0 이고, DB 오류는 던진다", async () => {
    fakeDb.on("bid_list_items", { data: null, count: null });
    expect(await repo.countBids(ORG, query())).toBe(0);
    fakeDb.reset();
    fakeDb.on("bid_list_items", { error: new Error("db down") });
    await expect(repo.countBids(ORG, query())).rejects.toThrow("db down");
  });
});

describe("createAnalysisRun", () => {
  const input = {
    orgId: ORG,
    bidId: BID,
    requestedBy: "user-1",
    idempotencyKey: `${ORG}:44444444-4444-4444-8444-444444444444`,
    requestHash: "hash-1",
    companyProfileId: "cp-1",
    profileRevision: 3,
    revisionId: "r2",
    extractionId: "ex-1",
    algorithmVersion: "sol-v0.1.0",
  };

  it("insert 열은 정해 둔 목록뿐이고 실행 모드·공급자는 대문자다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([{ id: "run-1", status: "QUEUED" }]));
    const result = await repo.createAnalysisRun(input);
    expect(result).toEqual({ created: { id: "run-1", status: "QUEUED" } });
    const inserted = callsOf(only("score_runs"), "insert")[0]?.[0];
    expect(Object.keys(inserted as object).sort()).toEqual(
      [
        "org_id",
        "bid_id",
        "revision_id",
        "company_profile_id",
        "profile_revision",
        "extraction_id",
        "algorithm_version",
        "run_mode",
        "ai_provider",
        "idempotency_key",
        "request_hash",
      ].sort(),
    );
    expect(inserted).toMatchObject({
      org_id: ORG,
      run_mode: "FIXTURE",
      ai_provider: "LOCAL",
      idempotency_key: input.idempotencyKey,
      request_hash: "hash-1",
    });
  });

  it("mock 실행 모드면 ai_provider 가 MOCK 이다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([{ id: "run-1", status: "QUEUED" }]));
    await createBidsRepo({ runMode: "mock", algorithmVersion: "v" }).createAnalysisRun(input);
    expect(callsOf(only("score_runs"), "insert")[0]?.[0]).toMatchObject({
      run_mode: "MOCK",
      ai_provider: "MOCK",
    });
  });

  it("23505 active 입력 충돌이면 진행 중 run 을 다시 읽어 ACTIVE_INPUT 으로 돌려준다(O7a)", async () => {
    fakeDb.on("score_runs", (q) =>
      callsOf(q, "insert").length > 0
        ? {
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "score_runs_active_input_key"',
            },
          }
        : { data: { id: "run-old", status: "RUNNING" } },
    );
    expect(await repo.createAnalysisRun(input)).toEqual({
      conflict: "ACTIVE_INPUT",
      run: { id: "run-old", status: "RUNNING" },
    });
  });

  it("23505 active 충돌 뒤 진행 중 run 이 없으면 던진다", async () => {
    fakeDb.on("score_runs", (q) =>
      callsOf(q, "insert").length > 0
        ? { error: { code: "23505", message: '… "score_runs_active_input_key"' } }
        : { data: null },
    );
    await expect(repo.createAnalysisRun(input)).rejects.toThrow();
  });

  it("23505 멱등 키 충돌이면 IDEMPOTENCY_KEY 다(O7a)", async () => {
    fakeDb.on("score_runs", {
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "score_runs_idempotency_key_key"',
      },
    });
    expect(await repo.createAnalysisRun(input)).toEqual({ conflict: "IDEMPOTENCY_KEY" });
  });

  it("다른 오류는 그대로 던진다", async () => {
    const error = { code: "42501", message: "new row violates row-level security policy" };
    fakeDb.on("score_runs", { error });
    await expect(repo.createAnalysisRun(input)).rejects.toBe(error);
  });
});

describe("같은 입력 run 찾기(O7c)", () => {
  const input = {
    companyProfileId: "cp-1",
    profileRevision: 3,
    revisionId: "r2",
    extractionId: null,
    algorithmVersion: "sol-v0.1.0",
  };

  it("findRunningAnalysis 는 입력 세 열과 QUEUED·RUNNING 으로 최신 1건을 찾는다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([{ id: "run-1", status: "RUNNING" }]));
    expect(await repo.findRunningAnalysis(ORG, BID, input)).toEqual({
      id: "run-1",
      status: "RUNNING",
    });
    const q = only("score_runs");
    expect(callsOf(q, "eq")).toEqual(
      expect.arrayContaining([
        ["org_id", ORG],
        ["bid_id", BID],
        ["revision_id", "r2"],
        ["company_profile_id", "cp-1"],
        ["algorithm_version", "sol-v0.1.0"],
      ]),
    );
    expect(callsOf(q, "in")).toEqual([["status", ["QUEUED", "RUNNING"]]]);
    expect(callsOf(q, "order")[0]).toEqual(["created_at", { ascending: false }]);
    expect(callsOf(q, "limit")).toEqual([[1]]);
  });

  it("findCompletedSameInput 은 COMPLETED·PARTIAL 중 최신이고 없으면 null 이다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([]));
    expect(await repo.findCompletedSameInput(ORG, BID, input)).toBeNull();
    const q = only("score_runs");
    expect(callsOf(q, "in")).toEqual([["status", ["COMPLETED", "PARTIAL"]]]);
    expect(callsOf(q, "eq")).toEqual(
      expect.arrayContaining([
        ["revision_id", "r2"],
        ["company_profile_id", "cp-1"],
        ["algorithm_version", "sol-v0.1.0"],
      ]),
    );
  });
});

describe("markRunFailed(O4)", () => {
  it("rpc release_unqueued_score_run 만 부른다", async () => {
    fakeDb.on("rpc:release_unqueued_score_run", { data: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await repo.markRunFailed(ORG, "run-1", "ENQUEUE_FAILED");
    expect(fakeDb.queries("rpc:release_unqueued_score_run")).toHaveLength(1);
    expect(only("rpc:release_unqueued_score_run").calls[0]).toEqual({
      method: "rpc",
      args: ["release_unqueued_score_run", { p_score_run_id: "run-1" }],
    });
    expect(fakeDb.queries("score_runs")).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("풀지 못하면(false) console.error 를 한 번만 남긴다", async () => {
    fakeDb.on("rpc:release_unqueued_score_run", { data: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await repo.markRunFailed(ORG, "run-1", "ENQUEUE_FAILED");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("ENQUEUE_FAILED 가 아니면 DB 를 부르지 않고 던진다", async () => {
    await expect(repo.markRunFailed(ORG, "run-1", "TIMEOUT")).rejects.toThrow();
    expect(fakeDb.queries("rpc:release_unqueued_score_run")).toHaveLength(0);
  });

  it("rpc 오류는 던진다", async () => {
    fakeDb.on("rpc:release_unqueued_score_run", { error: new Error("rpc down") });
    await expect(repo.markRunFailed(ORG, "run-1", "ENQUEUE_FAILED")).rejects.toThrow("rpc down");
  });
});

describe("findIdempotency", () => {
  it("조직·저장 키로 찾아 요청 지문과 run 을 돌려준다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([{ id: "run-1", status: "QUEUED", request_hash: "h" }]));
    expect(await repo.findIdempotency(ORG, `${ORG}:k`)).toEqual({
      requestHash: "h",
      run: { id: "run-1", status: "QUEUED" },
    });
    expect(callsOf(only("score_runs"), "eq")).toEqual([
      ["org_id", ORG],
      ["idempotency_key", `${ORG}:k`],
    ]);
  });

  it("없으면 null", async () => {
    fakeDb.on("score_runs", fakeDb.rows([]));
    expect(await repo.findIdempotency(ORG, `${ORG}:k`)).toBeNull();
  });
});

describe("resolveAnalysisInput", () => {
  const respond = (profile: unknown, extraction: unknown) => {
    fakeDb.on("company_profiles", fakeDb.rows(profile === null ? [] : [profile]));
    fakeDb.on("bid_notices", fakeDb.rows([{ latest_revision: 2 }]));
    fakeDb.on("bid_revisions", fakeDb.rows([{ id: "r2" }]));
    fakeDb.on("requirement_extractions", fakeDb.rows(extraction === null ? [] : [extraction]));
  };

  it("revision 이 없으면 조직의 최신 프로필과 공고 latest_revision 의 추출을 쓴다", async () => {
    respond({ id: "cp-3", revision: 3 }, { id: "ex-1" });
    expect(await repo.resolveAnalysisInput(ORG, BID, undefined)).toEqual({
      companyProfileId: "cp-3",
      profileRevision: 3,
      revisionId: "r2",
      extractionId: "ex-1",
      algorithmVersion: "sol-v0.1.0",
    });
    const profile = only("company_profiles");
    expect(callsOf(profile, "eq")).toEqual([["org_id", ORG]]);
    expect(callsOf(profile, "order")).toEqual([["revision", { ascending: false }]]);
    expect(callsOf(only("bid_revisions"), "eq")).toEqual([
      ["bid_id", BID],
      ["revision", 2],
    ]);
    const extraction = only("requirement_extractions");
    expect(callsOf(extraction, "eq")).toEqual(expect.arrayContaining([["revision_id", "r2"]]));
    expect(callsOf(extraction, "in")).toEqual([["status", ["COMPLETED", "PENDING_REVIEW"]]]);
  });

  it("revision 을 주면 그 revision 을 찾고, 쓸 추출이 없으면 extractionId 는 null 이다", async () => {
    respond({ id: "cp-2", revision: 2 }, null);
    const resolved = await repo.resolveAnalysisInput(ORG, BID, 2);
    expect(resolved?.extractionId).toBeNull();
    expect(callsOf(only("company_profiles"), "eq")).toEqual([
      ["org_id", ORG],
      ["revision", 2],
    ]);
  });

  it("프로필 revision 이 없으면 null", async () => {
    respond(null, null);
    expect(await repo.resolveAnalysisInput(ORG, BID, 9)).toBeNull();
  });
});

describe("getBid", () => {
  const usableExtractions = [
    { id: "ex-2", status: "FAILED", payload: {} },
    { id: "ex-1", status: "PENDING_REVIEW", payload: { requiredSkills: [] } },
  ];
  const respondDetail = (
    notice: BidListItemRow | null,
    extractions: unknown[] = usableExtractions,
  ) => {
    fakeDb.on("bid_list_items", fakeDb.rows(notice === null ? [] : [notice]));
    fakeDb.on("bid_notices", fakeDb.rows([{ pre_spec_ref: "R25BK00000001" }]));
    fakeDb.on(
      "bid_revisions",
      fakeDb.rows([
        {
          id: "r2",
          revision: 2,
          amendment_no: "1",
          fetched_at: T0,
          checksum: "c2",
          changed_fields: ["deadlineAt"],
          normalized: { content: "본문", original: { noticeNo: "N-1" } },
        },
        {
          id: "r1",
          revision: 1,
          amendment_no: null,
          fetched_at: T0,
          checksum: "c1",
          changed_fields: [],
          normalized: { content: "옛 본문", original: {} },
        },
      ]),
    );
    fakeDb.on(
      "bid_documents",
      fakeDb.rows([
        {
          id: "d1",
          name: "과업지시서.pdf",
          mime_type: "application/pdf",
          size_bytes: 10,
          format: "pdf",
          download_status: "OK",
          parse_status: "PARSED",
          download_error_code: null,
          page_count: 3,
          parse_error_code: null,
        },
        {
          id: "d2",
          name: "첨부.hwp",
          mime_type: null,
          size_bytes: null,
          format: null,
          download_status: "FAILED",
          parse_status: null,
          download_error_code: "TIMEOUT",
          page_count: null,
          parse_error_code: null,
        },
      ]),
    );
    fakeDb.on("bid_structured_requirements", fakeDb.rows([]));
    fakeDb.on("requirement_extractions", fakeDb.rows(extractions));
    fakeDb.on("score_runs", fakeDb.rows([storedRun()]));
    fakeDb.on("bid_reviews", fakeDb.rows([]));
  };

  it("공고가 없으면 null", async () => {
    respondDetail(null);
    expect(await repo.getBid(ORG, BID)).toBeNull();
  });

  it("사전규격 번호는 bid_notices 에서 읽어 stageLinks 로 옮긴다(뷰에 없음)", async () => {
    respondDetail(listRow());
    const detail = await repo.getBid(ORG, BID);
    expect(detail?.stageLinks).toEqual({ planRef: null, preSpecRef: "R25BK00000001" });
    expect(callsOf(only("bid_notices"), "select")).toEqual([["pre_spec_ref"]]);
    expect(detail?.budgetKrw).toBe("1200000000");
  });

  it("최신 revision(latest_revision)의 본문·첨부·추출을 읽고 revision 목록은 전부 싣는다", async () => {
    respondDetail(listRow());
    const detail = await repo.getBid(ORG, BID);
    expect(detail?.content).toBe("본문");
    expect(detail?.revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(callsOf(only("bid_documents"), "eq")).toEqual(
      expect.arrayContaining([["revision_id", "r2"]]),
    );
    // 첨부 내려받기 라우트는 핵심 컷에 없다(스펙 D24). 받은 첨부라도 경로를 내지 않아 화면에 죽은 링크가 생기지 않는다.
    expect(detail?.documents.map((d) => d.downloadStatus)).toEqual(["OK", "FAILED"]);
    expect(detail?.documents.map((d) => d.downloadPath)).toEqual([null, null]);
    // 쓸 수 있는 추출(COMPLETED·PENDING_REVIEW) 중 최신을 싣는다
    expect(detail?.extractionStatus).toBe("PENDING_REVIEW");
    expect(detail?.extraction).toEqual({ requiredSkills: [] });
  });

  it("최신 run 은 이 조직 것만 읽고 자식 표와 함께 전체 분석으로 옮긴다", async () => {
    respondDetail(listRow());
    const detail = await repo.getBid(ORG, BID);
    expect(detail?.latestAnalysis?.status).toBe("QUEUED");
    expect(detail?.latestAnalysis?.revision).toBe(2);
    const runs = only("score_runs");
    expect(callsOf(runs, "eq")).toEqual(
      expect.arrayContaining([
        ["org_id", ORG],
        ["bid_id", BID],
      ]),
    );
    const select = String(callsOf(runs, "select")[0]?.[0]);
    expect(select).toContain("score_factors");
    expect(select).toContain("qualification_checks");
    expect(select).toContain("requirement_assessments");
    // mapper 가 읽지 않는 큰 열은 읽지 않는다
    expect(select.split(",")).not.toContain("input_snapshot");
    expect(select.split(",")).not.toContain("kev_output");
  });

  it("쓸 추출이 없으면 최신 추출의 상태만 싣고 결과는 null 이다", async () => {
    respondDetail(listRow(), [{ id: "ex-2", status: "FAILED", payload: {} }]);
    const detail = await repo.getBid(ORG, BID);
    expect(detail?.extractionStatus).toBe("FAILED");
    expect(detail?.extraction).toBeNull();
  });
});

describe("분석 읽기", () => {
  it("getAnalysis 는 조직과 id 로 좁혀 읽는다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([storedRun()]));
    const analysis = await repo.getAnalysis(ORG, "run-x");
    expect(analysis?.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(callsOf(only("score_runs"), "eq")).toEqual([
      ["id", "run-x"],
      ["org_id", ORG],
    ]);
  });

  it("getAnalysisSnapshot 은 상태와 입력 스냅샷만 조직·id 로 좁혀 읽는다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([{ status: "COMPLETED", input_snapshot: { a: 1 } }]));
    expect(await repo.getAnalysisSnapshot(ORG, "run-x")).toEqual({
      status: "COMPLETED",
      inputSnapshot: { a: 1 },
    });
    expect(callsOf(only("score_runs"), "select")).toEqual([["status,input_snapshot"]]);
    expect(callsOf(only("score_runs"), "eq")).toEqual([
      ["id", "run-x"],
      ["org_id", ORG],
    ]);
  });

  it("getAnalysisSnapshot 은 행이 없으면 null 이다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([]));
    expect(await repo.getAnalysisSnapshot(ORG, "run-x")).toBeNull();
  });

  it("listAnalyses 는 created_at 내림차순·id 내림차순 키셋이다(최신 run 조회·뷰와 같은 동률 순서, M11)", async () => {
    fakeDb.on(
      "score_runs",
      fakeDb.rows([
        storedRun({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          created_at: "2026-10-03T00:00:00+00:00",
        }),
        storedRun({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          created_at: "2026-10-02T00:00:00+00:00",
        }),
      ]),
    );
    const after = {
      sortValue: "2026-10-04T00:00:00+00:00",
      id: "z",
      queryFingerprint: "fp",
      issuedAt: 0,
    };
    const page = await repo.listAnalyses(ORG, BID, 1, after);
    const q = only("score_runs");
    expect(callsOf(q, "order")).toEqual([
      ["created_at", { ascending: false, nullsFirst: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsOf(q, "or")).toEqual([[keysetFilter("created_at", "desc", after, "desc")]]);
    expect(callsOf(q, "limit")).toEqual([[2]]);
    expect(page.hasNext).toBe(true);
    expect(page.last).toEqual({
      sortValue: "2026-10-03T00:00:00+00:00",
      id: "aaaaaaaa-0000-4000-8000-000000000001",
    });
  });

  it("getLatestScoredAnalysis 는 COMPLETED·PARTIAL 중 최신 1건이다", async () => {
    fakeDb.on("score_runs", fakeDb.rows([]));
    expect(await repo.getLatestScoredAnalysis(ORG, BID)).toBeNull();
    expect(callsOf(only("score_runs"), "in")).toEqual([["status", ["COMPLETED", "PARTIAL"]]]);
  });

  it("bidExists 는 공고 행이 있는지만 본다", async () => {
    fakeDb.on("bid_notices", fakeDb.rows([{ id: BID }]));
    expect(await repo.bidExists(ORG, BID)).toBe(true);
    fakeDb.reset();
    fakeDb.on("bid_notices", fakeDb.rows([]));
    expect(await repo.bidExists(ORG, BID)).toBe(false);
  });
});
