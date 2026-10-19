// demo/plan.mjs — 데모 seed(pnpm demo:reset)의 순수 계획. 디스크·네트워크·시각을 모른다.
//
// 정본: docs/04-DATABASE.md §6(seed 범위·멱등), docs/08-SCORING.md §6.1(회사 프로필),
// docs/19-DEMO-SCENARIO.md §1(계정)·§3(사전 리뷰), docs/10-DEPLOYMENT.md 기동 절차 6(마지막 줄 형식).
//
// 여기 함수는 모두 같은 입력에 같은 출력을 낸다. 공고 적재는 C3 수집 도메인(seedFixtureBids)이, 나머지 적재는
// scripts/demo-reset.mjs·scripts/demo/bid-notices.mjs 가 한다. 시험은 scripts/demo-reset.test.mjs.
import { createHash } from "node:crypto";
import { orgUuid, personUuid } from "../people/seed.mjs";

// ── 1. 고정 식별자 ─────────────────────────────────────────────
//
// 다시 돌려도 같은 행이 같은 id 를 갖도록 이름에서 UUID(v5)를 만든다. 조직·인물·카탈로그는 people/seed.mjs 와
// 같은 이름 공간(sol-radar:…)을 쓰고, seed 가 새로 만드는 행은 sol-radar:demo:… 아래에 둔다.

const DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
const uuidV5 = (name) => {
  const bytes = createHash("sha1").update(DNS_NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const demoUuid = (kind, ...parts) => uuidV5(`sol-radar:demo:${kind}:${parts.join(":")}`);

// ── 2. 조직·계정 ───────────────────────────────────────────────

// 이름은 people/seed.mjs 의 organizations upsert 와 같아야 한다(같은 행을 두 곳이 upsert 한다).
export const DEMO_ORGS = [
  { code: "org-01", slug: "org-01", name: "솔리데오" },
  { code: "org-02", slug: "org-02", name: "격리 확인 조직" },
];

export const demoOrgIds = () => DEMO_ORGS.map((org) => orgUuid(org.code));

// 19 §1 의 계정 다섯. admin@ 은 조직 관리(owner)와 업무 관리(ADMIN)를 함께 가진다(10 seed 절).
// 계정은 가입 신고(ADR-019)처럼 부서·직급 코드를 함께 적는다 — 가입 트리거가 카탈로그에서 찾으므로
// 카탈로그를 계정보다 먼저 넣는다. 신고가 없으면 가입 정보 미완료라 업무 API 가 403 PROFILE_INCOMPLETE 다(04 §3.5).
// 신고 카탈로그는 솔리데오 고정이라(check_declared_employment) org-02 계정도 같은 카탈로그에서 고른다.
// 값은 같은 VIEWER 인 org-01 viewer 와 같게 둔다.
export const DEMO_ACCOUNTS = [
  {
    key: "admin",
    email: "admin@soltech.invalid",
    displayName: "김관리",
    org: "org-01",
    orgRole: "owner",
    solRole: "ADMIN",
    departmentCode: "SOL-D025",
    jobTitleCode: "SOL-J007",
  },
  {
    key: "sales",
    email: "sales@soltech.invalid",
    displayName: "이영업",
    org: "org-01",
    orgRole: "member",
    solRole: "SALES",
    departmentCode: "SOL-D026",
    jobTitleCode: "SOL-J010",
  },
  {
    key: "analyst",
    email: "analyst@soltech.invalid",
    displayName: "박분석",
    org: "org-01",
    orgRole: "member",
    solRole: "ANALYST",
    departmentCode: "SOL-D006",
    jobTitleCode: "SOL-J009",
  },
  {
    key: "viewer",
    email: "viewer@soltech.invalid",
    displayName: "최열람",
    org: "org-01",
    orgRole: "member",
    solRole: "VIEWER",
    departmentCode: "SOL-D035",
    jobTitleCode: "SOL-J011",
  },
  {
    key: "outsider",
    email: "viewer@other.invalid",
    displayName: "정외부",
    org: "org-02",
    orgRole: "member",
    solRole: "VIEWER",
    departmentCode: "SOL-D035",
    jobTitleCode: "SOL-J011",
  },
];

// Supabase Auth 의 user_metadata. 가입 트리거(handle_new_user)가 name·department_code·job_title_code 를 읽는다.
export const accountMetadata = (account) => ({
  name: account.displayName,
  ...(account.departmentCode
    ? { department_code: account.departmentCode, job_title_code: account.jobTitleCode }
    : {}),
});

// ── 3. 날짜 ────────────────────────────────────────────────────
//
// 회사 프로필·배정의 유효 시각은 서울 날짜의 0시다. 공고의 상대 날짜(+Nd → KST 18:00)는 C3 수집 도메인
// (web/server/ingestion normalize-date)이 푼다.

const DAY_MS = 24 * 60 * 60 * 1000;

export const seoulDate = (at) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at);

export const addDays = (date, days) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
};

// 서울 날짜(YYYY-MM-DD)의 0시를 UTC ISO 로. 배정·프로필 유효 시각에 쓴다.
export const seoulMidnight = (date) => new Date(`${date}T00:00:00+09:00`).toISOString();

// ── 4. 공고 id ─────────────────────────────────────────────────
//
// 공고 적재(정규화·checksum·SEED 집계)는 C3 seedFixtureBids 가 한다(C3 6-5). 여기서는 다시 돌려도 같은 공고·revision 이
// 같은 id 를 갖게 하는 규칙만 둔다. demo:reset 이 seedFixtureBids 의 idFor 로 넘긴다.

export const bidUuid = (source, noticeId) => demoUuid("bid", source, noticeId);
export const revisionUuid = (source, noticeId, revision) =>
  demoUuid("revision", source, noticeId, revision);

/** C3 IdFor 와 같은 모양. 공고 id 는 차수와 무관하고 revision id 는 차수까지 넣는다. */
export const demoIdFor = (kind, { source, noticeId, revision }) =>
  kind === "bid" ? bidUuid(source, noticeId) : revisionUuid(source, noticeId, revision);

// ── 5. 실행 모드 ───────────────────────────────────────────────

const RUN_MODES = { live: "LIVE", fixture: "FIXTURE", mock: "MOCK" };

export const toRunMode = (value) => {
  const mode = RUN_MODES[String(value ?? "mock").toLowerCase()];
  if (!mode) throw new Error(`SOL_RUN_MODE 값을 모릅니다: ${value}`);
  return mode;
};

// ── 6. mock 추출(requirement_extractions) ─────────────────────
//
// demo:reset 은 추출을 적재하지 않는다(demo-reset.mjs 머리말). 아래 도우미는 분석 저장 시험이 fixture 추출로
// 캐시 행을 만들 때 test-harness 로 쓴다. gateway 의 인용 검증(03 §4.4)은 거치지 않는다.
// fixtures/extractions/FX-xx.json 은 마지막 revision, FX-xx.rNN.json 은 앞선 revision 이다(07 §6.5). r1 행은
// rNN 파일이 있으면 그것을, 없으면 FX-xx.json 을 쓴다. 파일 안의 "FX-xx"·"FX-xx#NN" 은 UUID 로 바꾼다.

export const EXTRACTION_FILE = /^(FX-\d{2})(?:\.r(\d{2}))?\.json$/;

// 파일 이름 목록 → { "FX-01": { latest: "FX-01.json", 1: "FX-07.r01.json" } }
export const indexExtractionFiles = (names) => {
  const index = {};
  for (const name of names) {
    const match = EXTRACTION_FILE.exec(name);
    if (!match) continue;
    const [, fixtureId, revision] = match;
    index[fixtureId] ??= {};
    index[fixtureId][revision ? Number(revision) : "latest"] = name;
  }
  return index;
};

export const extractionFileFor = (index, fixtureId, revision) =>
  index[fixtureId]?.[revision] ?? index[fixtureId]?.latest ?? null;

const replacePlaceholders = (value, replace) =>
  Array.isArray(value)
    ? value.map((item) => replacePlaceholders(item, replace))
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replace)]),
        )
      : typeof value === "string"
        ? (replace[value] ?? value)
        : value;

export const substituteExtractionIds = (extraction, { fixtureId, bidId, revisionIds }) => {
  const replace = Object.fromEntries(
    Object.entries(revisionIds).map(([revision, id]) => [
      `${fixtureId}#${String(revision).padStart(2, "0")}`,
      id,
    ]),
  );
  return { ...replacePlaceholders(extraction, replace), bidId };
};

// 첨부 파싱 실패(FX-05)는 PENDING_REVIEW(07 §6.3). 인용 검증 실패(FX-13)는 gateway 가 필드를 UNKNOWN +
// note "CITATION_FAILED" 로 바꾸는 일(ADR-029 A1)이라 이 도우미는 반영하지 않고, 추출 행의 상태는 COMPLETED 다.
export const extractionStatus = (extraction) =>
  (extraction.warnings ?? []).some((warning) =>
    String(warning).startsWith("ATTACHMENT_PARSE_FAILED"),
  )
    ? "PENDING_REVIEW"
    : "COMPLETED";

export const toExtractionRow = ({ fixtureId, bidId, revisionId, revision, extraction }) => {
  const payload = substituteExtractionIds(extraction, {
    fixtureId,
    bidId,
    revisionIds: { [revision]: revisionId },
  });
  const { model } = extraction;
  return {
    id: demoUuid("extraction", fixtureId, revision, model.promptHash),
    bid_id: bidId,
    revision_id: revisionId,
    provider: String(model.provider).toUpperCase(),
    model_name: model.name,
    prompt_version: model.promptVersion,
    prompt_hash: model.promptHash,
    schema_version: extraction.schemaVersion,
    status: extractionStatus(extraction),
    payload,
    translations: null,
    warnings: extraction.warnings ?? [],
    latency_ms: model.latencyMs ?? 0,
    retries: model.retries ?? 0,
  };
};

// ── 7. 회사 프로필 ─────────────────────────────────────────────
//
// fixtures/company/solideo-profile.json 이 revision 2(08 §6.1 단일 원천)다. revision 1 은 "초기 등록" — 전자정부
// 세대 기술 4개와 2024년 실적 2건만 있고 기술 목록이 완전하지 않다(technologiesComplete=false). 데모는 두 revision
// 의 차이를 보여 준다(04 §6). org-02 는 격리 시연용 빈 프로필 1개다(19 §1).

const INITIAL_TECHNOLOGIES = ["Java", "Spring Boot", "전자정부 표준프레임워크", "PostgreSQL"];
const INITIAL_PROJECTS_BEFORE = "2025-01-01";

export const companyProfileUuid = (orgCode, revision) =>
  demoUuid("company_profile", orgCode, revision);

export const planCompanyProfiles = ({ profile, anchor, createdBy }) => {
  if (profile.orgSlug !== "org-01" || profile.revision !== 2)
    throw new Error("회사 프로필 fixture 는 org-01 revision 2 여야 합니다");
  const anchorDate = seoulDate(anchor);
  const revision2 = {
    id: companyProfileUuid("org-01", 2),
    org_id: orgUuid("org-01"),
    revision: 2,
    name: profile.name,
    technologies: profile.technologies,
    technologies_complete: profile.technologiesComplete,
    licenses: profile.licenses,
    industry_codes: profile.industryCodes,
    past_projects: profile.pastProjects,
    financials: profile.financials,
    preferences: profile.preferences,
    is_demo: true,
    effective_at: seoulMidnight(anchorDate),
    created_by: createdBy["org-01"],
    note: "revision 2: 기술·실적 추가(08 §6.1 가상 프로필)",
  };
  const revision1 = {
    ...revision2,
    id: companyProfileUuid("org-01", 1),
    revision: 1,
    technologies: profile.technologies.filter((technology) =>
      INITIAL_TECHNOLOGIES.includes(technology.name),
    ),
    technologies_complete: false,
    past_projects: profile.pastProjects.filter(
      (project) => project.completedAt < INITIAL_PROJECTS_BEFORE,
    ),
    effective_at: seoulMidnight(addDays(anchorDate, -90)),
    note: "revision 1: 초기 등록(기술 4·실적 2, 목록 불완전)",
  };
  const isolation = {
    id: companyProfileUuid("org-02", 1),
    org_id: orgUuid("org-02"),
    revision: 1,
    name: "격리 확인 조직",
    technologies: [],
    technologies_complete: false,
    licenses: [],
    industry_codes: [],
    past_projects: [],
    financials: null,
    preferences: null,
    is_demo: true,
    effective_at: seoulMidnight(anchorDate),
    created_by: createdBy["org-02"],
    note: "격리 시연용 비교 조직(19 §1)",
  };
  return [revision1, revision2, isolation];
};

// ── 8. 사전 리뷰·배정·감사 ────────────────────────────────────

// 19 §3: FX-01 BID, FX-03 NO-BID 를 seed 가 미리 기록한다(FX-02 WATCH 는 S4 에서 라이브로). score_run 없이
// system_recommendation 을 직접 적고(트리거가 그대로 쓴다), 사유는 10~2000자 check 를 지킨다.
export const DEMO_REVIEWS = [
  {
    fixtureId: "FX-01",
    decision: "BID",
    systemRecommendation: "BID",
    reason:
      "자격 3건 모두 충족, 필수 기술 5개 보유, 필요 인력 12 FTE 대비 가용 20 FTE. 사전 검토에서 입찰 참여로 결정했다.",
  },
  {
    fixtureId: "FX-03",
    decision: "NO_BID",
    systemRecommendation: "NO_BID",
    reason:
      "정보통신공사업 등록이 없어 필수 자격 미충족. Kev 가 BID 를 제시해도 규칙이 우선이므로 사전 검토에서 불참을 결정했다.",
  },
];

export const toReviewRows = ({ bids, reviewerId, decidedAt }) =>
  DEMO_REVIEWS.map((review) => {
    const bid = bids.find((entry) => entry.fixtureId === review.fixtureId);
    if (!bid) throw new Error(`사전 리뷰 대상 공고가 적재되지 않았습니다: ${review.fixtureId}`);
    return {
      id: demoUuid("review", "org-01", review.fixtureId),
      org_id: orgUuid("org-01"),
      bid_id: bid.bidId,
      revision_id: bid.revisionId,
      score_run_id: null,
      reviewer_id: reviewerId,
      assignee_id: null,
      decision: review.decision,
      system_recommendation: review.systemRecommendation,
      reason: review.reason,
      decided_at: decidedAt,
    };
  });

// 04 §6: 배정 2건, 기간 충돌 1건 포함. 두 사람 모두 명부 fixture 에서 2026-12~2027-07 에 100% 배정돼 있어
// (people.json assignments, 27명 중 7명 → 가용 20 FTE) 점수 계산의 가용 FTE 가 바뀌지 않는다. SOL-P0012 의
// FX-01 배정은 그 기존 배정과 기간이 겹치는 충돌 사례다.
export const DEMO_ASSIGNMENTS = [
  {
    personId: "SOL-P0012",
    fixtureId: "FX-01",
    startsAt: "2027-01-01",
    endsAt: "2027-06-30",
    allocationPercent: 50,
  },
  {
    personId: "SOL-P0049",
    fixtureId: "FX-06",
    startsAt: "2027-08-01",
    endsAt: "2027-12-31",
    allocationPercent: 30,
  },
];

export const toAssignmentRows = ({ bids }) =>
  DEMO_ASSIGNMENTS.map((assignment) => {
    const bid = bids.find((entry) => entry.fixtureId === assignment.fixtureId);
    if (!bid) throw new Error(`배정 대상 공고가 적재되지 않았습니다: ${assignment.fixtureId}`);
    return {
      id: demoUuid("assignment", "org-01", assignment.personId, assignment.fixtureId),
      org_id: orgUuid("org-01"),
      bid_id: bid.bidId,
      member_id: personUuid(assignment.personId),
      starts_at: seoulMidnight(assignment.startsAt),
      ends_at: seoulMidnight(assignment.endsAt),
      allocation_percent: assignment.allocationPercent,
    };
  });

// seed 자체의 감사 기록(04 §6: actor_id=null, action=SEED). 조직마다 한 줄.
export const toSeedAuditRows = ({ counts, summary, anchor }) =>
  DEMO_ORGS.map((org) => ({
    id: demoUuid("audit", "SEED", org.code),
    org_id: orgUuid(org.code),
    actor_id: null,
    action: "SEED",
    target_type: "organization",
    target_id: orgUuid(org.code),
    before_after: {
      before: null,
      after: { anchor: anchor.toISOString(), counts, ingestSummary: summary },
    },
    request_id: null,
  }));

// ── 9. 마지막 줄 ──────────────────────────────────────────────
//
// 10 기동 절차 6 이 글자 그대로 비교한다. 순서·이름을 바꾸지 않는다.

export const formatSummaryLine = (counts) =>
  `seed: orgs=${counts.orgs} users=${counts.users} profileRevisions=${counts.profileRevisions}` +
  ` people=${counts.people} portraits=${counts.portraits} bids=${counts.bids}` +
  ` quarantined=${counts.quarantined} reviews=${counts.reviews} isDemo=true`;

export const EXPECTED_COUNTS = {
  orgs: 2,
  users: 5,
  profileRevisions: 2,
  people: 200,
  portraits: 200,
  bids: 19,
  quarantined: 1,
  reviews: 2,
};

// ── 10. 환경 변수 ──────────────────────────────────────────────
//
// 루트 .env.local 의 세 값. 셸 환경이 파일보다 우선한다(dotenv 와 같다). 값은 어디에도 출력하지 않는다.

export const SEED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEMO_SEED_PASSWORD",
];

export const resolveSeedEnv = ({ fileValues = {}, processEnv = {} }) => {
  const values = Object.fromEntries(
    SEED_ENV_KEYS.map((key) => [key, (processEnv[key] ?? fileValues[key] ?? "").trim()]),
  );
  const missing = SEED_ENV_KEYS.filter((key) => values[key] === "");
  if (missing.length > 0)
    throw new Error(
      `환경 변수가 없습니다: ${missing.join(", ")} (루트 .env.local 또는 셸 환경에 둡니다)`,
    );
  let apiUrl;
  try {
    apiUrl = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 이 URL 이 아닙니다");
  }
  if (!["http:", "https:"].includes(apiUrl.protocol))
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 은 http(s) 주소여야 합니다");
  if (values.DEMO_SEED_PASSWORD.length < 8)
    throw new Error("DEMO_SEED_PASSWORD 는 8자 이상이어야 합니다");
  return {
    apiUrl: apiUrl.origin,
    serviceKey: values.SUPABASE_SERVICE_ROLE_KEY,
    password: values.DEMO_SEED_PASSWORD,
  };
};
