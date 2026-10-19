// 데모 seed(scripts/demo-reset.mjs)의 시험. 실행: 루트에서 `pnpm test` 또는 `node --test scripts/demo-reset.test.mjs`
//
// 세 층으로 본다.
//   1. 순수 계획(scripts/demo/plan.mjs): 추출·프로필·리뷰·배정·마지막 줄·공고 id(demoIdFor).
//      공고 정규화(상대 날짜·금액·checksum·NormalizedBid)와 SEED 집계는 C3 수집 도메인(web/server/ingestion)의 vitest 가 본다.
//   2. HTTP 클라이언트(scripts/demo/rest-client.mjs): fetch 를 가짜로 바꿔 헤더·필터·upsert·오류 가림을 본다.
//   3. 전체 seed 를 PGlite(실제 마이그레이션·트리거·RLS) 위에서 두 번 돌려 멱등·ID 보존·live 공고 보존·조직 격리를 본다.
//      공고 적재(ingestBids)는 실제 RPC public.ingest_save_revision 을 SQL 로 부르는 가짜로 주입한다(C3 6-5).
// 실제 Supabase 스택에서의 실행은 docs/evidence/phase-1/demo-reset.txt 가 증거다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadBidFixtures } from "./bids/check.mjs";
import { migratedDb } from "./database-test-support.mjs";
import * as demoPlan from "./demo/plan.mjs";
import {
  DEMO_ACCOUNTS,
  DEMO_ASSIGNMENTS,
  DEMO_REVIEWS,
  EXPECTED_COUNTS,
  bidUuid,
  demoOrgIds,
  extractionFileFor,
  extractionStatus,
  formatSummaryLine,
  indexExtractionFiles,
  planCompanyProfiles,
  resolveSeedEnv,
  revisionUuid,
  seoulMidnight,
  substituteExtractionIds,
  toAssignmentRows,
  toReviewRows,
  toRunMode,
} from "./demo/plan.mjs";
import { createRestClient, filterParams } from "./demo/rest-client.mjs";
import { REQUIRED_TABLES, parseArgs, seedDemo } from "./demo-reset.mjs";
import { loadPeopleFixtures, orgUuid, personUuid } from "./people/seed.mjs";
import { actAs } from "./supabase-pglite.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const seoul = (text) => new Date(`${text}+09:00`);
const ANCHOR = seoul("2026-10-19T14:30:00");
const EXPECTED_LINE =
  "seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true";
// 시험용 가짜 관리 키. 실제 키 모양이 아니다(실제 키는 env 파일에만 둔다).
const TEST_KEY = "test-admin-key-not-real";
// 오류 가림 시험용, 토큰처럼 보이는 문자열을 실행 중에 만든다(파일에 토큰 모양을 적지 않는다).
const TOKEN_LIKE = ["eyJ" + "a".repeat(24), "b".repeat(24), "c".repeat(24)].join(".");

// 공고 id 규칙(C3 6-5 보충). plan.mjs 에 demoIdFor 가 생기기 전에도 파일 전체가 깨지지 않게 이름공간으로 읽는다.
const demoIdFor = (kind, keys) => {
  assert.equal(typeof demoPlan.demoIdFor, "function", "scripts/demo/plan.mjs 에 demoIdFor 가 없다");
  return demoPlan.demoIdFor(kind, keys);
};

// 공고 fixture(manifest + fixtures/bids). seedDemo 는 더 받지 않고, 가짜 ingestBids 와 mock 추출 fixture 만 쓴다.
const bidFixtures = await loadBidFixtures({ root: ROOT });
const peopleFixtures = await loadPeopleFixtures();

// 08 §6.1 의 값을 줄인 revision 2 프로필. 저장소의 fixtures/company 와 같은 모양이다.
const companyProfile = {
  schemaVersion: "company-profile/v0.1",
  orgSlug: "org-01",
  revision: 2,
  name: "솔리데오",
  isDemo: true,
  technologies: [
    "Java",
    "Spring Boot",
    "전자정부 표준프레임워크",
    "NestJS",
    "PostgreSQL",
    "Kubernetes",
  ].map((name) => ({ name })),
  technologiesComplete: true,
  licenses: [
    { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "HELD" },
    { code: "ICT_CONSTRUCTION", name: "정보통신공사업 등록", status: "NOT_HELD" },
  ],
  industryCodes: [],
  pastProjects: [
    {
      id: "P1",
      name: "지자체 민원 시스템 고도화",
      amountKrw: "1200000000",
      completedAt: "2024-11-30",
    },
    {
      id: "P2",
      name: "공공기관 데이터 플랫폼 구축",
      amountKrw: "2800000000",
      completedAt: "2024-03-31",
    },
    { id: "P3", name: "교육기관 AI 챗봇 PoC", amountKrw: "300000000", completedAt: "2025-09-30" },
  ],
  financials: { fiscalYear: 2025, employeeCount: 200, maxContractKrw: "5000000000" },
  preferences: {
    agencies: [],
    agencyTypes: ["지자체"],
    domains: ["민원"],
    excludedDomains: ["국방"],
    excludedKeywords: [],
  },
};

// mock 추출 fixture 의 최소 모양(03 §4.1 envelope). FX-07 은 r01 파일을 따로 두고, FX-05 는 첨부 파싱 실패 경고를 둔다.
const extractionFor = (fixtureId, revision, warnings = []) => {
  const revisionId = `${fixtureId}#${String(revision).padStart(2, "0")}`;
  return {
    schemaVersion: "requirement-extraction/v0.1",
    bidId: fixtureId,
    revisionId,
    model: {
      provider: "mock",
      name: "fixture",
      promptVersion: "req-extract/v0.1",
      promptHash: "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e",
      temperature: 0,
      extractedAt: "2026-10-16T09:00:00Z",
      latencyMs: 0,
      retries: 0,
    },
    summary: {
      value: `${fixtureId} 요약`,
      state: "KNOWN",
      evidence: [
        {
          documentId: null,
          revisionId,
          fetchedAt: "2026-10-16T09:00:00Z",
          quotedText: `${fixtureId} 요약`,
        },
      ],
    },
    warnings,
  };
};

const extractionFixtures = (() => {
  const files = {};
  for (const fixtureId of bidFixtures.manifest.batches.SEED) {
    if (fixtureId === "FX-12") continue;
    files[`${fixtureId}.json`] = extractionFor(
      fixtureId,
      fixtureId === "FX-07" ? 2 : 1,
      fixtureId === "FX-05" ? ["ATTACHMENT_PARSE_FAILED:FX-05-rfp"] : [],
    );
  }
  files["FX-07.r01.json"] = extractionFor("FX-07", 1);
  return { index: indexExtractionFiles(Object.keys(files)), files };
})();

// seedDemo 의 fixture. 공고(fixtures.bids)는 넣지 않는다 — 공고는 ingestBids 가 읽는다(C3 6-5 보충).
const fixtures = {
  extractions: extractionFixtures,
  company: companyProfile,
  people: peopleFixtures,
};

// ── 1. 순수 계획 ───────────────────────────────────────────────

// 2f 의 공고 정규화·SEED 계획 묶음은 C3 수집 도메인(web/server/ingestion)의 vitest 가 대신한다(C3 6-5).
// "상대 날짜" → normalize-date.test.ts
// "금액 정규화" → normalize-amount.test.ts
// "checksum" → checksum.test.ts
// "NormalizedBid" → normalized-bid.contract.test.ts
// "SEED 배치 계획" → ingestion.service.test.ts · ingestion.service.ids.test.ts · seed-fixture-bids.test.ts

describe("mock 추출 fixture", () => {
  it("FX-xx.rNN.json 은 그 revision, FX-xx.json 은 나머지 revision 에 쓴다(07 §6.5)", () => {
    const index = indexExtractionFiles(["FX-07.json", "FX-07.r01.json", "FX-06.json", "note.txt"]);
    assert.equal(extractionFileFor(index, "FX-07", 1), "FX-07.r01.json");
    assert.equal(extractionFileFor(index, "FX-07", 2), "FX-07.json");
    assert.equal(extractionFileFor(index, "FX-06", 1), "FX-06.json");
    assert.equal(extractionFileFor(index, "FX-09", 1), null);
  });

  it("자리표시 FX-xx·FX-xx#NN 을 UUID 로 깊이 바꾼다", () => {
    const extraction = extractionFor("FX-07", 1);
    const replaced = substituteExtractionIds(extraction, {
      fixtureId: "FX-07",
      bidId: "bid-uuid",
      revisionIds: { 1: "rev-uuid" },
    });
    assert.equal(replaced.bidId, "bid-uuid");
    assert.equal(replaced.revisionId, "rev-uuid");
    assert.equal(replaced.summary.evidence[0].revisionId, "rev-uuid");
    assert.ok(!JSON.stringify(replaced).includes("FX-07#01"));
    assert.equal(extraction.revisionId, "FX-07#01");
  });

  it("첨부 파싱 실패 경고가 있으면 PENDING_REVIEW, 아니면 COMPLETED", () => {
    assert.equal(
      extractionStatus({ warnings: ["ATTACHMENT_PARSE_FAILED:FX-05-rfp"] }),
      "PENDING_REVIEW",
    );
    assert.equal(extractionStatus({ warnings: [] }), "COMPLETED");
    assert.equal(extractionStatus({}), "COMPLETED");
  });
});

describe("회사 프로필 revision", () => {
  const createdBy = { "org-01": randomUUID(), "org-02": randomUUID() };
  const [revision1, revision2, isolation] = planCompanyProfiles({
    profile: companyProfile,
    anchor: ANCHOR,
    createdBy,
  });

  it("revision 2 는 fixture 그대로, revision 1 은 초기 기술 4·2024년 실적 2·목록 불완전", () => {
    assert.equal(revision2.revision, 2);
    assert.deepEqual(revision2.technologies, companyProfile.technologies);
    assert.equal(revision2.technologies_complete, true);
    assert.equal(revision2.past_projects.length, 3);
    assert.equal(revision2.created_by, createdBy["org-01"]);
    assert.equal(revision2.effective_at, "2026-10-18T15:00:00.000Z");
    assert.deepEqual(
      revision1.technologies.map((technology) => technology.name),
      ["Java", "Spring Boot", "전자정부 표준프레임워크", "PostgreSQL"],
    );
    assert.equal(revision1.technologies_complete, false);
    assert.deepEqual(
      revision1.past_projects.map((project) => project.id),
      ["P1", "P2"],
    );
    assert.ok(revision1.effective_at < revision2.effective_at);
    assert.equal(revision1.org_id, orgUuid("org-01"));
    assert.notEqual(revision1.id, revision2.id);
  });

  it("org-02 는 빈 프로필 revision 1 이고 is_demo 다", () => {
    assert.equal(isolation.org_id, orgUuid("org-02"));
    assert.equal(isolation.revision, 1);
    assert.deepEqual(isolation.licenses, []);
    assert.equal(isolation.is_demo, true);
    assert.equal(isolation.created_by, createdBy["org-02"]);
  });

  it("org-01 revision 2 fixture 가 아니면 멈춘다", () => {
    assert.throws(
      () =>
        planCompanyProfiles({
          profile: { ...companyProfile, revision: 1 },
          anchor: ANCHOR,
          createdBy,
        }),
      /org-01 revision 2/,
    );
  });
});

describe("사전 리뷰·배정·계정", () => {
  const bids = [
    { fixtureId: "FX-01", bidId: "b1", revisionId: "r1" },
    { fixtureId: "FX-03", bidId: "b3", revisionId: "r3" },
    { fixtureId: "FX-06", bidId: "b6", revisionId: "r6" },
  ];

  it("리뷰 2건은 FX-01 BID·FX-03 NO_BID 이고 사유는 10~2000자(05·19 §3)", () => {
    const rows = toReviewRows({ bids, reviewerId: "u", decidedAt: ANCHOR.toISOString() });
    assert.deepEqual(
      rows.map((row) => [row.bid_id, row.decision, row.system_recommendation]),
      [
        ["b1", "BID", "BID"],
        ["b3", "NO_BID", "NO_BID"],
      ],
    );
    for (const review of DEMO_REVIEWS) {
      assert.equal(review.reason, review.reason.trim());
      assert.ok(review.reason.length >= 10 && review.reason.length <= 2000);
    }
    assert.throws(() => toReviewRows({ bids: [], reviewerId: "u", decidedAt: "" }), /FX-01/);
  });

  it("배정 2건의 직원은 명부 fixture 에서 이미 100% 배정된 계산 대상이라 가용 20 FTE 가 바뀌지 않는다", () => {
    const preAssigned = new Set(peopleFixtures.people.assignments.map((entry) => entry.personId));
    for (const assignment of DEMO_ASSIGNMENTS) {
      const person = peopleFixtures.people.people.find(
        (entry) => entry.personId === assignment.personId,
      );
      assert.equal(person.scoringEligible, true, assignment.personId);
      assert.ok(preAssigned.has(assignment.personId), assignment.personId);
    }
    const rows = toAssignmentRows({ bids });
    assert.deepEqual(
      rows.map((row) => [row.bid_id, row.member_id, row.allocation_percent]),
      DEMO_ASSIGNMENTS.map((assignment) => [
        bids.find((bid) => bid.fixtureId === assignment.fixtureId).bidId,
        personUuid(assignment.personId),
        assignment.allocationPercent,
      ]),
    );
    assert.ok(rows.every((row) => row.ends_at > row.starts_at));
    // FX-01 배정은 기존 배정 기간(2026-12-01~2027-07-01)과 겹친다 — 04 §6 의 기간 충돌 1건.
    assert.ok(rows[0].starts_at < "2027-07-01" && rows[0].ends_at > "2026-12-01");
  });

  it("계정 5개는 19 §1 과 같고 admin@ 은 owner+ADMIN, org-02 는 VIEWER 1명", () => {
    assert.deepEqual(
      DEMO_ACCOUNTS.map((account) => [
        account.email,
        account.org,
        account.orgRole,
        account.solRole,
      ]),
      [
        ["admin@soltech.invalid", "org-01", "owner", "ADMIN"],
        ["sales@soltech.invalid", "org-01", "member", "SALES"],
        ["analyst@soltech.invalid", "org-01", "member", "ANALYST"],
        ["viewer@soltech.invalid", "org-01", "member", "VIEWER"],
        ["viewer@other.invalid", "org-02", "member", "VIEWER"],
      ],
    );
    const teams = new Set(
      peopleFixtures.departments.departments
        .filter((department) => (department.kind ?? "TEAM") === "TEAM")
        .map((department) => department.id),
    );
    const titles = new Set(peopleFixtures.jobTitles.jobTitles.map((title) => title.id));
    for (const account of DEMO_ACCOUNTS.filter((entry) => entry.org === "org-01")) {
      assert.ok(teams.has(account.departmentCode), account.email);
      assert.ok(titles.has(account.jobTitleCode), account.email);
    }
    assert.equal(DEMO_ACCOUNTS.at(-1).departmentCode, null);
  });

  it("마지막 줄은 10 기동 절차 6 과 글자 그대로 같다", () => {
    assert.equal(formatSummaryLine(EXPECTED_COUNTS), EXPECTED_LINE);
    assert.deepEqual(demoOrgIds(), [orgUuid("org-01"), orgUuid("org-02")]);
  });
});

describe("환경 변수·인자", () => {
  it("셸 환경이 파일보다 우선하고 origin·비밀번호 길이를 검사한다", () => {
    const resolved = resolveSeedEnv({
      fileValues: {
        NEXT_PUBLIC_SUPABASE_URL: "https://file.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "file-key",
        DEMO_SEED_PASSWORD: "file-password",
      },
      processEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59321/rest" },
    });
    assert.deepEqual(resolved, {
      apiUrl: "http://127.0.0.1:59321",
      serviceKey: "file-key",
      password: "file-password",
    });
    assert.throws(
      () => resolveSeedEnv({ fileValues: {}, processEnv: {} }),
      (error) =>
        /NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_SEED_PASSWORD/.test(
          error.message,
        ),
    );
    assert.throws(
      () =>
        resolveSeedEnv({
          fileValues: {
            NEXT_PUBLIC_SUPABASE_URL: "ftp://x",
            SUPABASE_SERVICE_ROLE_KEY: "k",
            DEMO_SEED_PASSWORD: "longenough",
          },
        }),
      /http\(s\)/,
    );
    assert.throws(
      () =>
        resolveSeedEnv({
          fileValues: {
            NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "secret-value-1",
            DEMO_SEED_PASSWORD: "short",
          },
        }),
      (error) => /8자/.test(error.message) && !error.message.includes("secret-value-1"),
    );
  });

  it("실행 모드는 대문자 저장값으로, 인자는 -- 를 건너뛰고 모르는 것은 거절한다", () => {
    assert.equal(toRunMode(undefined), "MOCK");
    assert.equal(toRunMode("live"), "LIVE");
    assert.throws(() => toRunMode("prod"), /SOL_RUN_MODE/);
    assert.deepEqual(parseArgs(["--", "--env-file", "x.env", "--fixtures-root", "/r"]), {
      envFile: "x.env",
      fixturesRoot: "/r",
      writeSummary: null,
    });
    assert.throws(() => parseArgs(["--anchor", "now"]), /모르는 인자/);
    assert.throws(() => parseArgs(["--env-file"]), /모르는 인자/);
  });
});

// ── 2. HTTP 클라이언트 ─────────────────────────────────────────

const fakeFetch = (handler) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url: new URL(url), method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const response = handler(call) ?? { status: 200, body: "" };
    return {
      ok: response.status < 400,
      status: response.status,
      text: async () => response.body ?? "",
    };
  };
  return { calls, fetchImpl };
};

describe("REST 클라이언트", () => {
  it("필터는 PostgREST 문법으로, 특수 문자 값은 따옴표로 감싼다", () => {
    assert.deepEqual(
      filterParams({ a: 1, b: null, c: { in: ["x", "y,z"] }, d: { notIn: ["p"] } }),
      [
        ["a", "eq.1"],
        ["b", "is.null"],
        ["c", 'in.(x,"y,z")'],
        ["d", "not.in.(p)"],
      ],
    );
    assert.throws(() => filterParams({ a: { like: "x" } }), /모르는 필터/);
  });

  it("키는 헤더에만 싣고, upsert 는 on_conflict 와 merge-duplicates 로, delete 는 조건 없이 거부한다", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 201, body: "" }));
    const client = createRestClient({
      apiUrl: "http://127.0.0.1:59321/",
      serviceKey: TEST_KEY,
      fetchImpl,
    });
    await client.upsert("memberships", [{ org_id: "o", user_id: "u" }], "org_id,user_id");
    await client.delete("bid_notices", { is_demo: true });
    await client.select("profiles", { columns: "id", filters: { id: { in: ["a"] } } });
    await client.update("profiles", { id: "a" }, { display_name: "x" });
    assert.equal(
      calls[0].url.href,
      "http://127.0.0.1:59321/rest/v1/memberships?on_conflict=org_id%2Cuser_id",
    );
    assert.equal(calls[0].headers.apikey, TEST_KEY);
    assert.equal(calls[0].headers.Authorization, `Bearer ${TEST_KEY}`);
    assert.equal(calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
    assert.equal(calls[1].method, "DELETE");
    assert.equal(calls[1].url.search, "?is_demo=eq.true");
    assert.equal(calls[2].url.search, "?select=id&id=in.%28a%29");
    assert.equal(calls[3].method, "PATCH");
    assert.equal(calls[3].body, '{"display_name":"x"}');
    await assert.rejects(client.delete("bid_notices", {}), /조건 없는 delete/);
    await assert.rejects(client.update("profiles", {}, {}), /조건 없는 update/);
    assert.equal(calls.length, 4);
  });

  it("오류에는 상태·코드·사유만 담고 토큰처럼 보이는 것은 가린다", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 400,
      body: JSON.stringify({
        code: "23505",
        message: `duplicate key ${TOKEN_LIKE}`,
        details: "Key (id)=(secret-row) already exists.",
      }),
    }));
    const client = createRestClient({
      apiUrl: "http://127.0.0.1:59321",
      serviceKey: TEST_KEY,
      fetchImpl,
    });
    await assert.rejects(client.insert("bid_notices", [{ id: "x" }]), (error) => {
      assert.equal(error.name, "RestError");
      assert.equal(error.status, 400);
      assert.equal(error.code, "23505");
      assert.ok(!error.message.includes(TOKEN_LIKE));
      assert.ok(!error.message.includes("secret-row"));
      assert.match(
        error.message,
        /POST \/rest\/v1\/bid_notices → 400 23505: duplicate key \[redacted\]/,
      );
      return true;
    });
  });

  it("표가 없으면(404) tableExists 가 false 이고, 사용자 목록은 쪽을 넘긴다", async () => {
    const page = (count, offset) =>
      Array.from({ length: count }, (_, index) => ({
        id: `u${offset + index}`,
        email: `u${offset + index}@x.invalid`,
      }));
    const { calls, fetchImpl } = fakeFetch(({ url }) => {
      if (url.pathname === "/rest/v1/missing")
        return { status: 404, body: '{"code":"PGRST205","message":"no table"}' };
      if (url.pathname === "/auth/v1/admin/users") {
        const current = Number(url.searchParams.get("page"));
        return {
          status: 200,
          body: JSON.stringify({ users: current === 1 ? page(1000, 0) : page(2, 1000) }),
        };
      }
      return { status: 200, body: "[]" };
    });
    const client = createRestClient({
      apiUrl: "http://127.0.0.1:59321",
      serviceKey: TEST_KEY,
      fetchImpl,
    });
    assert.equal(await client.tableExists("missing"), false);
    assert.equal(await client.tableExists("present"), true);
    const users = await client.auth.listUsers();
    assert.equal(users.length, 1002);
    assert.deepEqual(users[1001], { id: "u1001", email: "u1001@x.invalid" });
    assert.equal(calls.filter((call) => call.url.pathname === "/auth/v1/admin/users").length, 2);
  });
});

// ── 3. PGlite 위에서 전체 seed 두 번 ───────────────────────────
//
// REST 클라이언트와 같은 모양을 SQL 로 구현한다. Auth 관리 API 는 auth.users 에 직접 넣어 가입 트리거를 태운다.

const TEXT_ARRAY_COLUMNS = new Set(["changed_fields"]);
const toParam = (column, value) => {
  if (value === null || value === undefined) return null;
  if (TEXT_ARRAY_COLUMNS.has(column))
    return `{${value.map((item) => `"${String(item).replaceAll('"', '\\"')}"`).join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : value;
};

const whereClause = (filters, params) => {
  const clauses = Object.entries(filters).map(([column, condition]) => {
    if (condition === null) return `${column} is null`;
    if (typeof condition === "object" && !Array.isArray(condition)) {
      const values = condition.in ?? condition.notIn;
      if (values.length === 0) return condition.in ? "false" : "true";
      const slots = values.map((value) => `$${params.push(value)}`);
      return `${column} ${condition.in ? "in" : "not in"} (${slots.join(",")})`;
    }
    return `${column} = $${params.push(condition)}`;
  });
  return clauses.length ? ` where ${clauses.join(" and ")}` : "";
};

const sqlClient = (db) => {
  const insertRow = async (table, row, conflict) => {
    const columns = Object.keys(row);
    const params = columns.map((column) => toParam(column, row[column]));
    const update = conflict
      ? ` on conflict (${conflict}) do update set ${columns
          .filter((column) => !conflict.split(",").includes(column))
          .map((column) => `${column} = excluded.${column}`)
          .join(", ")}`
      : "";
    await db.query(
      `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => `$${index + 1}`).join(",")})${update}`,
      params,
    );
  };
  return {
    async tableExists(table) {
      return (
        (await db.query("select to_regclass($1) as oid", [`public.${table}`])).rows[0].oid !== null
      );
    },
    async select(table, { columns = "*", filters = {} } = {}) {
      const params = [];
      return (
        await db.query(
          `select ${columns} from public.${table}${whereClause(filters, params)}`,
          params,
        )
      ).rows;
    },
    async insert(table, rows) {
      for (const row of rows) await insertRow(table, row);
      return [];
    },
    async upsert(table, rows, conflict) {
      for (const row of rows) await insertRow(table, row, conflict);
    },
    async update(table, filters, patch) {
      const params = [];
      const sets = Object.entries(patch).map(
        ([column, value]) => `${column} = $${params.push(toParam(column, value))}`,
      );
      await db.query(
        `update public.${table} set ${sets.join(", ")}${whereClause(filters, params)}`,
        params,
      );
    },
    async delete(table, filters) {
      assert.ok(Object.keys(filters).length > 0, `${table}: 조건 없는 delete`);
      const params = [];
      await db.query(`delete from public.${table}${whereClause(filters, params)}`, params);
    },
    auth: {
      async listUsers() {
        return (await db.query("select id, email from auth.users order by email")).rows;
      },
      async createUser({ email, userMetadata }) {
        const id = randomUUID();
        await db.query(
          "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
          [id, email, JSON.stringify(userMetadata)],
        );
        return { id, email };
      },
      async updateUser(id, { userMetadata }) {
        await db.query("update auth.users set raw_user_meta_data = $2 where id = $1", [
          id,
          JSON.stringify(userMetadata),
        ]);
        return { id };
      },
    },
  };
};

const readyPortraits = async () => ({ ready: 200, errors: [] });

const LIVE_BID = randomUUID();
const insertLiveBid = async (db) => {
  await db.query(
    `insert into public.bid_notices (id, source, notice_id, title, stage, status, source_url, content_hash, is_demo)
     values ($1, 'g2b-bid-notice', 'R25BK00000001', '실제 수집 공고', 'NOTICE', 'OPEN', 'https://www.g2b.go.kr/x', 'h', false)`,
    [LIVE_BID],
  );
  await db.query(
    `insert into public.bid_revisions (bid_id, revision, raw_payload, normalized, checksum) values ($1, 1, '{}', '{}', 'h')`,
    [LIVE_BID],
  );
};

const snapshot = async (db) => ({
  people: (
    await db.query("select id, person_code, created_at from public.team_members order by id")
  ).rows,
  users: (await db.query("select id, email from auth.users order by email")).rows,
  bids: (
    await db.query("select id, notice_id from public.bid_notices where is_demo order by notice_id")
  ).rows,
  profiles: (
    await db.query(
      "select id, org_id, revision from public.company_profiles order by org_id, revision",
    )
  ).rows,
});

const count = async (db, sql, params = []) => Number((await db.query(sql, params)).rows[0].count);
// personId → team_member_scoring.availability(JSONB). seed 가 기존 투입을 접어 넣은 결과를 본다.
const scoringAvailability = async (db) =>
  new Map(
    (
      await db.query(
        "select m.person_code, s.availability from public.team_member_scoring s join public.team_members m on m.id = s.member_id where s.org_id = $1",
        [orgUuid("org-01")],
      )
    ).rows.map((row) => [row.person_code, row.availability]),
  );

// ── C4 가용 FTE 비교 ───────────────────────────────────────────
//
// DB 경로(접힌 availability + assignments 표 2건)와 fixture 경로(원본 availability + 명부 투입 7건 + 데모 2건)를
// 같은 ScoringTeam 모양으로 만들어 C4 `availableFte` 에 넣는다. C4 는 TypeScript 라 web/node_modules 의 tsx 로
// 자식 프로세스(scripts/demo/available-fte.mjs)에서 부른다. web 의존성이 없는 환경(CI 공통 job)에서는 같은 규칙을
// 옮긴 아래 오라클로 계산한다 — 그때는 C4 함수 직접 호출이 아니며 t.diagnostic 으로 남긴다.

const TSX_LOADER = path.join(ROOT, "web/node_modules/tsx/dist/loader.mjs");
const C4_BRIDGE = fileURLToPath(new URL("./demo/available-fte.mjs", import.meta.url));
// C4 defaultProjectPeriod(마감일 KST + 1개월을 다음 달 1일로 올림, 6개월) 을 골든 계산일 2026-10-16 기준으로 푼 값.
// C4 경로는 이 값을 다시 계산해 대조하고, 오라클 경로는 이 값을 그대로 쓴다.
const EXPECTED_PERIODS = {
  "FX-01": { startsAt: "2027-01-01", endsAt: "2027-07-01" },
  "FX-02": { startsAt: "2026-12-01", endsAt: "2027-06-01" },
  "FX-03": { startsAt: "2026-12-01", endsAt: "2027-06-01" },
};

const c4Bridge = (payload) => {
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", TSX_LOADER, C4_BRIDGE],
    { cwd: ROOT, input: JSON.stringify(payload), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`C4 다리 실패(${result.status}): ${result.stderr}`);
  return JSON.parse(result.stdout);
};

// C4 함수 직접 호출 아님 — scoring.model.ts `availableFte` 의 규칙을 그대로 옮긴 오라클.
// 시점마다 가용 = 덮는 창의 fte 최댓값, 배정 = 덮는 배정 비율의 합, 잔여 = max(0, 가용 − 배정). 사람마다 요청 기간의 잔여 최솟값을 더한다.
// 구간은 반개구간 [start, end) 이고 경계는 Date.parse 다.
const oracleAvailableFte = (team, period) => {
  const instant = (value) => Date.parse(value);
  const requested = { start: instant(period.startsAt), end: instant(period.endsAt) };
  return team.members.reduce((total, member) => {
    const windows = member.availability.map((window) => ({
      start: instant(window.startsAt),
      end: instant(window.endsAt),
      amount: window.fte,
    }));
    const assigned = team.assignments
      .filter((assignment) => assignment.personId === member.personId)
      .map((assignment) => ({
        start: instant(assignment.startsAt),
        end: instant(assignment.endsAt),
        amount: assignment.allocationPercent / 100,
      }));
    const boundaries = [
      ...new Set([
        requested.start,
        requested.end,
        ...[...windows, ...assigned]
          .flatMap((window) => [window.start, window.end])
          .filter((boundary) => boundary > requested.start && boundary < requested.end),
      ]),
    ].toSorted((left, right) => left - right);
    const residuals = boundaries.slice(0, -1).map((at) => {
      const available = Math.max(
        0,
        ...windows
          .filter((window) => window.start <= at && at < window.end)
          .map((window) => window.amount),
      );
      const allocated = assigned
        .filter((window) => window.start <= at && at < window.end)
        .reduce((sum, window) => sum + window.amount, 0);
      return Math.max(0, available - allocated);
    });
    return total + Math.min(...residuals);
  }, 0);
};
const oracleBridge = ({ teams }) => {
  const totals = {};
  const members = {};
  for (const [key, { people, assignments }] of Object.entries(teams)) {
    const eligible = people.filter((person) => person.scoringEligible);
    const ids = new Set(eligible.map((person) => person.personId));
    const team = {
      members: eligible,
      assignments: assignments.filter((assignment) => ids.has(assignment.personId)),
    };
    totals[key] = {};
    members[key] = {};
    for (const [fixtureId, period] of Object.entries(EXPECTED_PERIODS)) {
      totals[key][fixtureId] = oracleAvailableFte(team, period);
      members[key][fixtureId] = Object.fromEntries(
        team.members.map((member) => [
          member.personId,
          oracleAvailableFte({ ...team, members: [member] }, period),
        ]),
      );
    }
  }
  return { periods: EXPECTED_PERIODS, totals, members };
};

const deadlineSpecs = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.keys(EXPECTED_PERIODS).map(async (fixtureId) => [
        fixtureId,
        JSON.parse(await readFile(path.join(ROOT, "fixtures/bids", `${fixtureId}.json`), "utf8"))
          .records[0].deadlineAt,
      ]),
    ),
  );

// DB 가 저장한 그대로의 팀: team_member_scoring(접힌 availability) + assignments 표(데모 2건).
const teamFromDb = async (db) => {
  const orgId = orgUuid("org-01");
  const people = (
    await db.query(
      "select m.person_code, s.role, s.grade, s.skills, s.availability from public.team_member_scoring s join public.team_members m on m.id = s.member_id where s.org_id = $1 order by m.person_code",
      [orgId],
    )
  ).rows.map((row) => ({
    personId: row.person_code,
    scoringEligible: true,
    role: row.role,
    grade: row.grade,
    skills: row.skills,
    availability: row.availability,
  }));
  const assignments = (
    await db.query(
      "select m.person_code, a.starts_at, a.ends_at, a.allocation_percent from public.assignments a join public.team_members m on m.id = a.member_id where a.org_id = $1 order by m.person_code",
      [orgId],
    )
  ).rows.map((row) => ({
    personId: row.person_code,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    allocationPercent: row.allocation_percent,
  }));
  return { people, assignments, asOf: peopleFixtures.people.asOf };
};

// fixture 그대로의 팀: 원본 availability + 명부 투입 7건 + 데모 배정 2건(DB 와 같은 KST 자정 시각).
const teamFromFixture = () => ({
  people: peopleFixtures.people.people,
  assignments: [
    ...peopleFixtures.people.assignments,
    ...DEMO_ASSIGNMENTS.map(({ personId, startsAt, endsAt, allocationPercent }) => ({
      personId,
      startsAt: seoulMidnight(startsAt),
      endsAt: seoulMidnight(endsAt),
      allocationPercent,
    })),
  ],
  asOf: peopleFixtures.people.asOf,
});

const SEED_SUMMARY = {
  created: 19,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 1,
  retried: 2,
};

// ── 공고 적재 가짜(ingestBids) ─────────────────────────────────
//
// seedDemo 는 공고 적재를 ingestBids 로 주입받는다(C3 6-5 보충). 기본값(C3 seedFixtureBids)은 TypeScript 라 root
// node --test 가 부르지 못한다. 그래서 SEED 레코드 19건(FX-12 제외)을 간단한 p 로 만들어 실제 RPC
// public.ingest_save_revision 을 SQL 로 부른다 — 공고·revision·첨부(PENDING)·outbox 이벤트는 RPC 가 쓴다.
// 정규화는 다시 구현하지 않는다(날짜·금액은 null, checksum 은 레코드의 sha256). 정규화 값은 C3 vitest 가 본다.
// 목적은 나머지 seed(추출·리뷰·배정·감사·집계)와 "두 번 돌려도 공고 id 가 같다" 를 PGlite 위에서 계속 보는 것이다.
const SEED_RECORDS = bidFixtures.manifest.batches.SEED.flatMap((fixtureId) =>
  bidFixtures.bids[fixtureId].records
    .filter((record) => record.ingestBatch === "SEED")
    .map((record) => ({ fixtureId, record })),
);
// 필수 필드(title)가 빈 레코드는 격리된다 — SEED 에서는 FX-12 하나다(07 §6.4).
const isQuarantined = ({ record }) => String(record.title ?? "").trim() === "";
const SEED_BIDS = SEED_RECORDS.filter((entry) => !isQuarantined(entry));

const saveParamsOf = ({ fixtureId, record }, { idFor, fetchedAt }) => {
  const keys = { source: "fixture", noticeId: record.noticeId };
  return {
    bid_id: idFor("bid", keys),
    revision_id: idFor("revision", { ...keys, revision: 1 }),
    notice: {
      source: "fixture",
      notice_id: record.noticeId,
      plan_ref: record.planRef ?? null,
      pre_spec_ref: record.preSpecRef ?? null,
      title: record.title,
      agency: record.agency ?? null,
      stage: record.stage,
      status: record.status ?? "OPEN",
      budget_krw: null,
      published_at: null,
      deadline_at: null,
      source_url: record.sourceUrl,
      is_demo: true,
    },
    revision: {
      revision: 1,
      amendment_no: record.amendmentNo ?? null,
      raw_payload: { fixtureId, ...record },
      normalized: { source: "fixture", noticeId: record.noticeId, title: record.title },
      checksum: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
      changed_fields: [],
      fetched_at: fetchedAt,
    },
    documents: (record.attachments ?? []).map((attachment) => ({
      name: attachment.name,
      original_url: `https://demo.sol-radar.invalid/${attachment.objectKey ?? attachment.name}`,
    })),
    event: {
      event_type: "BID_CREATED",
      idempotency_key: `fixture:${record.noticeId}:1:BID_CREATED`,
      payload: {
        source: "fixture",
        noticeId: record.noticeId,
        revision: 1,
        kind: "CREATED",
        changedFields: [],
      },
    },
  };
};

// 받은 입력({ anchor, runMode, idFor })과 돌려준 결과를 seen 에 쌓고, 계약 모양 { bids, quarantined, summary, ingestRunId } 를 돌려준다.
const fakeIngestBids = (db, seen = { inputs: [], results: [] }) => {
  const ingestBids = async (input) => {
    seen.inputs.push(input);
    const fetchedAt = input.anchor.toISOString();
    const bids = [];
    for (const entry of SEED_BIDS) {
      const p = saveParamsOf(entry, { idFor: input.idFor, fetchedAt });
      const [saved] = (
        await db.query("select * from public.ingest_save_revision($1)", [JSON.stringify(p)])
      ).rows;
      bids.push({
        fixtureId: entry.fixtureId,
        bidId: saved.bid_id,
        revisionId: saved.revision_id,
        noticeId: entry.record.noticeId,
        checksum: p.revision.checksum,
      });
    }
    const quarantined = SEED_RECORDS.filter(isQuarantined).map(({ fixtureId }) => ({
      fixtureId,
      sourceKey: "fixture",
      errorCode: "MISSING_REQUIRED_FIELD",
    }));
    const [run] = (
      await db.query(
        `insert into public.ingest_runs (source, run_mode, job_key, trigger, batch, params, status, summary, finished_at)
         values ('fixture', $1, 'fixture:SEED:demo-reset', 'DEMO', 'SEED', $2, 'PARTIAL', $3, now()) returning id`,
        [
          input.runMode,
          JSON.stringify({ fixtures: bidFixtures.manifest.batches.SEED, anchor: fetchedAt }),
          JSON.stringify(SEED_SUMMARY),
        ],
      )
    ).rows;
    for (const { fixtureId, sourceKey, errorCode } of quarantined)
      await db.query(
        "insert into public.ingest_errors (ingest_run_id, source_key, error_code, redacted_detail) values ($1, $2, $3, $4)",
        [run.id, sourceKey, errorCode, `${fixtureId}: 필수 필드 누락(title)`],
      );
    const result = { bids, quarantined, summary: SEED_SUMMARY, ingestRunId: run.id };
    seen.results.push(result);
    return result;
  };
  return ingestBids;
};

// demoIdFor 로 기대하는 SEED 공고 19건의 id(공고 번호순, snapshot 의 bids 와 같은 모양).
const expectedSeedBids = () =>
  SEED_BIDS.map(({ record }) => ({
    id: demoIdFor("bid", { source: "fixture", noticeId: record.noticeId }),
    notice_id: record.noticeId,
  })).toSorted((left, right) => (left.notice_id < right.notice_id ? -1 : 1));

describe("PGlite 위에서 demo:reset", () => {
  it("두 번 돌려도 마지막 줄·ID 가 같고, live 공고는 남고, org-02 사용자는 org-01 행을 못 본다", async (t) => {
    const db = await migratedDb(t);
    const client = sqlClient(db);
    await insertLiveBid(db);
    for (const table of REQUIRED_TABLES) assert.ok(await client.tableExists(table), table);

    const run = () =>
      seedDemo({
        client,
        fixtures,
        password: "demo-password-1234",
        anchor: ANCHOR,
        portraits: readyPortraits,
        ingestBids: fakeIngestBids(db),
      });
    const first = await run();
    assert.equal(first.line, EXPECTED_LINE);
    assert.equal(first.ok, true);
    assert.deepEqual(first.mismatches, []);
    assert.deepEqual(first.ingestRun.summary, SEED_SUMMARY);
    assert.equal(first.extractions, 19);
    const before = await snapshot(db);
    assert.equal(before.people.length, 200);
    assert.equal(before.users.length, 3 + 5); // migratedDb 의 가입자 3 + 데모 계정 5
    // 공고·revision id 는 demoIdFor 규칙(2f bidUuid·revisionUuid)이다 — seedDemo 가 그 idFor 를 넘겼다.
    assert.deepEqual(before.bids, expectedSeedBids());
    assert.deepEqual(
      (
        await db.query(
          "select r.id, b.notice_id from public.bid_revisions r join public.bid_notices b on b.id = r.bid_id where b.is_demo order by b.notice_id",
        )
      ).rows,
      expectedSeedBids().map(({ notice_id }) => ({
        id: demoIdFor("revision", { source: "fixture", noticeId: notice_id, revision: 1 }),
        notice_id,
      })),
    );

    // 인력 단계: 명부의 기존 투입 7건은 공고가 없어 assignments 표(bid_id not null)에 못 넣고 availability 에 접힌다
    // (people/availability.mjs). 투입 7명은 그 기간 fte 0, 나머지 20명은 fixture 그대로다.
    const folded = await scoringAvailability(db);
    assert.equal(folded.size, 27);
    const prior = new Map(peopleFixtures.people.assignments.map((row) => [row.personId, row]));
    assert.equal(prior.size, 7);
    for (const person of peopleFixtures.people.people.filter((row) => row.scoringEligible)) {
      const busy = prior.get(person.personId);
      assert.deepEqual(
        folded.get(person.personId),
        busy ? [{ startsAt: busy.startsAt, endsAt: busy.endsAt, fte: 0 }] : person.availability,
        person.personId,
      );
    }

    // 데모 중 생긴 흔적: 명부 밖 직원, seed 밖 구성원, 알림, 추가 결정, 공고 제목 변경.
    const [admin] = (
      await db.query("select id from auth.users where email = 'admin@soltech.invalid'")
    ).rows;
    const stray = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'stray@soltech.invalid')", [
      stray,
    ]);
    await db.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'ANALYST')",
      [orgUuid("org-01"), stray],
    );
    await db.query(
      "insert into public.team_members (id, org_id, person_code, name, gender, department_id, job_title_id, portrait_path, is_demo) select $1, org_id, 'SOL-P9999', '임시인', gender, department_id, job_title_id, '/demo/people/SOL-P9999.png', true from public.team_members limit 1",
      [randomUUID()],
    );
    await db.query(
      "insert into public.notifications (org_id, user_id, type, idempotency_key) values ($1, $2, 'BID_CREATED', 'n1')",
      [orgUuid("org-01"), admin.id],
    );
    await db.query(
      "update public.bid_notices set title = '바뀐 제목' where notice_id = 'DEMO-2026-0001'",
    );
    const fx02 = before.bids.find((row) => row.notice_id === "DEMO-2026-0002");
    const [fx02Revision] = (
      await db.query("select id from public.bid_revisions where bid_id = $1", [fx02.id])
    ).rows;
    await db.query(
      "insert into public.bid_reviews (org_id, bid_id, revision_id, reviewer_id, decision, reason) values ($1, $2, $3, $4, 'WATCH', '데모 중 라이브로 기록한 결정이다')",
      [orgUuid("org-01"), fx02.id, fx02Revision.id, admin.id],
    );

    const second = await run();
    assert.equal(second.line, EXPECTED_LINE);
    assert.equal(second.ok, true);
    const after = await snapshot(db);
    assert.deepEqual(after.people, before.people); // id·created_at 보존
    assert.deepEqual(after.bids, before.bids); // 고정 UUID
    assert.deepEqual(after.profiles, before.profiles);
    assert.deepEqual(
      after.users.filter((user) => user.email !== "stray@soltech.invalid"),
      before.users,
    );
    assert.deepEqual(
      second.bids.map((bid) => bid.bidId),
      first.bids.map((bid) => bid.bidId),
    );

    // 흔적은 지워졌고 live 공고는 남았다.
    assert.equal(
      await count(db, "select count(*) from public.team_members where person_code = 'SOL-P9999'"),
      0,
    );
    assert.equal(
      await count(db, "select count(*) from public.memberships where user_id = $1", [stray]),
      0,
    );
    assert.equal(await count(db, "select count(*) from public.notifications"), 0);
    assert.equal(await count(db, "select count(*) from public.bid_reviews"), 2);
    assert.equal(
      (await db.query("select title from public.bid_notices where notice_id = 'DEMO-2026-0001'"))
        .rows[0].title,
      "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
    );
    // raw_payload.fixtureId(분석 job 의 mock 재추출 키)는 C3 수집이 쓴다 — C3 vitest(5-F)가 본다.
    assert.equal(await count(db, "select count(*) from public.bid_notices where not is_demo"), 1);
    assert.equal(
      await count(db, "select count(*) from public.bid_revisions where bid_id = $1", [LIVE_BID]),
      1,
    );
    assert.equal(await count(db, "select count(*) from public.bid_notices"), 20);

    // 수집 run·격리·추출·첨부·결정·배정·감사.
    // 두 번째 실행 전에 fixture run 을 지워(ingest_errors 는 cascade) ingestBids 가 새로 쓴 run 하나만 남는다.
    // run 의 상태·params.anchor·격리 사유 문구는 C3 seedFixtureBids 가 정한다(C3 vitest). 여기서는 seedDemo 가 받은 run id 를 본다.
    assert.deepEqual((await db.query("select id from public.ingest_runs")).rows, [
      { id: second.ingestRun.id },
    ]);
    assert.deepEqual(
      (await db.query("select ingest_run_id, error_code from public.ingest_errors")).rows,
      [{ ingest_run_id: second.ingestRun.id, error_code: "MISSING_REQUIRED_FIELD" }],
    );
    assert.equal(
      await count(
        db,
        "select count(*) from public.bid_revisions where bid_id in (select id from public.bid_notices where is_demo)",
      ),
      19,
    );
    assert.equal(await count(db, "select count(*) from public.bid_documents"), 18);
    assert.equal(
      await count(
        db,
        "select count(*) from public.bid_documents where download_status <> 'PENDING' or parse_status is not null",
      ),
      0,
    );
    assert.equal(await count(db, "select count(*) from public.bid_structured_requirements"), 0);
    const extractions = (
      await db.query(
        "select e.status, e.provider, e.payload, n.notice_id from public.requirement_extractions e join public.bid_notices n on n.id = e.bid_id",
      )
    ).rows;
    assert.equal(extractions.length, 19);
    assert.ok(extractions.every((row) => row.provider === "MOCK"));
    assert.equal(
      extractions.find((row) => row.notice_id === "DEMO-2026-0005").status,
      "PENDING_REVIEW",
    );
    const fx07 = extractions.find((row) => row.notice_id === "DEMO-2026-0007");
    assert.equal(fx07.status, "COMPLETED");
    assert.ok(!JSON.stringify(fx07.payload).includes("FX-07#"));
    assert.match(fx07.payload.revisionId, /^[0-9a-f-]{36}$/);
    const reviews = (
      await db.query(
        "select n.notice_id, r.decision, r.system_recommendation, r.disagreement_flag, p.email from public.bid_reviews r join public.bid_notices n on n.id = r.bid_id join public.profiles p on p.id = r.reviewer_id order by n.notice_id",
      )
    ).rows;
    assert.deepEqual(reviews, [
      {
        notice_id: "DEMO-2026-0001",
        decision: "BID",
        system_recommendation: "BID",
        disagreement_flag: false,
        email: "sales@soltech.invalid",
      },
      {
        notice_id: "DEMO-2026-0003",
        decision: "NO_BID",
        system_recommendation: "NO_BID",
        disagreement_flag: false,
        email: "sales@soltech.invalid",
      },
    ]);
    assert.equal(await count(db, "select count(*) from public.assignments"), 2);
    // 공고 이벤트(BID_CREATED, org_id null)는 RPC 가 쓰고, 같은 멱등키로 다시 오면 무시한다 — 두 번 돌려도 19건이다.
    // 시드 결정에는 담당자가 없어 REVIEW_ASSIGNED 이벤트는 없다.
    assert.deepEqual(
      (
        await db.query(
          "select aggregate_type, event_type, org_id, count(*)::int as count from public.outbox_events group by 1, 2, 3",
        )
      ).rows,
      [{ aggregate_type: "bid_notice", event_type: "BID_CREATED", org_id: null, count: 19 }],
    );
    const audits = (
      await db.query(
        "select action, count(*)::int as count from public.audit_logs group by action order by action",
      )
    ).rows;
    assert.deepEqual(audits, [
      { action: "PROFILE_CREATE_REVISION", count: 3 },
      { action: "REVIEW_DECIDE", count: 2 },
      { action: "SEED", count: 2 },
    ]);
    // 정규화 값(FX-14 마감 KST 18:00·FX-13 금액 환산)은 C3 normalize-date·normalize-amount 가 본다(가짜는 null 로 둔다).
    const memberships = (
      await db.query(
        "select o.slug, p.email, m.org_role, m.sol_role from public.memberships m join public.organizations o on o.id = m.org_id join public.profiles p on p.id = m.user_id where o.is_demo order by o.slug, p.email",
      )
    ).rows;
    assert.deepEqual(memberships, [
      { slug: "org-01", email: "admin@soltech.invalid", org_role: "owner", sol_role: "ADMIN" },
      { slug: "org-01", email: "analyst@soltech.invalid", org_role: "member", sol_role: "ANALYST" },
      { slug: "org-01", email: "sales@soltech.invalid", org_role: "member", sol_role: "SALES" },
      { slug: "org-01", email: "viewer@soltech.invalid", org_role: "member", sol_role: "VIEWER" },
      { slug: "org-02", email: "viewer@other.invalid", org_role: "member", sol_role: "VIEWER" },
    ]);
    const [adminProfile] = (
      await db.query(
        "select display_name, declared_department_id, declared_job_title_id from public.profiles where id = $1",
        [admin.id],
      )
    ).rows;
    assert.equal(adminProfile.display_name, "김관리");
    assert.ok(adminProfile.declared_department_id && adminProfile.declared_job_title_id);

    // RLS: org-02 VIEWER 는 공용 공고 20건은 읽고, org-01 의 프로필·결정·명부·감사는 0행이다.
    const [outsider] = (
      await db.query("select id from auth.users where email = 'viewer@other.invalid'")
    ).rows;
    await actAs(db, outsider.id, "authenticated", "viewer@other.invalid");
    assert.deepEqual((await db.query("select org_id from public.company_profiles")).rows, [
      { org_id: orgUuid("org-02") },
    ]);
    assert.equal(
      await count(db, "select count(*) from public.company_profiles where org_id = $1", [
        orgUuid("org-01"),
      ]),
      0,
    );
    assert.equal(await count(db, "select count(*) from public.bid_reviews"), 0);
    assert.equal(await count(db, "select count(*) from public.team_members"), 0);
    assert.equal(await count(db, "select count(*) from public.audit_logs"), 0);
    assert.equal(await count(db, "select count(*) from public.bid_notices"), 20);
    await db.exec("reset role");
  });

  // 6-5 보충 2: 멱등키가 결정적이라 지난 리허설의 이벤트가 남으면 다음 리허설의 SEED·LIVE 이벤트가
  // on conflict do nothing 에 막혀 S5 변경 알림이 안 나온다. 리셋은 데모 공고(is_demo)의 bid_notice 이벤트만 지운다.
  it("두 번째 실행은 지난 실행의 데모 공고 outbox 이벤트(LIVE BID_CHANGED 포함)를 지우고, live 공고·bid_review 이벤트는 남긴다 — 데모 BID_CREATED 는 19건", async (t) => {
    const db = await migratedDb(t);
    const client = sqlClient(db);
    await insertLiveBid(db);
    const run = () =>
      seedDemo({
        client,
        fixtures,
        password: "demo-password-1234",
        anchor: ANCHOR,
        portraits: readyPortraits,
        ingestBids: fakeIngestBids(db),
      });
    await run();

    // 지난 리허설의 흔적: 데모 공고 FX-06 의 LIVE 변경 이벤트, live 공고의 이벤트, 데모 밖 조직의 검토 배정 이벤트.
    const fx06 = demoIdFor("bid", { source: "fixture", noticeId: "DEMO-2026-0006" });
    const liveOrg = randomUUID();
    await db.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'live-team', '실사용 조직', false)",
      [liveOrg],
    );
    const KEPT = {
      live: "g2b-bid-notice:R25BK00000001:1:BID_CREATED",
      review: `${randomUUID()}:${randomUUID()}:REVIEW_ASSIGNED`,
    };
    const STALE = "fixture:DEMO-2026-0006:2:BID_CHANGED";
    await db.query(
      `insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values
         (null, 'bid_notice', $1, 'BID_CHANGED', $2),
         (null, 'bid_notice', $3, 'BID_CREATED', $4),
         ($5, 'bid_review', $6, 'REVIEW_ASSIGNED', $7)`,
      [fx06, STALE, LIVE_BID, KEPT.live, liveOrg, randomUUID(), KEPT.review],
    );

    await run();
    assert.equal(
      await count(db, "select count(*) from public.outbox_events where idempotency_key = $1", [
        STALE,
      ]),
      0,
    );
    assert.deepEqual(
      (
        await db.query(
          "select aggregate_type, idempotency_key from public.outbox_events where idempotency_key in ($1, $2) order by aggregate_type",
          [KEPT.live, KEPT.review],
        )
      ).rows,
      [
        { aggregate_type: "bid_notice", idempotency_key: KEPT.live },
        { aggregate_type: "bid_review", idempotency_key: KEPT.review },
      ],
    );
    assert.equal(
      await count(
        db,
        "select count(*) from public.outbox_events where aggregate_type = 'bid_notice' and event_type = 'BID_CREATED' and aggregate_id in (select id from public.bid_notices where is_demo)",
      ),
      19,
    );
    assert.equal(await count(db, "select count(*) from public.outbox_events"), 19 + 2);
  });

  it("C4 availableFte: DB 에서 읽은 팀과 fixture 팀의 가용 FTE 가 FX-01·02·03 기간마다 같다(20 FTE, 투입 7명은 0)", async (t) => {
    const db = await migratedDb(t);
    await seedDemo({
      client: sqlClient(db),
      fixtures,
      password: "demo-password-1234",
      anchor: ANCHOR,
      portraits: readyPortraits,
      ingestBids: fakeIngestBids(db),
    });
    const teams = { db: await teamFromDb(db), fixture: teamFromFixture() };
    assert.equal(teams.db.people.length, 27);
    assert.equal(teams.db.assignments.length, 2);
    assert.equal(teams.fixture.assignments.length, 9);
    // DB 경로에는 명부 투입 7건이 assignments 로 없다 — 접힌 availability 만으로 같은 답이 나와야 한다.
    assert.deepEqual(
      teams.db.assignments.map((row) => row.personId),
      DEMO_ASSIGNMENTS.map((row) => row.personId).toSorted(),
    );

    const usesC4 = existsSync(TSX_LOADER);
    t.diagnostic(
      usesC4
        ? "C4 scoring.model.ts availableFte 를 tsx 자식 프로세스로 직접 호출"
        : "C4 함수 직접 호출 아님: web/node_modules/tsx 가 없어 오라클로 계산",
    );
    const result = usesC4
      ? c4Bridge({ deadlines: await deadlineSpecs(), teams })
      : oracleBridge({ teams });
    assert.deepEqual(result.periods, EXPECTED_PERIODS);

    const busy = peopleFixtures.people.assignments.map((row) => row.personId);
    for (const fixtureId of Object.keys(EXPECTED_PERIODS)) {
      assert.equal(result.totals.db[fixtureId], 20, `${fixtureId} DB 팀 가용 합`);
      assert.equal(result.totals.fixture[fixtureId], 20, `${fixtureId} fixture 팀 가용 합`);
      assert.deepEqual(result.members.db[fixtureId], result.members.fixture[fixtureId], fixtureId);
      for (const personId of busy)
        assert.equal(result.members.db[fixtureId][personId], 0, `${fixtureId} ${personId}`);
      assert.equal(
        Object.values(result.members.db[fixtureId]).filter((fte) => fte === 1).length,
        20,
        `${fixtureId} 가용 1 FTE 인원`,
      );
    }
  });
});

// ── 공고 적재 주입(ingestBids) — C3 6-5 보충 ───────────────────
//
// seedDemo 는 공고 적재를 직접 하지 않고 ingestBids 에 맡긴다. 넘기는 것은 anchor·runMode·idFor(= demoIdFor)이고,
// 돌려받은 bids·quarantined·summary·ingestRunId 를 그대로 쓴다.
describe("공고 적재 주입 — ingestBids (C3 6-5)", () => {
  // 2f 의 고정 UUID 규칙. 공고는 (source, noticeId), revision 은 차수까지 넣는다.
  const KEYS = [
    { source: "fixture", noticeId: "DEMO-2026-0001" },
    { source: "fixture", noticeId: "DEMO-2026-0007" },
    { source: "g2b-bid-notice", noticeId: "R25BK00000001" },
  ];

  it("demoIdFor 는 공고면 bidUuid(source, noticeId), revision 이면 revisionUuid(source, noticeId, revision) 와 같은 값이다", () => {
    for (const keys of KEYS) {
      assert.equal(demoIdFor("bid", keys), bidUuid(keys.source, keys.noticeId));
      // 공고 id 는 차수와 무관하다.
      assert.equal(demoIdFor("bid", { ...keys, revision: 3 }), bidUuid(keys.source, keys.noticeId));
      for (const revision of [1, 2])
        assert.equal(
          demoIdFor("revision", { ...keys, revision }),
          revisionUuid(keys.source, keys.noticeId, revision),
        );
    }
  });

  it("seedDemo 는 ingestBids 를 한 번 부르고 anchor·runMode·idFor(demoIdFor 와 같은 값)를 넘긴다", async (t) => {
    const db = await migratedDb(t);
    const seen = { inputs: [], results: [] };
    await seedDemo({
      client: sqlClient(db),
      fixtures,
      password: "demo-password-1234",
      anchor: ANCHOR,
      runMode: "FIXTURE",
      portraits: readyPortraits,
      ingestBids: fakeIngestBids(db, seen),
    });
    assert.equal(seen.inputs.length, 1);
    const [input] = seen.inputs;
    assert.equal(input.anchor.toISOString(), ANCHOR.toISOString());
    assert.equal(input.runMode, "FIXTURE");
    assert.equal(typeof input.idFor, "function");
    for (const keys of KEYS) {
      assert.equal(input.idFor("bid", keys), demoIdFor("bid", keys));
      assert.equal(
        input.idFor("revision", { ...keys, revision: 2 }),
        demoIdFor("revision", { ...keys, revision: 2 }),
      );
    }
  });

  it("seedDemo 의 반환 quarantined·ingestRun·bids 는 ingestBids 가 돌려준 것이다", async (t) => {
    const db = await migratedDb(t);
    const seen = { inputs: [], results: [] };
    const result = await seedDemo({
      client: sqlClient(db),
      fixtures,
      password: "demo-password-1234",
      anchor: ANCHOR,
      portraits: readyPortraits,
      ingestBids: fakeIngestBids(db, seen),
    });
    const [returned] = seen.results;
    assert.deepEqual(result.quarantined, returned.quarantined);
    assert.deepEqual(result.quarantined, [
      { fixtureId: "FX-12", sourceKey: "fixture", errorCode: "MISSING_REQUIRED_FIELD" },
    ]);
    assert.deepEqual(result.ingestRun, { id: returned.ingestRunId, summary: returned.summary });
    assert.deepEqual(result.bids, returned.bids);
  });
});
