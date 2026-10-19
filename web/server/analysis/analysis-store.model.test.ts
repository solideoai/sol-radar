import { describe, expect, expectTypeOf, it } from "vitest";
import { KEV_DISCLAIMER, companyProfileSchema, type MissingReason } from "@/server/scoring";
import type { Database, Json } from "@/lib/database.types";
import { toExtractionRecord, type AnalysisRunRecord } from "./analysis.model";
import { AnalysisInputError, runAnalysis } from "./analysis.service";
import type { PreanalyzeRunInput } from "./preanalyze.model";
import {
  EMPTY_ATTACHMENT_READER,
  isOwnPreanalyzeRun,
  toExtractSource,
  toExtractionRow,
  toFailedUpdate,
  toFinishScoreRunPayload,
  toLoadedContext,
  toQualificationCheckRows,
  toRequirementAssessmentRows,
  toRunningUpdate,
  toScoreFactorRows,
  toScoreRunResultUpdate,
  type LoaderRows,
  type RevisionDocumentText,
} from "./analysis-store.model";
import {
  NO_BUDGET_ID,
  ORG_ID,
  SEED_ASSIGNMENTS,
  SEED_PROFILE,
  SEED_TEAM_SCORING,
  kevOffRoutes,
  loaderRowsFor,
  seedBid,
  seedDocumentsFor,
  toPostgrestTimestamp,
} from "./store.test-support";
import {
  ATTEMPT_STARTED_AT,
  QUEUED_AT,
  STARTED_AT,
  buildContext,
  buildDeps,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  jsonReply,
  explainBody,
  loadExtraction,
  loadKevResponses,
  refusedReply,
  withPatch,
  type GatewayRoutes,
} from "./test-support";

// 저장 port 의 순수 행 매핑. DB 행 ↔ 도메인 값만 본다. supabase-js·DB 는 부르지 않는다.
// 읽기 쪽 행은 데모 seed 의 행 계획 함수가 만든 실제 seed 값(store.test-support)에서 출발한다.
// 쓰기 쪽 레코드는 fixture 경로 runAnalysis(3b mock gateway)가 만든 실제 AnalysisRunRecord 다.

const RUN_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const IDEMPOTENCY_KEY = `${ORG_ID}:req-store-1`;

const baseRows = (): LoaderRows =>
  loaderRowsFor("FX-01", {
    scoreRunId: RUN_ID,
    queuedAt: QUEUED_AT,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

const rowsWith = (patch: (draft: LoaderRows) => void): LoaderRows => withPatch(baseRows(), patch);

/** 던진 값을 돌려준다. 던지지 않으면 시험을 실패시킨다. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("던지지 않았다");
}

function documentText(overrides: Partial<RevisionDocumentText> = {}): RevisionDocumentText {
  return {
    documentId: "doc-a",
    name: "제안요청서.pdf",
    downloadStatus: "OK",
    downloadErrorCode: null,
    parseStatus: "PARSED",
    parseErrorCode: null,
    text: "가상 제안요청서 본문",
    pages: [{ page: 1, charOffset: 0 }],
    ...overrides,
  };
}

/** 3b mock gateway 로 돌린 fixture 경로 레코드. */
async function fixtureRecord(id: string, routes?: GatewayRoutes): Promise<AnalysisRunRecord> {
  const fake = fakeGateway(routes ?? healthyRoutes(id));
  return runAnalysis(buildContext(id), buildDeps(fake.gateway, fakeExtractionStore().store));
}

const FX01_RECORD = await fixtureRecord("FX-01");
const FX03_RECORD = await fixtureRecord("FX-03");
// S6: 같은 FX-01 에서 /kev 연결 거부 → PARTIAL·AI_UNAVAILABLE·Kev 없음(analysis.service 골든 6).
const S6_RECORD = await fixtureRecord("FX-01", {
  "/kev": refusedReply,
  "/explain": jsonReply(explainBody("미사용", true)),
});
// FX-11: 예산 미공개 공고. KEV_ENABLED=false 시나리오다(kevOffRoutes 로 gateway 가 Kev 를 끈 응답을 준다, COMPLETED·kev.enabled=false).
const FX11_RECORD = await fixtureRecord(NO_BUDGET_ID, kevOffRoutes());

// ── 읽기: toLoadedContext ──

describe("toLoadedContext · score_runs 행", () => {
  it("orgId 는 score_runs.org_id 다", () => {
    expect(toLoadedContext(baseRows()).orgId).toBe(baseRows().scoreRun.org_id);
  });

  it("scoreRunId 는 score_runs.id 다", () => {
    expect(toLoadedContext(baseRows()).scoreRunId).toBe(RUN_ID);
  });

  it("bidId 는 score_runs.bid_id 다", () => {
    expect(toLoadedContext(baseRows()).bidId).toBe(baseRows().scoreRun.bid_id);
  });

  it("companyProfileId 는 score_runs.company_profile_id 다", () => {
    expect(toLoadedContext(baseRows()).companyProfileId).toBe(SEED_PROFILE.id);
  });

  it("idempotencyKey 는 score_runs.idempotency_key 다", () => {
    expect(toLoadedContext(baseRows()).idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  it("idempotency_key 가 null 이면 idempotencyKey 도 null 이다", () => {
    const rows = rowsWith((draft) => {
      draft.scoreRun.idempotency_key = null;
    });
    expect(toLoadedContext(rows).idempotencyKey).toBeNull();
  });

  it("queuedAt 은 queued_at(PostgREST 의 +00:00 모양)을 ISO(Z)로 바꾼 값이다", () => {
    expect(baseRows().scoreRun.queued_at).toBe(toPostgrestTimestamp(QUEUED_AT));
    expect(toLoadedContext(baseRows()).queuedAt).toBe(QUEUED_AT);
  });

  // started_at 은 markRunning·markFailed 의 쓰기 조건(compare-and-set)이다. Date 로 바꾸면 마이크로초가 버려져 조건이 맞지 않는다.
  it("startedAt 은 started_at 원문 그대로다(마이크로초·오프셋을 바꾸지 않는다)", () => {
    const raw = "2026-10-16T09:00:00.123456+00:00";
    const rows = rowsWith((draft) => {
      draft.scoreRun.status = "RUNNING";
      draft.scoreRun.started_at = raw;
    });
    expect(toLoadedContext(rows).startedAt).toBe(raw);
  });

  it("started_at 이 null(QUEUED)이면 startedAt 도 null 이다", () => {
    expect(baseRows().scoreRun).toHaveProperty("started_at", null);
    expect(toLoadedContext(baseRows()).startedAt).toBeNull();
  });

  it.each(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"])(
    "status %s 를 그대로 싣는다",
    (status) => {
      const rows = rowsWith((draft) => {
        draft.scoreRun.status = status;
      });
      expect(toLoadedContext(rows).status).toBe(status);
    },
  );

  it("status 가 ScoreRunStatus 가 아니면 AnalysisInputError 를 던진다", () => {
    const rows = rowsWith((draft) => {
      draft.scoreRun.status = "DONE";
    });
    expect(thrownBy(() => toLoadedContext(rows))).toBeInstanceOf(AnalysisInputError);
  });
});

describe("toLoadedContext · fixtureId(raw_payload.fixtureId 의 revision stem)", () => {
  it("seed revision(FX-01 r1)은 FX-01.r01 이다", () => {
    expect(toLoadedContext(baseRows()).fixtureId).toBe("FX-01.r01");
  });

  it.each<[string, Json, number, string | null]>([
    ["객체의 fixtureId, revision 1", { fixtureId: "FX-07" }, 1, "FX-07.r01"],
    ["객체의 fixtureId, revision 2", { fixtureId: "FX-07" }, 2, "FX-07.r02"],
    ["raw_payload 가 문자열", "FX-07", 1, null],
    ["raw_payload 가 배열", ["FX-07"], 1, null],
    ["raw_payload 가 null", null, 1, null],
    ["fixtureId 없음(g2b 공고)", { bidNtceNo: "R25BK00000001" }, 1, null],
    ["fixtureId 형식이 아님", { fixtureId: "FX-7" }, 1, null],
  ])("%s → %s", (_label, rawPayload, revision, expected) => {
    const rows = rowsWith((draft) => {
      draft.revision.raw_payload = rawPayload;
      draft.revision.revision = revision;
    });
    expect(toLoadedContext(rows).fixtureId).toBe(expected);
  });
});

const NORMALIZED = {
  schemaVersion: "normalized-bid/v0.2",
  source: "fixture",
  noticeId: "DEMO-2026-9001",
  revision: 1,
  stage: "NOTICE",
  status: "OPEN",
  title: "가상 공고 제목",
  agency: "가상 기관",
  budgetKrw: "1500000000",
  noticeDate: "2026-10-11T09:00:00.000Z",
  deadlineAt: "2026-11-06T09:00:00.000Z",
  sourceUrl: "https://demo.sol-radar.invalid/notices/9001",
  content: "가상 공고 본문",
  attachments: [{ name: "제안요청서.pdf", url: "https://demo.sol-radar.invalid/x.pdf" }],
  structuredQualifications: [],
  original: { noticeNo: "DEMO-2026-9001-01" },
  isDemo: true,
  fetchedAt: "2026-10-16T09:00:00.000Z",
  checksum: "a".repeat(64),
};

describe("toLoadedContext · 공고 요약(bid)", () => {
  const rows = () =>
    rowsWith((draft) => {
      draft.revision.normalized = NORMALIZED;
      // normalized.fetchedAt 과 다른 시각. 설계는 fetchedAt 을 normalized 에서 읽는다.
      draft.revision.fetched_at = "2026-10-17T00:00:00+00:00";
    });

  it("revisionId 는 bid_revisions.id 다", () => {
    expect(toLoadedContext(rows()).bid.revisionId).toBe(baseRows().revision.id);
  });

  it("noticeId·title·agency·stage·budgetKrw·deadlineAt·noticeDate·fetchedAt 은 normalized 의 값이다", () => {
    expect(toLoadedContext(rows()).bid).toMatchObject({
      noticeId: NORMALIZED.noticeId,
      title: NORMALIZED.title,
      agency: NORMALIZED.agency,
      stage: NORMALIZED.stage,
      budgetKrw: NORMALIZED.budgetKrw,
      deadlineAt: NORMALIZED.deadlineAt,
      noticeDate: NORMALIZED.noticeDate,
      fetchedAt: NORMALIZED.fetchedAt,
    });
  });

  it.each(["content", "attachments", "original", "checksum", "sourceUrl"])(
    "normalized 의 %s 는 공고 요약에 넣지 않는다",
    (key) => {
      expect(toLoadedContext(rows()).bid).not.toHaveProperty(key);
    },
  );

  it("seed revision(FX-01)의 공고 요약은 seed normalized 의 제목·마감과 같다", () => {
    const seed = seedBid("FX-01").revision.normalized;
    expect(seed).toMatchObject({ title: toLoadedContext(baseRows()).bid.title });
    expect(seed).toMatchObject({ deadlineAt: toLoadedContext(baseRows()).bid.deadlineAt });
  });

  it("구조화 자격은 DB seq 그대로 (kind, seq) 순으로 정렬해 싣는다", () => {
    const structured = rowsWith((draft) => {
      draft.structured = [
        {
          kind: "PERMITTED_INDUSTRY",
          seq: 0,
          code: "1468",
          name: "소프트웨어사업자",
          value: { indstrytyCd: "1468" },
          source_operation: "getBidPblancListInfoLicenseLimit",
        },
        {
          kind: "LICENSE_LIMIT",
          seq: 7,
          code: null,
          name: "정보통신공사업",
          value: { lcnsLmtNm: "정보통신공사업" },
          source_operation: "getBidPblancListInfoLicenseLimit",
        },
        {
          kind: "LICENSE_LIMIT",
          seq: 3,
          code: "SW",
          name: "소프트웨어사업자",
          value: { lcnsLmtNm: "소프트웨어사업자" },
          source_operation: "getBidPblancListInfoLicenseLimit",
        },
      ];
    });
    expect(toLoadedContext(structured).bid.structuredQualifications).toEqual([
      {
        kind: "LICENSE_LIMIT",
        seq: 3,
        code: "SW",
        name: "소프트웨어사업자",
        value: { lcnsLmtNm: "소프트웨어사업자" },
        sourceOperation: "getBidPblancListInfoLicenseLimit",
      },
      {
        kind: "LICENSE_LIMIT",
        seq: 7,
        code: null,
        name: "정보통신공사업",
        value: { lcnsLmtNm: "정보통신공사업" },
        sourceOperation: "getBidPblancListInfoLicenseLimit",
      },
      {
        kind: "PERMITTED_INDUSTRY",
        seq: 0,
        code: "1468",
        name: "소프트웨어사업자",
        value: { indstrytyCd: "1468" },
        sourceOperation: "getBidPblancListInfoLicenseLimit",
      },
    ]);
  });

  it("구조화 자격 행이 없으면 structuredQualifications 는 [] 다", () => {
    expect(toLoadedContext(baseRows()).bid.structuredQualifications).toEqual([]);
  });

  it("normalized 가 공고 요약 계약에 맞지 않으면(title 빈 값) AnalysisInputError 를 던진다", () => {
    const invalid = rowsWith((draft) => {
      draft.revision.normalized = { ...NORMALIZED, title: "" };
    });
    expect(thrownBy(() => toLoadedContext(invalid))).toBeInstanceOf(AnalysisInputError);
  });
});

describe("toLoadedContext · 첨부 문제 판정(PENDING 은 문제가 아니다)", () => {
  const withDocuments = (documents: RevisionDocumentText[]) =>
    rowsWith((draft) => {
      draft.documents = documents;
    });

  it.each<[RevisionDocumentText["downloadStatus"], RevisionDocumentText["parseStatus"]]>([
    ["PENDING", null],
    ["OK", "PENDING"],
    ["OK", "PARSED"],
  ])("다운로드 %s·파싱 %s 만 있으면 bid 에 attachmentsIncomplete 키가 없다", (download, parse) => {
    const loaded = toLoadedContext(
      withDocuments([documentText({ downloadStatus: download, parseStatus: parse })]),
    );
    expect(loaded.bid).not.toHaveProperty("attachmentsIncomplete");
  });

  it.each<[RevisionDocumentText["downloadStatus"], RevisionDocumentText["parseStatus"]]>([
    ["PENDING", null],
    ["OK", "PENDING"],
    ["OK", "PARSED"],
  ])("다운로드 %s·파싱 %s 는 documentIssues 에 넣지 않는다", (download, parse) => {
    const loaded = toLoadedContext(
      withDocuments([documentText({ downloadStatus: download, parseStatus: parse })]),
    );
    expect(loaded.documentIssues).toEqual([]);
  });

  it.each<[RevisionDocumentText["downloadStatus"], RevisionDocumentText["parseStatus"]]>([
    ["FAILED", null],
    ["OK", "PARTIAL"],
    ["OK", "UNSUPPORTED"],
    ["OK", "FAILED"],
  ])("다운로드 %s·파싱 %s 면 bid.attachmentsIncomplete 가 true 다", (download, parse) => {
    const loaded = toLoadedContext(
      withDocuments([documentText({ downloadStatus: download, parseStatus: parse })]),
    );
    expect(loaded.bid.attachmentsIncomplete).toBe(true);
  });

  it.each<[RevisionDocumentText["downloadStatus"], RevisionDocumentText["parseStatus"]]>([
    ["FAILED", null],
    ["OK", "PARTIAL"],
    ["OK", "UNSUPPORTED"],
    ["OK", "FAILED"],
  ])("다운로드 %s·파싱 %s 는 documentIssues 한 건이다", (download, parse) => {
    const loaded = toLoadedContext(
      withDocuments([documentText({ downloadStatus: download, parseStatus: parse })]),
    );
    expect(loaded.documentIssues).toHaveLength(1);
  });

  it("seed 첨부(PENDING)만 있는 FX-01 은 attachmentsIncomplete 키가 없고 documentIssues 가 [] 다", () => {
    const loaded = toLoadedContext(withDocuments(seedDocumentsFor("FX-01")));
    expect(seedDocumentsFor("FX-01").length).toBeGreaterThan(0);
    expect(loaded.bid).not.toHaveProperty("attachmentsIncomplete");
    expect(loaded.documentIssues).toEqual([]);
  });

  it("첨부가 없으면 attachmentsIncomplete 키가 없고 documentIssues 가 [] 다", () => {
    const loaded = toLoadedContext(withDocuments([]));
    expect(loaded.bid).not.toHaveProperty("attachmentsIncomplete");
    expect(loaded.documentIssues).toEqual([]);
  });

  it("documentIssues 는 documentId·downloadStatus·parseStatus(없으면 NOT_PARSED)·errorCode(다운로드 오류 우선)다", () => {
    const loaded = toLoadedContext(
      withDocuments([
        documentText({
          documentId: "doc-a",
          downloadStatus: "FAILED",
          downloadErrorCode: "HTTP_5XX",
          parseStatus: null,
          text: null,
          pages: [],
        }),
        documentText({
          documentId: "doc-b",
          downloadStatus: "OK",
          parseStatus: "UNSUPPORTED",
          parseErrorCode: "ENCRYPTED",
          text: null,
          pages: [],
        }),
      ]),
    );
    expect(loaded.documentIssues).toEqual([
      {
        documentId: "doc-a",
        downloadStatus: "FAILED",
        parseStatus: "NOT_PARSED",
        errorCode: "HTTP_5XX",
      },
      {
        documentId: "doc-b",
        downloadStatus: "OK",
        parseStatus: "UNSUPPORTED",
        errorCode: "ENCRYPTED",
      },
    ]);
  });

  it("다운로드·파싱 오류 코드가 둘 다 있으면 errorCode 는 다운로드 오류 코드다", () => {
    const loaded = toLoadedContext(
      withDocuments([
        documentText({
          downloadStatus: "FAILED",
          downloadErrorCode: "TIMEOUT",
          parseStatus: "FAILED",
          parseErrorCode: "PARSER_ERROR",
          text: null,
          pages: [],
        }),
      ]),
    );
    expect(loaded.documentIssues.map((issue) => issue.errorCode)).toEqual(["TIMEOUT"]);
  });

  it("documentIssues 는 documentId 순이다(첨부 port 의 순서와 무관)", () => {
    const loaded = toLoadedContext(
      withDocuments([
        documentText({ documentId: "doc-z", parseStatus: "FAILED", parseErrorCode: "CORRUPTED" }),
        documentText({ documentId: "doc-m", parseStatus: "PARTIAL" }),
        documentText({ documentId: "doc-c", parseStatus: "PARSED" }),
      ]),
    );
    expect(loaded.documentIssues.map((issue) => issue.documentId)).toEqual(["doc-m", "doc-z"]);
  });
});

describe("toLoadedContext · 추출 캐시 행", () => {
  const TRANSLATIONS = { "summary.value": "Virtual summary" };

  it.each(["COMPLETED", "PENDING_REVIEW", "FAILED"])(
    "status %s 행은 id·status·payload·translations 를 그대로 싣는다",
    (status) => {
      const rows = rowsWith((draft) => {
        draft.extraction = {
          id: "extraction-1",
          status,
          payload: { a: 1 },
          translations: TRANSLATIONS,
        };
      });
      expect(toLoadedContext(rows).extraction).toEqual({
        id: "extraction-1",
        status,
        payload: { a: 1 },
        translations: TRANSLATIONS,
      });
    },
  );

  it("status 가 PENDING 이면 null 로 본다", () => {
    const rows = rowsWith((draft) => {
      draft.extraction = { id: "extraction-1", status: "PENDING", payload: {}, translations: null };
    });
    expect(toLoadedContext(rows).extraction).toBeNull();
  });

  it("행이 없으면 null 이다", () => {
    const rows = rowsWith((draft) => {
      draft.extraction = null;
    });
    expect(toLoadedContext(rows).extraction).toBeNull();
  });

  it("seed 추출 행(FX-01)의 id 를 그대로 싣는다", () => {
    expect(toLoadedContext(baseRows()).extraction?.id).toBe(seedBid("FX-01").extraction.id);
  });
});

describe("toLoadedContext · 회사 프로필", () => {
  it("company_profiles 열을 CompanyProfile 필드로 옮긴다", () => {
    const { profile } = baseRows();
    expect(toLoadedContext(baseRows()).profile).toEqual(
      companyProfileSchema.parse({
        revision: profile.revision,
        name: profile.name,
        isDemo: profile.is_demo,
        technologies: profile.technologies,
        technologiesComplete: profile.technologies_complete,
        licenses: profile.licenses,
        industryCodes: profile.industry_codes,
        pastProjects: profile.past_projects,
        financials: profile.financials,
        preferences: profile.preferences,
      }),
    );
  });

  it("seed 프로필은 revision 2 다", () => {
    expect(toLoadedContext(baseRows()).profile.revision).toBe(2);
  });

  const SECRET_STATUS = "SECRET-LICENSE-STATUS";
  const invalidProfile = () =>
    rowsWith((draft) => {
      draft.profile.licenses = [{ code: "X", name: "가상 면허", status: SECRET_STATUS }];
    });

  it("프로필이 계약에 맞지 않으면 AnalysisInputError 를 던진다", () => {
    expect(thrownBy(() => toLoadedContext(invalidProfile()))).toBeInstanceOf(AnalysisInputError);
  });

  it("프로필 검증 오류 message 에 틀린 값이 없다", () => {
    const error = thrownBy(() => toLoadedContext(invalidProfile()));
    expect(error).toBeInstanceOf(Error);
    expect(String(error instanceof Error ? error.message : error)).not.toContain(SECRET_STATUS);
  });
});

describe("toLoadedContext · 인력(team_member_scoring + assignments)", () => {
  const sortedSeed = () =>
    SEED_TEAM_SCORING.toSorted((left, right) => (left.member_id < right.member_id ? -1 : 1));

  it("team_member_scoring 행은 member_id 를 personId 로 한 member 다(접힌 availability 그대로)", () => {
    expect(toLoadedContext(baseRows()).team.members).toEqual(
      sortedSeed().map((row) => ({
        personId: row.member_id,
        role: row.role,
        grade: row.grade,
        skills: row.skills,
        availability: row.availability,
      })),
    );
  });

  it("members 는 member_id 순이다(행 순서와 무관)", () => {
    const reversed = rowsWith((draft) => {
      draft.teamScoring = [...draft.teamScoring].reverse();
    });
    expect(toLoadedContext(reversed).team.members.map((member) => member.personId)).toEqual(
      sortedSeed().map((row) => row.member_id),
    );
  });

  it("assignments 행은 personId·startsAt·endsAt·allocationPercent 로 옮긴다", () => {
    const { assignments } = toLoadedContext(baseRows()).team;
    const expected = baseRows().assignments.map((row) => ({
      personId: row.member_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allocationPercent: row.allocation_percent,
    }));
    expect(assignments).toHaveLength(SEED_ASSIGNMENTS.length);
    expect(assignments).toEqual(expect.arrayContaining(expected));
  });

  it("team.asOf 는 queued_at 을 ISO 로 바꾼 값이다", () => {
    expect(toLoadedContext(baseRows()).team.asOf).toBe(QUEUED_AT);
  });

  it("skills 가 배열이 아니면 AnalysisInputError 를 던진다", () => {
    const rows = rowsWith((draft) => {
      draft.teamScoring[0].skills = "TypeScript";
    });
    expect(thrownBy(() => toLoadedContext(rows))).toBeInstanceOf(AnalysisInputError);
  });

  it("availability 의 fte 가 1 을 넘으면 AnalysisInputError 를 던진다", () => {
    const rows = rowsWith((draft) => {
      draft.teamScoring[0].availability = [
        { startsAt: "2026-12-01", endsAt: "2027-07-01", fte: 1.5 },
      ];
    });
    expect(thrownBy(() => toLoadedContext(rows))).toBeInstanceOf(AnalysisInputError);
  });
});

// ── 읽기: /extract 원문 ──

describe("toExtractSource", () => {
  it("body 는 normalized.content 다", () => {
    expect(toExtractSource(NORMALIZED, []).body).toBe(NORMALIZED.content);
  });

  it("attachments 는 text 가 있는 문서만 documentId·text·pages 로 순서대로 싣는다", () => {
    const documents = [
      documentText({ documentId: "doc-b", text: "본문 B", pages: [{ page: 1, charOffset: 0 }] }),
      documentText({
        documentId: "doc-p",
        downloadStatus: "PENDING",
        parseStatus: null,
        text: null,
        pages: [],
      }),
      documentText({
        documentId: "doc-a",
        parseStatus: "PARTIAL",
        text: "본문 A",
        pages: [
          { page: 1, charOffset: 0 },
          { page: 2, charOffset: 4 },
        ],
      }),
    ];
    expect(toExtractSource(NORMALIZED, documents).attachments).toEqual([
      { documentId: "doc-b", text: "본문 B", pages: [{ page: 1, charOffset: 0 }] },
      {
        documentId: "doc-a",
        text: "본문 A",
        pages: [
          { page: 1, charOffset: 0 },
          { page: 2, charOffset: 4 },
        ],
      },
    ]);
  });

  it("normalized.content 가 문자열이 아니면 AnalysisInputError 를 던진다", () => {
    expect(thrownBy(() => toExtractSource({ ...NORMALIZED, content: 12 }, []))).toBeInstanceOf(
      AnalysisInputError,
    );
  });

  it("normalized 가 객체가 아니면 AnalysisInputError 를 던진다", () => {
    expect(thrownBy(() => toExtractSource("본문", []))).toBeInstanceOf(AnalysisInputError);
  });
});

describe("EMPTY_ATTACHMENT_READER", () => {
  it("어떤 revision 이든 빈 목록을 돌려준다", async () => {
    await expect(EMPTY_ATTACHMENT_READER.readRevisionDocuments(RUN_ID)).resolves.toEqual([]);
  });
});

// ── 쓰기: 추출 ──

describe("toExtractionRow", () => {
  const extraction = loadExtraction("FX-01");
  const record = toExtractionRecord(
    buildContext("FX-01"),
    extractBody(extraction, {
      status: "PENDING_REVIEW",
      translations: { "summary.value": "Virtual summary" },
      warnings: ["ATTACHMENT_PARSE_FAILED:doc-1"],
    }),
    extraction,
  );

  it("ExtractionRecord 를 requirement_extractions 열로 옮긴다(provider 대문자)", () => {
    expect(toExtractionRow(record)).toEqual({
      bid_id: record.bidId,
      revision_id: record.revisionId,
      provider: "MOCK",
      model_name: record.modelName,
      prompt_version: record.promptVersion,
      prompt_hash: record.promptHash,
      schema_version: record.schemaVersion,
      status: "PENDING_REVIEW",
      payload: record.payload,
      translations: { "summary.value": "Virtual summary" },
      warnings: ["ATTACHMENT_PARSE_FAILED:doc-1"],
      latency_ms: record.latencyMs,
      retries: record.retries,
    });
  });

  it.each<[AnalysisRunRecord["meta"]["model"]["provider"], string]>([
    ["mock", "MOCK"],
    ["local", "LOCAL"],
    ["hosted", "HOSTED"],
  ])("provider %s 는 %s 로 쓴다", (provider, column) => {
    expect(toExtractionRow({ ...record, provider }).provider).toBe(column);
  });
});

// ── 사전 분석: 다시 읽은 run 이 이 사전 분석이 넣은 run 인가 ──
// ensureQueuedRun 은 idempotency_key 충돌이면 넣지 않고 그 키로 다시 읽는다. 같은 키의 run 을 화면 사용자가 먼저 넣었거나
// (requested_by 있음) 다른 공고·revision·프로필의 run 이면 사전 분석의 run 이 아니다. 그런 run 을 큐에 넣지 않는다.

describe("isOwnPreanalyzeRun", () => {
  const FX01 = seedBid("FX-01");
  const OTHER_UUID = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
  const INPUT: PreanalyzeRunInput = {
    orgId: ORG_ID,
    bidId: FX01.notice.id,
    revisionId: FX01.revision.id,
    companyProfileId: SEED_PROFILE.id,
    profileRevision: SEED_PROFILE.revision,
    extractionId: FX01.extraction.id,
    idempotencyKey: `${ORG_ID}:demo-pre-FX-01-r01`,
  };
  type ReadRow = {
    id: string;
    status: string;
    requested_by: string | null;
    bid_id: string;
    revision_id: string;
    company_profile_id: string;
  };
  const ownRow = (): ReadRow => ({
    id: RUN_ID,
    status: "QUEUED",
    requested_by: null,
    bid_id: INPUT.bidId,
    revision_id: INPUT.revisionId,
    company_profile_id: INPUT.companyProfileId,
  });

  it("requested_by 가 null 이고 bid_id·revision_id·company_profile_id 가 입력과 같으면 true 다", () => {
    expect(isOwnPreanalyzeRun(ownRow(), INPUT)).toBe(true);
  });

  it("이미 끝난 run(COMPLETED)이어도 입력이 같으면 true 다(상태는 보지 않는다)", () => {
    expect(isOwnPreanalyzeRun({ ...ownRow(), status: "COMPLETED" }, INPUT)).toBe(true);
  });

  it.each<[string, Partial<ReadRow>]>([
    ["requested_by 가 있다(화면 사용자가 넣은 run)", { requested_by: OTHER_UUID }],
    ["bid_id 가 다르다", { bid_id: OTHER_UUID }],
    ["revision_id 가 다르다", { revision_id: OTHER_UUID }],
    ["company_profile_id 가 다르다", { company_profile_id: OTHER_UUID }],
  ])("%s 면 false 다", (_label, patch) => {
    expect(isOwnPreanalyzeRun({ ...ownRow(), ...patch }, INPUT)).toBe(false);
  });
});

// ── 쓰기: score_runs 상태 ──

// markRunning·markFailed 입력의 expected(읽은 run 상태)는 쓰기 조건이라 갱신 본문에 싣지 않는다.
const QUEUED_CLAIM = { status: "QUEUED", startedAt: null } as const;
const RUNNING_CLAIM = { status: "RUNNING", startedAt: "2026-10-16T09:00:00.000Z" } as const;

describe("toRunningUpdate · toFailedUpdate", () => {
  it("markRunning 입력을 RUNNING·started_at·run_mode·ai_provider(대문자)로 옮긴다", () => {
    expect(
      toRunningUpdate({
        orgId: ORG_ID,
        scoreRunId: RUN_ID,
        runMode: "fixture",
        aiProvider: "local",
        startedAt: "2026-10-16T09:00:00.000Z",
        expected: QUEUED_CLAIM,
      }),
    ).toEqual({
      status: "RUNNING",
      started_at: "2026-10-16T09:00:00.000Z",
      run_mode: "FIXTURE",
      ai_provider: "LOCAL",
    });
  });

  it.each<["live" | "fixture" | "mock", string]>([
    ["live", "LIVE"],
    ["fixture", "FIXTURE"],
    ["mock", "MOCK"],
  ])("run_mode %s 는 %s 다", (runMode, column) => {
    const update = toRunningUpdate({
      orgId: ORG_ID,
      scoreRunId: RUN_ID,
      runMode,
      aiProvider: "mock",
      startedAt: "2026-10-16T09:00:00.000Z",
      expected: QUEUED_CLAIM,
    });
    expect(update.run_mode).toBe(column);
  });

  it("markFailed 입력을 FAILED·error_code·finished_at 으로 옮긴다", () => {
    expect(
      toFailedUpdate({
        orgId: ORG_ID,
        scoreRunId: RUN_ID,
        errorCode: "ANALYSIS_JOB_FAILED",
        finishedAt: "2026-10-16T09:00:05.000Z",
        expected: RUNNING_CLAIM,
      }),
    ).toEqual({
      status: "FAILED",
      error_code: "ANALYSIS_JOB_FAILED",
      finished_at: "2026-10-16T09:00:05.000Z",
    });
  });
});

// ── 쓰기: score_runs 결과 ──

describe("toScoreRunResultUpdate", () => {
  it("FX-01 레코드를 score_runs 결과 열로 옮긴다", () => {
    const record = FX01_RECORD;
    const { result, meta } = record;
    expect(toScoreRunResultUpdate(record)).toEqual({
      status: result.status,
      score: result.score,
      recommendation: result.recommendation,
      recommendation_basis: result.recommendationBasis,
      error_code: result.errorCode,
      injection_suspected: result.injectionSuspected,
      explanation: meta.explanation.text,
      review_flags: [...new Set<string>([...result.reviewFlags, ...meta.extraReviewFlags])],
      missing_factors: [...new Set(result.missingFactors.map((missing) => missing.factor))],
      input_snapshot: record.input,
      input_snapshot_hash: result.inputSnapshotHash,
      kev_output: record.kevOutput,
      kev_assist: result.kev,
      model_metadata: { ...meta.model, explanationSource: meta.explanation.source },
      qwen_model: meta.model.qwen?.name,
      prompt_hash: meta.model.qwen?.promptHash,
      kev_model: meta.model.kev?.model,
      question_set_version: meta.model.kev?.questionSetVersion,
      run_mode: "MOCK",
      ai_provider: "MOCK",
      extraction_id: record.extractionId,
      // 보안 검토 후속: 마감은 시도 시작 시각(started_at)을 바꾸지 않는다. 예전 기대(started_at: meta.startedAt)는 이 결정으로 뺐다.
      finished_at: meta.finishedAt,
      kev_calibration: null,
      fallback_reason: null,
    });
  });

  it("started_at 열이 없다 — started_at 은 markRunning 이 쓴 시도 시작 시각이고 마감이 바꾸지 않는다(보안 검토 후속)", () => {
    for (const record of [FX01_RECORD, FX03_RECORD, S6_RECORD, FX11_RECORD]) {
      expect(Object.keys(toScoreRunResultUpdate(record))).not.toContain("started_at");
    }
  });

  it("마감 열은 24개다(결과·모델·실행 정보·finished_at, started_at 제외)", () => {
    expect(Object.keys(toScoreRunResultUpdate(FX01_RECORD)).toSorted()).toEqual(
      [
        "status",
        "score",
        "recommendation",
        "recommendation_basis",
        "error_code",
        "injection_suspected",
        "explanation",
        "review_flags",
        "missing_factors",
        "input_snapshot",
        "input_snapshot_hash",
        "kev_output",
        "kev_assist",
        "model_metadata",
        "qwen_model",
        "prompt_hash",
        "kev_model",
        "question_set_version",
        "run_mode",
        "ai_provider",
        "extraction_id",
        "finished_at",
        "kev_calibration",
        "fallback_reason",
      ].toSorted(),
    );
  });

  it("FX-01 의 qwen_model·prompt_hash·kev_model·question_set_version 이 비어 있지 않다(전제)", () => {
    const update = toScoreRunResultUpdate(FX01_RECORD);
    expect(update.qwen_model).toEqual(expect.any(String));
    expect(update.prompt_hash).toEqual(expect.any(String));
    expect(update.kev_model).toEqual(expect.any(String));
    expect(update.question_set_version).toEqual(expect.any(String));
  });

  it("review_flags 는 result.reviewFlags 뒤에 extraReviewFlags 를 중복 없이 순서대로 잇는다", () => {
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.result.reviewFlags = ["KEV_NEEDS_REVIEW", "AI_UNAVAILABLE", "KEV_NEEDS_REVIEW"];
      draft.meta.extraReviewFlags = ["KEV_UNAVAILABLE", "CITATION_FAILED", "KEV_UNAVAILABLE"];
    });
    expect(toScoreRunResultUpdate(record).review_flags).toEqual([
      "KEV_NEEDS_REVIEW",
      "AI_UNAVAILABLE",
      "KEV_UNAVAILABLE",
      "CITATION_FAILED",
    ]);
  });

  it("missing_factors 는 missingFactors 의 factor 를 중복 없이 순서대로 쓴다", () => {
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.result.missingFactors = [
        { factor: "staffAvailability", reason: "TEAM_EMPTY" },
        { factor: "skillMatch", reason: "NO_REQUIREMENTS_EXTRACTED" },
        { factor: "staffAvailability", reason: "REQUIRED_FTE_UNKNOWN" },
      ];
    });
    expect(toScoreRunResultUpdate(record).missing_factors).toEqual([
      "staffAvailability",
      "skillMatch",
    ]);
  });

  it("S6(PARTIAL)은 status PARTIAL·error_code AI_UNAVAILABLE·review_flags 에 AI_UNAVAILABLE 이다", () => {
    const update = toScoreRunResultUpdate(S6_RECORD);
    expect(update.status).toBe("PARTIAL");
    expect(update.error_code).toBe("AI_UNAVAILABLE");
    expect(update.review_flags).toContain("AI_UNAVAILABLE");
  });

  it("S6(Kev 없음)은 kev_output·kev_model·question_set_version 이 null 이다", () => {
    const update = toScoreRunResultUpdate(S6_RECORD);
    expect(update.kev_output).toBeNull();
    expect(update.kev_model).toBeNull();
    expect(update.question_set_version).toBeNull();
  });

  it("kev_assist 는 result.kev(C4 KevAssist)다 — FX-01 은 enabled·suggestedOption BID·probabilities 가 fixtures/kev/FX-01.json 값이다", () => {
    const { recommendation } = loadKevResponses("FX-01");
    const update = toScoreRunResultUpdate(FX01_RECORD);
    expect(update.kev_assist).toEqual(FX01_RECORD.result.kev);
    expect(update.kev_assist).toMatchObject({
      enabled: true,
      suggestedOption: "BID",
      probabilities: recommendation.probabilities,
    });
  });

  it.each([
    ["S6(Kev 장애·PARTIAL)", S6_RECORD],
    ["FX-11(Kev 꺼짐·COMPLETED)", FX11_RECORD],
  ])(
    "%s 도 kev_assist 는 null 이 아니라 enabled=false 인 result.kev 객체(disclaimer 포함)다",
    (_name, record) => {
      const update = toScoreRunResultUpdate(record);
      expect(update.kev_assist).toEqual(record.result.kev);
      expect(update.kev_assist).toMatchObject({
        enabled: false,
        suggestedOption: null,
        probabilities: null,
        disclaimer: KEV_DISCLAIMER,
      });
    },
  );

  it("meta.model.qwen 이 null 이면 qwen_model·prompt_hash 가 null 이다", () => {
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.meta.model.qwen = null;
    });
    const update = toScoreRunResultUpdate(record);
    expect(update.qwen_model).toBeNull();
    expect(update.prompt_hash).toBeNull();
  });

  it("extractionId 가 null 이면 extraction_id 도 null 이다", () => {
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.extractionId = null;
    });
    expect(toScoreRunResultUpdate(record).extraction_id).toBeNull();
  });

  it.each<
    [
      AnalysisRunRecord["meta"]["runMode"],
      AnalysisRunRecord["meta"]["model"]["provider"],
      string,
      string,
    ]
  >([
    ["fixture", "local", "FIXTURE", "LOCAL"],
    ["live", "hosted", "LIVE", "HOSTED"],
  ])(
    "run_mode %s·ai_provider %s 는 대문자 %s·%s 다",
    (runMode, provider, runModeColumn, providerColumn) => {
      const record = withPatch(FX01_RECORD, (draft) => {
        draft.meta.runMode = runMode;
        draft.meta.model.provider = provider;
      });
      const update = toScoreRunResultUpdate(record);
      expect(update.run_mode).toBe(runModeColumn);
      expect(update.ai_provider).toBe(providerColumn);
    },
  );
});

// ── 쓰기: 결과 저장 RPC 의 p(보안 검토 후속) ──
// sink 는 finish_score_run(p) 를 한 번 부른다. p 는 저장 매핑 함수 넷의 출력과 run·조직·시도 식별자다(매핑 규칙은 그대로).

describe("toFinishScoreRunPayload", () => {
  it("FX-01: { score_run_id, org_id, attempt_started_at, run, factors, assessments, checks } 이고 각 값은 레코드와 저장 매핑 함수의 출력이다", () => {
    const record = FX01_RECORD;
    expect(toFinishScoreRunPayload(record)).toEqual({
      score_run_id: record.scoreRunId,
      org_id: record.orgId,
      attempt_started_at: record.attemptStartedAt,
      run: toScoreRunResultUpdate(record),
      factors: toScoreFactorRows(record),
      assessments: toRequirementAssessmentRows(record),
      checks: toQualificationCheckRows(record),
    });
  });

  it("키는 일곱 개뿐이다", () => {
    expect(Object.keys(toFinishScoreRunPayload(FX01_RECORD)).toSorted()).toEqual(
      [
        "score_run_id",
        "org_id",
        "attempt_started_at",
        "run",
        "factors",
        "assessments",
        "checks",
      ].toSorted(),
    );
  });

  it("attempt_started_at 은 context.attemptStartedAt 이다(runAnalysis 가 옮긴 값, meta.startedAt 이 아니다)", () => {
    const payload = toFinishScoreRunPayload(FX01_RECORD);
    expect(payload.attempt_started_at).toBe(ATTEMPT_STARTED_AT);
    expect(FX01_RECORD.meta.startedAt).toBe(STARTED_AT);
    expect(payload.attempt_started_at).not.toBe(FX01_RECORD.meta.startedAt);
  });

  it("score_run_id·org_id·attempt_started_at 은 레코드 값을 그대로 옮긴다", () => {
    const record = withPatch(FX03_RECORD, (draft) => {
      draft.scoreRunId = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
      draft.orgId = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
      draft.attemptStartedAt = "2026-10-16T09:00:00.123Z";
    });
    expect(toFinishScoreRunPayload(record)).toMatchObject({
      score_run_id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      org_id: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
      attempt_started_at: "2026-10-16T09:00:00.123Z",
    });
  });

  it("run 에 started_at 이 없다", () => {
    expect(Object.keys(toFinishScoreRunPayload(FX01_RECORD).run)).not.toContain("started_at");
  });

  it.each([
    ["FX-03(NO_BID)", FX03_RECORD],
    ["S6(PARTIAL·Kev 없음)", S6_RECORD],
    ["FX-11(Kev 꺼짐)", FX11_RECORD],
  ])("%s 도 run·factors·assessments·checks 가 저장 매핑 함수의 출력이다", (_name, record) => {
    expect(toFinishScoreRunPayload(record)).toMatchObject({
      run: toScoreRunResultUpdate(record),
      factors: toScoreFactorRows(record),
      assessments: toRequirementAssessmentRows(record),
      checks: toQualificationCheckRows(record),
    });
  });

  it("항목 판정·자격 판정이 없으면 assessments·checks 는 빈 배열이다(키를 빼지 않는다)", () => {
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.result.requirementAssessments = [];
      draft.result.qualificationChecks = [];
    });
    const payload = toFinishScoreRunPayload(record);
    expect(payload.assessments).toEqual([]);
    expect(payload.checks).toEqual([]);
    expect(payload.factors).toHaveLength(5);
  });

  it("JSON 으로 한 번 오가도 같다(undefined·Date 가 없어 RPC 본문으로 그대로 간다)", () => {
    for (const record of [FX01_RECORD, FX03_RECORD, S6_RECORD, FX11_RECORD]) {
      const payload = toFinishScoreRunPayload(record);
      expect(JSON.parse(JSON.stringify(payload))).toStrictEqual(payload);
    }
  });
});

// ── 쓰기: 자식 3표 ──

describe("toScoreFactorRows", () => {
  it("result.factors 를 score_factors 열로 옮긴다", () => {
    const record = FX01_RECORD;
    expect(toScoreFactorRows(record)).toEqual(
      record.result.factors.map((factor) => ({
        score_run_id: record.scoreRunId,
        org_id: record.orgId,
        factor: factor.factor,
        raw_value: factor.rawValue,
        normalized: factor.normalized,
        points: factor.points,
        max_points: factor.maxPoints,
        missing: factor.missing,
        missing_reason: factor.missingReason,
        evidence: factor.evidence,
        note: factor.note,
      })),
    );
  });

  it("다섯 요소 다섯 행이다", () => {
    expect(toScoreFactorRows(FX01_RECORD)).toHaveLength(5);
  });

  it("FX-11 은 COMPLETED 이고 missingFactors 가 scaleFit=BUDGET_UNKNOWN 하나다(전제)", () => {
    expect(FX11_RECORD.result.status).toBe("COMPLETED");
    expect(FX11_RECORD.result.missingFactors).toEqual([
      { factor: "scaleFit", reason: "BUDGET_UNKNOWN" },
    ]);
  });

  it("missing_reason 은 요소의 missingReason 이다 — FX-11 은 scaleFit 만 BUDGET_UNKNOWN 이고 나머지 네 요소는 null 이다", () => {
    expect(
      Object.fromEntries(
        toScoreFactorRows(FX11_RECORD).map((row) => [row.factor, row.missing_reason]),
      ),
    ).toEqual({
      skillMatch: null,
      pastPerformance: null,
      staffAvailability: null,
      scaleFit: "BUDGET_UNKNOWN",
      strategicPreference: null,
    });
  });

  it("missing_reason 은 요소마다 C4 값을 바꾸지 않고 옮긴다(사유 다섯 개)", () => {
    const reasons: MissingReason[] = [
      "NO_REQUIREMENTS_EXTRACTED",
      "PROFILE_PROJECTS_EMPTY",
      "TEAM_EMPTY",
      "BUDGET_UNKNOWN",
      "PREFERENCES_NOT_SET",
    ];
    const record = withPatch(FX01_RECORD, (draft) => {
      draft.result.factors = draft.result.factors.map((factor, index) => ({
        ...factor,
        missing: true,
        missingReason: reasons[index] ?? null,
      }));
    });
    expect(toScoreFactorRows(record).map((row) => row.missing_reason)).toEqual(reasons);
  });
});

// ── 생성 타입: 화면 표시용 열(20261019000010) ──

type GeneratedTables = Database["public"]["Tables"];

describe("database.types · 화면 표시용 열", () => {
  // 타입 단언이라 type-check(tsc)가 잡는다. Json 은 이미 null 을 품어서 kev_assist 의 null 허용은 타입으로 구분되지 않는다
  // (그것은 scripts/database.test.mjs 의 열 시험 몫이다). 여기서는 열이 있고 JSON 열인지만 본다.
  it("score_factors.missing_reason 은 string | null 이고 score_runs.kev_assist 는 Json 이다(Row·Insert·Update)", () => {
    expectTypeOf<GeneratedTables["score_factors"]["Row"]["missing_reason"]>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<GeneratedTables["score_factors"]["Insert"]["missing_reason"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<GeneratedTables["score_runs"]["Row"]["kev_assist"]>().toEqualTypeOf<Json>();
    expectTypeOf<GeneratedTables["score_runs"]["Update"]["kev_assist"]>().toEqualTypeOf<
      Json | undefined
    >();
  });
});

// ── 생성 타입: 결과 저장 RPC(20261019000011, pnpm db:types) ──

describe("database.types · finish_score_run", () => {
  // 타입 단언이라 type-check(tsc)가 잡는다. 마이그레이션 뒤 db:types 를 다시 만들지 않으면 빨갛다.
  it("Functions.finish_score_run 은 { p: Json } 을 받아 run id(string)를 돌려준다", () => {
    type FinishScoreRun = Database["public"]["Functions"]["finish_score_run"];
    expectTypeOf<FinishScoreRun["Args"]>().toEqualTypeOf<{ p: Json }>();
    expectTypeOf<FinishScoreRun["Returns"]>().toEqualTypeOf<string>();
  });
});

describe("toQualificationCheckRows", () => {
  it("FX-03 에 NOT_SATISFIED 자격 판정이 있다(전제)", () => {
    expect(FX03_RECORD.result.qualificationChecks.map((check) => check.outcome)).toContain(
      "NOT_SATISFIED",
    );
  });

  it("result.qualificationChecks 를 qualification_checks 열로 옮긴다(bid_id·revision_id 는 레코드 값)", () => {
    const record = FX03_RECORD;
    expect(toQualificationCheckRows(record)).toEqual(
      record.result.qualificationChecks.map((check) => ({
        score_run_id: record.scoreRunId,
        org_id: record.orgId,
        bid_id: record.bidId,
        revision_id: record.revisionId,
        requirement_code: check.requirementCode,
        requirement_name: check.requirementName,
        mandatory: check.mandatory,
        outcome: check.outcome,
        reason_code: check.reasonCode,
        reason: check.reason,
        basis: check.basis,
        evidence: check.evidence,
        profile_evidence: check.profileEvidence,
        company_evidence: check.companyEvidence,
      })),
    );
  });
});

describe("toRequirementAssessmentRows", () => {
  it("FX-01 에 항목 판정이 있다(전제)", () => {
    expect(FX01_RECORD.result.requirementAssessments.length).toBeGreaterThan(0);
  });

  it("result.requirementAssessments 를 requirement_assessments 열로 옮기고 kev_* 는 null 이다", () => {
    const record = FX01_RECORD;
    expect(toRequirementAssessmentRows(record)).toEqual(
      record.result.requirementAssessments.map((assessment) => ({
        score_run_id: record.scoreRunId,
        org_id: record.orgId,
        item_id: assessment.itemId,
        item_kind: assessment.itemKind,
        rule_status: assessment.ruleStatus,
        rule_reason: assessment.ruleReason,
        basis: assessment.basis,
        notice_evidence: assessment.noticeEvidence,
        company_evidence: assessment.companyEvidence,
        kev_distribution: null,
        kev_label: null,
        flags: assessment.flags,
      })),
    );
  });
});

describe("자식 3표 매핑의 score_run_id·org_id", () => {
  const OTHER_RUN = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
  const OTHER_ORG = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
  const record = withPatch(FX03_RECORD, (draft) => {
    draft.scoreRunId = OTHER_RUN;
    draft.orgId = OTHER_ORG;
  });

  const mappings: [string, () => { score_run_id: string; org_id: string }[]][] = [
    ["toScoreFactorRows", () => toScoreFactorRows(record)],
    ["toQualificationCheckRows", () => toQualificationCheckRows(record)],
    ["toRequirementAssessmentRows", () => toRequirementAssessmentRows(record)],
  ];

  it.each(mappings)("%s 의 모든 행이 record.scoreRunId·record.orgId 를 갖는다", (_name, rowsOf) => {
    const rows = rowsOf();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.score_run_id).toBe(OTHER_RUN);
      expect(row.org_id).toBe(OTHER_ORG);
    }
  });
});
