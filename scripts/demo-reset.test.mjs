// 데모 seed(scripts/demo-reset.mjs)의 시험. 실행: 루트에서 `pnpm test` 또는 `node --test scripts/demo-reset.test.mjs`
//
// 세 층으로 본다.
//   1. 순수 계획(scripts/demo/plan.mjs): 상대 날짜·금액·checksum·SEED 집계·프로필·리뷰·마지막 줄.
//   2. HTTP 클라이언트(scripts/demo/rest-client.mjs): fetch 를 가짜로 바꿔 헤더·필터·upsert·오류 가림을 본다.
//   3. 전체 seed 를 PGlite(실제 마이그레이션·트리거·RLS) 위에서 두 번 돌려 멱등·ID 보존·live 공고 보존·조직 격리를 본다.
// 실제 Supabase 스택에서의 실행은 docs/evidence/phase-1/demo-reset.txt 가 증거다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migratedDb } from "./database-test-support.mjs";
import { loadDemoBidFixtures, seedBidNotices } from "./demo/bid-notices.mjs";
import {
  DEMO_ACCOUNTS,
  DEMO_ASSIGNMENTS,
  DEMO_REVIEWS,
  EXPECTED_COUNTS,
  canonicalJson,
  checksumOf,
  demoOrgIds,
  extractionFileFor,
  extractionStatus,
  formatSummaryLine,
  indexExtractionFiles,
  missingRequiredFields,
  normalizeFixtureRecord,
  parseBudgetKrw,
  planCompanyProfiles,
  planSeedBatch,
  resolveRelativeDate,
  resolveSeedEnv,
  substituteExtractionIds,
  toAssignmentRows,
  toBidRows,
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

const bidFixtures = await loadDemoBidFixtures(ROOT);
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

const fixtures = {
  bids: bidFixtures,
  extractions: extractionFixtures,
  company: companyProfile,
  people: peopleFixtures,
};

// ── 1. 순수 계획 ───────────────────────────────────────────────

describe("상대 날짜", () => {
  it("anchor 의 서울 날짜에 n 일을 더해 KST 18:00 = UTC 09:00 으로 바꾼다(FX-14 규칙)", () => {
    assert.equal(resolveRelativeDate("+2d", ANCHOR), "2026-10-21T09:00:00.000Z");
    assert.equal(resolveRelativeDate("-3d", ANCHOR), "2026-10-16T09:00:00.000Z");
    assert.equal(resolveRelativeDate("+21d", ANCHOR), "2026-11-09T09:00:00.000Z");
    assert.equal(resolveRelativeDate(null, ANCHOR), null);
  });

  it("서울 자정 전후로 기준 날짜가 갈린다(UTC 날짜가 아니다)", () => {
    assert.equal(
      resolveRelativeDate("+0d", seoul("2026-10-19T23:30:00")),
      "2026-10-19T09:00:00.000Z",
    );
    assert.equal(
      resolveRelativeDate("+0d", seoul("2026-10-20T00:30:00")),
      "2026-10-20T09:00:00.000Z",
    );
  });

  it("상대 표기가 아니면 멈춘다", () => {
    assert.throws(() => resolveRelativeDate("2026-10-20", ANCHOR), /상대 날짜 표기가 아닙니다/);
  });
});

describe("금액 정규화", () => {
  it("단위 표기를 KRW 정수 문자열로 환산하고 원문 환산 사실을 남긴다", () => {
    assert.deepEqual(parseBudgetKrw("1,500백만원"), {
      value: "1500000000",
      note: 'budgetKrw 를 원문 "1,500백만원" 에서 환산',
    });
    assert.equal(parseBudgetKrw("21.6억").value, "2160000000");
    assert.equal(parseBudgetKrw("12억원").value, "1200000000");
    assert.equal(parseBudgetKrw("1.5천원").value, "1500");
    assert.deepEqual(parseBudgetKrw("1200000000"), { value: "1200000000", note: null });
    assert.deepEqual(parseBudgetKrw(null), { value: null, note: null });
  });

  it("정수로 떨어지지 않거나 단위를 모르면 null 과 BUDGET_UNPARSED 다", () => {
    assert.deepEqual(parseBudgetKrw("0.3원"), { value: null, note: "BUDGET_UNPARSED:0.3원" });
    assert.deepEqual(parseBudgetKrw("약 3억"), { value: null, note: "BUDGET_UNPARSED:약 3억" });
  });
});

describe("checksum", () => {
  it("canonical JSON 은 키 순서와 무관하고 undefined 를 뺀다", () => {
    assert.equal(
      canonicalJson({ b: [{ z: 1, a: undefined, y: [2, 1] }], a: null }),
      '{"a":null,"b":[{"y":[2,1],"z":1}]}',
    );
  });

  it("fetchedAt·checksum 을 뺀 canonical JSON 의 sha256 이다(15 §3)", () => {
    const bid = { title: "a", noticeId: "n", fetchedAt: "2026-01-01T00:00:00Z", checksum: "x" };
    const expected = createHash("sha256").update('{"noticeId":"n","title":"a"}').digest("hex");
    assert.equal(checksumOf(bid), expected);
    assert.equal(checksumOf({ ...bid, fetchedAt: "2027-01-01T00:00:00Z" }), expected);
    assert.notEqual(checksumOf({ ...bid, title: "b" }), expected);
  });
});

describe("NormalizedBid", () => {
  const record = bidFixtures.bids["FX-13"].records[0];
  const normalized = normalizeFixtureRecord({
    record,
    revision: 1,
    anchor: ANCHOR,
    fetchedAt: ANCHOR.toISOString(),
  });

  it("fixture 레코드를 15 §3 모양으로 바꾼다(status 기본 OPEN, null 선택 필드는 뺀다, 원문 보존)", () => {
    assert.equal(normalized.schemaVersion, "normalized-bid/v0.2");
    assert.equal(normalized.source, "fixture");
    assert.equal(normalized.status, "OPEN");
    assert.equal(normalized.budgetKrw, "1500000000");
    assert.equal(normalized.deadlineAt, "2026-11-07T09:00:00.000Z");
    assert.ok(!("planRef" in normalized));
    assert.equal(normalized.amendmentNo, "01");
    assert.deepEqual(normalized.attachments, [
      { name: "제안요청서.pdf", url: "https://demo.sol-radar.invalid/fixtures/docs/FX-13-rfp.pdf" },
    ]);
    assert.deepEqual(normalized.structuredQualifications, []);
    assert.equal(normalized.original.budget, "1,500백만원");
    assert.equal(normalized.original.noticeNo, "DEMO-2026-0013-01");
    assert.ok(normalized.normalizationNotes.some((note) => note.includes("1,500백만원")));
    assert.equal(normalized.isDemo, true);
    assert.equal(normalized.checksum, checksumOf(normalized));
  });

  it("필수 필드가 비면 격리 대상이다(FX-12 title)", () => {
    assert.deepEqual(missingRequiredFields(bidFixtures.bids["FX-12"].records[0]), ["title"]);
    assert.deepEqual(missingRequiredFields(record), []);
    assert.deepEqual(missingRequiredFields({ ...record, title: "  " }), ["title"]);
  });
});

describe("SEED 배치 계획", () => {
  const plan = planSeedBatch(bidFixtures, { anchor: ANCHOR });

  it("07 §6.4 집계 {created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2} 와 FX-12 격리", () => {
    assert.deepEqual(plan.summary, {
      created: 19,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 1,
      retried: 2,
    });
    assert.deepEqual(plan.quarantined, [
      { fixtureId: "FX-12", noticeId: "DEMO-2026-0012", missing: ["title"] },
    ]);
    assert.deepEqual(
      plan.created.map((entry) => entry.fixtureId),
      bidFixtures.manifest.batches.SEED.filter((id) => id !== "FX-12"),
    );
    assert.ok(plan.created.every((entry) => entry.normalized.revision === 1));
  });

  it("id·checksum 은 같은 anchor 면 같고, anchor 가 다르면 날짜가 든 checksum 만 바뀐다", () => {
    const again = planSeedBatch(bidFixtures, { anchor: new Date(ANCHOR) });
    const keys = ({ created }) =>
      created.map(({ bidId, revisionId, normalized }) => [bidId, revisionId, normalized.checksum]);
    assert.deepEqual(keys(again), keys(plan));
    const later = planSeedBatch(bidFixtures, { anchor: seoul("2026-10-25T09:00:00") });
    assert.deepEqual(
      later.created.map(({ bidId }) => bidId),
      plan.created.map(({ bidId }) => bidId),
    );
    assert.notEqual(later.created[0].normalized.checksum, plan.created[0].normalized.checksum);
  });

  it("행 묶음마다 키가 같고(PostgREST 일괄 insert), 첨부는 다운로드 전(PENDING) 상태로만 적는다", () => {
    const { notices, revisions, documents } = toBidRows(plan);
    for (const rows of [notices, revisions, documents]) {
      const keys = Object.keys(rows[0]).join(",");
      assert.ok(rows.every((row) => Object.keys(row).join(",") === keys));
    }
    assert.equal(notices.length, 19);
    assert.ok(notices.every((row) => row.is_demo === true && row.latest_revision === 1));
    // FX-04 는 첨부가 없다(07 §6.2).
    assert.equal(documents.length, 18);
    assert.ok(
      documents.every((row) => row.download_status === "PENDING" && !("parse_status" in row)),
    );
    const fx11 = notices.find((row) => row.notice_id === "DEMO-2026-0011");
    assert.equal(fx11.budget_krw, null);
    assert.equal(fx11.deadline_at, null);
    const fx17 = notices.find((row) => row.notice_id === "DEMO-2026-0017");
    assert.equal(fx17.plan_ref, "DEMO-PLAN-0042");
    assert.equal(fx17.stage, "PLAN");
  });
});

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
const SEED_SUMMARY = {
  created: 19,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 1,
  retried: 2,
};

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
    assert.equal(await count(db, "select count(*) from public.bid_notices where not is_demo"), 1);
    assert.equal(
      await count(db, "select count(*) from public.bid_revisions where bid_id = $1", [LIVE_BID]),
      1,
    );
    assert.equal(await count(db, "select count(*) from public.bid_notices"), 20);

    // 수집 run·격리·추출·첨부·결정·배정·감사.
    const [ingestRun] = (await db.query("select * from public.ingest_runs")).rows;
    assert.equal(ingestRun.source, "fixture");
    assert.equal(ingestRun.batch, "SEED");
    assert.equal(ingestRun.status, "PARTIAL");
    assert.equal(ingestRun.run_mode, "MOCK");
    assert.deepEqual(ingestRun.summary, SEED_SUMMARY);
    // C3 runIngest SEED 계약: LIVE 배치가 최근 SEED run 의 params.anchor(ISO UTC, seed 시각)를 읽는다.
    assert.equal(ingestRun.params.anchor, new Date(ingestRun.started_at).toISOString());
    const errors = (await db.query("select error_code, redacted_detail from public.ingest_errors"))
      .rows;
    assert.deepEqual(errors, [
      {
        error_code: "MISSING_REQUIRED_FIELD",
        redacted_detail: "FX-12 DEMO-2026-0012: 필수 필드 누락(title)",
      },
    ]);
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
    assert.equal(await count(db, "select count(*) from public.outbox_events"), 0);
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
    const [fx14] = (
      await db.query(
        "select deadline_at from public.bid_notices where notice_id = 'DEMO-2026-0014'",
      )
    ).rows;
    assert.equal(new Date(fx14.deadline_at).toISOString(), "2026-10-21T09:00:00.000Z");
    const [fx13] = (
      await db.query("select budget_krw from public.bid_notices where notice_id = 'DEMO-2026-0013'")
    ).rows;
    assert.equal(String(fx13.budget_krw), "1500000000");
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

  it("공고 적재 함수만 따로 불러도 같은 집계와 id 를 돌려준다(C3 가 바꿀 지점)", async (t) => {
    const db = await migratedDb(t);
    const client = sqlClient(db);
    const result = await seedBidNotices(client, {
      fixtures: bidFixtures,
      anchor: ANCHOR,
      runMode: "FIXTURE",
    });
    assert.equal(result.bids.length, 19);
    assert.equal(result.quarantined.length, 1);
    assert.deepEqual(result.summary, SEED_SUMMARY);
    assert.equal(
      (await db.query("select run_mode from public.ingest_runs")).rows[0].run_mode,
      "FIXTURE",
    );
    assert.equal(
      result.bids[0].bidId,
      planSeedBatch(bidFixtures, { anchor: ANCHOR }).created[0].bidId,
    );
    assert.equal(await count(db, "select count(*) from public.bid_notices"), 19);
  });
});
