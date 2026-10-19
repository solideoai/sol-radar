// demo/plan.mjs — 데모 seed(pnpm demo:reset)의 순수 계획. 디스크·네트워크·시각을 모른다.
//
// 정본: docs/04-DATABASE.md §6(seed 범위·멱등), docs/07-DATA-PIPELINE.md §6(fixture·상대 날짜·SEED 집계),
// docs/15-DATA-CONTRACTS.md §3(NormalizedBid·checksum), docs/08-SCORING.md §6.1(회사 프로필),
// docs/19-DEMO-SCENARIO.md §1(계정)·§3(사전 리뷰), docs/10-DEPLOYMENT.md 기동 절차 6(마지막 줄 형식).
//
// 여기 함수는 모두 같은 입력에 같은 출력을 낸다. 실제로 넣는 일은 scripts/demo/bid-notices.mjs(공고)와
// scripts/demo-reset.mjs(나머지)가 한다. 시험은 scripts/demo-reset.test.mjs.
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
// org-01 계정은 가입 신고(ADR-019)처럼 부서·직급 코드를 함께 적는다 — 가입 트리거가 카탈로그에서 찾으므로
// 카탈로그를 계정보다 먼저 넣는다. org-02 계정은 솔리데오 소속이 아니라 신고 정보를 두지 않는다.
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
    departmentCode: null,
    jobTitleCode: null,
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
// fixture 의 날짜는 "+21d"·"-3d" 같은 상대 표기다. anchor(seed 시각)의 서울 날짜에 n 일을 더하고,
// 시각 없는 날짜는 KST 18:00 으로 간주해 UTC 로 저장한다(07 §3·§6.1). 그래서 "+2d" 는 늘 UTC 09:00 이다.

const DAY_MS = 24 * 60 * 60 * 1000;
const RELATIVE_DATE = /^([+-])(\d+)d$/;

export const seoulDate = (at) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at);

export const addDays = (date, days) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
};

export const resolveRelativeDate = (text, anchor) => {
  if (text === null || text === undefined) return null;
  const match = RELATIVE_DATE.exec(text);
  if (!match) throw new Error(`상대 날짜 표기가 아닙니다: ${text}`);
  const days = (match[1] === "-" ? -1 : 1) * Number(match[2]);
  return new Date(`${addDays(seoulDate(anchor), days)}T18:00:00+09:00`).toISOString();
};

// 서울 날짜(YYYY-MM-DD)의 0시를 UTC ISO 로. 배정·프로필 유효 시각에 쓴다.
export const seoulMidnight = (date) => new Date(`${date}T00:00:00+09:00`).toISOString();

// ── 4. 금액 ────────────────────────────────────────────────────
//
// "1,500백만원"·"21.6억" 같은 원문을 KRW 정수 문자열로 바꾼다(07 §3 금액 정규화). 환산이 정수로 떨어지지 않거나
// 단위를 모르면 null 과 경고(BUDGET_UNPARSED)를 돌려주고 원문은 original 에 남긴다(15 §6).

const BUDGET_UNITS = [
  ["백만원", 1_000_000n],
  ["천원", 1_000n],
  ["억원", 100_000_000n],
  ["억", 100_000_000n],
  ["원", 1n],
];
const BUDGET_TEXT = /^([\d,]+(?:\.\d+)?)\s*(백만원|천원|억원|억|원)$/;

export const parseBudgetKrw = (text) => {
  if (text === null || text === undefined) return { value: null, note: null };
  const trimmed = String(text).trim();
  if (/^\d+$/.test(trimmed)) return { value: trimmed, note: null };
  const match = BUDGET_TEXT.exec(trimmed);
  if (!match) return { value: null, note: `BUDGET_UNPARSED:${trimmed}` };
  const [whole, fraction = ""] = match[1].replaceAll(",", "").split(".");
  const unit = BUDGET_UNITS.find(([name]) => name === match[2])[1];
  const scaled = BigInt(`${whole}${fraction}`) * unit;
  const scale = 10n ** BigInt(fraction.length);
  if (scaled % scale !== 0n) return { value: null, note: `BUDGET_UNPARSED:${trimmed}` };
  return { value: (scaled / scale).toString(), note: `budgetKrw 를 원문 "${trimmed}" 에서 환산` };
};

// ── 5. NormalizedBid 와 checksum ───────────────────────────────

// 키를 정렬하고 공백 없이, undefined 는 빼고 직렬화한다. 같은 내용이면 어디서 만들어도 같은 문자열이다.
const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort()
            .map((key) => [key, sortKeys(value[key])]),
        )
      : value;

export const canonicalJson = (value) => JSON.stringify(sortKeys(value));

// 15 §3: checksum = sha256(canonical JSON, fetchedAt·checksum 제외).
export const checksumOf = (bid) => {
  const { fetchedAt: _fetchedAt, checksum: _checksum, ...rest } = bid;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
};

// 15 §3 의 필수 필드 가운데 fixture 레코드가 채워야 하는 것. 비면 격리한다(source·fetchedAt 은 seed 가 채운다).
const REQUIRED_RECORD_FIELDS = ["noticeId", "title", "sourceUrl", "stage"];
const isText = (value) => typeof value === "string" && value.trim() !== "";

export const missingRequiredFields = (record) =>
  REQUIRED_RECORD_FIELDS.filter((field) => !isText(record?.[field]));

const ATTACHMENT_HOST = "https://demo.sol-radar.invalid/";

// fixture 첨부는 MinIO objectKey 만 있다. NormalizedBid 의 url 은 같은 예약 도메인 아래 그 키로 둔다(열리지 않는다).
export const attachmentUrl = (attachment) =>
  `${ATTACHMENT_HOST}${String(attachment.objectKey ?? attachment.name).replace(/^\/+/, "")}`;

export const normalizeFixtureRecord = ({ record, revision, anchor, fetchedAt }) => {
  const budget = parseBudgetKrw(record.budgetKrw ?? null);
  const notes = [];
  if (record.noticeDate || record.deadlineAt) notes.push("시각 없는 날짜를 KST 18:00 으로 간주");
  if (budget.note) notes.push(budget.note);
  const bid = {
    schemaVersion: "normalized-bid/v0.2",
    source: "fixture",
    noticeId: record.noticeId,
    revision,
    ...(record.amendmentNo ? { amendmentNo: record.amendmentNo } : {}),
    ...(record.planRef ? { planRef: record.planRef } : {}),
    stage: record.stage,
    status: record.status ?? (revision === 1 ? "OPEN" : "AMENDED"),
    title: record.title,
    agency: record.agency ?? null,
    budgetKrw: budget.value,
    noticeDate: resolveRelativeDate(record.noticeDate ?? null, anchor),
    deadlineAt: resolveRelativeDate(record.deadlineAt ?? null, anchor),
    sourceUrl: record.sourceUrl,
    content: record.content ?? "",
    attachments: (record.attachments ?? []).map((attachment) => ({
      name: attachment.name,
      url: attachmentUrl(attachment),
    })),
    structuredQualifications: [],
    original: {
      noticeNo: `${record.noticeId}-${record.amendmentNo}`,
      budget: record.budgetKrw ?? undefined,
      noticeDate: record.noticeDate ?? undefined,
      deadline: record.deadlineAt ?? undefined,
      stage: record.stage,
      status: record.status,
    },
    ...(notes.length ? { normalizationNotes: notes } : {}),
    isDemo: true,
    fetchedAt,
  };
  return { ...bid, checksum: checksumOf(bid) };
};

// ── 6. SEED 배치 계획 ───────────────────────────────────────────
//
// manifest.batches.SEED 순서대로 SEED 레코드(각 fixture 의 r1)를 적재 계획으로 바꾼다. 필수 필드가 빈 레코드는
// 격리(ingest_errors)하고, rate-limit-then-ok 는 429 두 번 뒤 성공이므로 retried 2 로 센다(07 §6.4).
// 기대 집계: {created:19, changed:0, cancelled:0, skippedDuplicate:0, quarantined:1, retried:2}.

export const RATE_LIMIT_RETRIES = 2;

export const bidUuid = (source, noticeId) => demoUuid("bid", source, noticeId);
export const revisionUuid = (source, noticeId, revision) =>
  demoUuid("revision", source, noticeId, revision);

export const planSeedBatch = ({ manifest, bids }, { anchor }) => {
  const fetchedAt = anchor.toISOString();
  const summary = {
    created: 0,
    changed: 0,
    cancelled: 0,
    skippedDuplicate: 0,
    quarantined: 0,
    retried: 0,
  };
  const created = [];
  const quarantined = [];
  for (const fixtureId of manifest.batches.SEED) {
    const fixture = bids[fixtureId];
    if (!fixture) throw new Error(`manifest 의 SEED 배치에 있는 fixture 가 없습니다: ${fixtureId}`);
    if (fixture.connectorBehavior === "rate-limit-then-ok") summary.retried += RATE_LIMIT_RETRIES;
    for (const record of fixture.records.filter((entry) => entry.ingestBatch === "SEED")) {
      const missing = missingRequiredFields(record);
      if (missing.length > 0) {
        quarantined.push({ fixtureId, noticeId: record.noticeId ?? null, missing });
        summary.quarantined += 1;
        continue;
      }
      const normalized = normalizeFixtureRecord({ record, revision: 1, anchor, fetchedAt });
      created.push({
        fixtureId,
        record,
        normalized,
        bidId: bidUuid(normalized.source, normalized.noticeId),
        revisionId: revisionUuid(normalized.source, normalized.noticeId, 1),
      });
      summary.created += 1;
    }
  }
  return { created, quarantined, summary, fetchedAt };
};

// 계획 → 공고 다섯 표에 넣을 행. 한 번에 넣는 행은 같은 키를 가져야 한다(PostgREST 일괄 insert 규칙).
export const toBidRows = ({ created, fetchedAt }) => {
  const notices = created.map(({ bidId, normalized }) => ({
    id: bidId,
    source: normalized.source,
    notice_id: normalized.noticeId,
    plan_ref: normalized.planRef ?? null,
    pre_spec_ref: normalized.preSpecRef ?? null,
    title: normalized.title,
    agency: normalized.agency,
    stage: normalized.stage,
    status: normalized.status,
    budget_krw: normalized.budgetKrw,
    published_at: normalized.noticeDate,
    deadline_at: normalized.deadlineAt,
    source_url: normalized.sourceUrl,
    latest_revision: 1,
    // 04 는 content_hash 의 계산식을 정하지 않았다. 최신 revision 의 checksum 으로 둔다(C3 수집 코드가 정하면 따른다).
    content_hash: normalized.checksum,
    is_demo: true,
    last_synced_at: fetchedAt,
  }));
  const revisions = created.map(({ bidId, revisionId, record, normalized }) => ({
    id: revisionId,
    bid_id: bidId,
    revision: 1,
    amendment_no: normalized.amendmentNo ?? null,
    raw_payload: record,
    normalized,
    checksum: normalized.checksum,
    changed_fields: [],
    fetched_at: fetchedAt,
  }));
  // 첨부 파일(fixtures/docs/)은 아직 없다(07 §6.5 Phase 2). 다운로드 전 상태(PENDING, 파싱 없음)로만 적는다 —
  // sha256·크기를 지어내면 download_status=OK 의 check 를 속이는 가짜 완료가 된다.
  const documents = created.flatMap(({ bidId, revisionId, normalized }) =>
    normalized.attachments.map((attachment, index) => ({
      id: demoUuid("document", normalized.source, normalized.noticeId, 1, index),
      bid_id: bidId,
      revision_id: revisionId,
      name: attachment.name,
      original_url: attachment.url,
      download_status: "PENDING",
    })),
  );
  return { notices, revisions, documents };
};

// ── 7. 수집 run 과 격리 ────────────────────────────────────────

const RUN_MODES = { live: "LIVE", fixture: "FIXTURE", mock: "MOCK" };

export const toRunMode = (value) => {
  const mode = RUN_MODES[String(value ?? "mock").toLowerCase()];
  if (!mode) throw new Error(`SOL_RUN_MODE 값을 모릅니다: ${value}`);
  return mode;
};

export const SEED_JOB_KEY = "fixture:SEED:demo-reset";

export const toIngestRows = ({
  summary,
  quarantined,
  fetchedAt,
  finishedAt,
  runMode,
  order,
  anchor,
}) => {
  const runId = demoUuid("ingest_run", "fixture", "SEED");
  const run = {
    id: runId,
    source: "fixture",
    run_mode: runMode,
    job_key: SEED_JOB_KEY,
    trigger: "DEMO",
    batch: "SEED",
    // anchor 는 C3 runIngest SEED 계약과 같다: LIVE 배치가 최근 SEED run 의 params.anchor 를 써야 FX-09 중복 감지가 맞는다.
    params: { fixtures: order, anchor },
    cursor: null,
    status: summary.quarantined > 0 ? "PARTIAL" : "SUCCEEDED",
    summary,
    quota_used: 0,
    requested_by: null,
    idempotency_key: SEED_JOB_KEY,
    started_at: fetchedAt,
    finished_at: finishedAt,
  };
  // redacted_detail 에는 담당자 정보·키가 없는 요약만 남긴다(15 §6).
  const errors = quarantined.map(({ fixtureId, noticeId, missing }) => ({
    id: demoUuid("ingest_error", "fixture", "SEED", fixtureId),
    ingest_run_id: runId,
    source_key: "fixture",
    error_code: "MISSING_REQUIRED_FIELD",
    result_code: null,
    redacted_detail: `${fixtureId} ${noticeId ?? "(noticeId 없음)"}: 필수 필드 누락(${missing.join(", ")})`,
  }));
  return { run, errors };
};

// ── 8. mock 추출(requirement_extractions) ─────────────────────
//
// fixtures/extractions/FX-xx.json 은 마지막 revision, FX-xx.rNN.json 은 앞선 revision 이다(07 §6.5). SEED 는 r1 만
// 적재하므로 rNN 파일이 있으면 그것을, 없으면 FX-xx.json 을 r1 에 쓴다. 파일 안의 "FX-xx"·"FX-xx#NN" 은 UUID 로 바꾼다.

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

// 첨부 파싱 실패(FX-05)는 PENDING_REVIEW(07 §6.3). 인용 검증 실패(FX-13)는 gateway 가 필드를 CONFLICTED 로 두는 일이라
// 추출 행의 상태는 COMPLETED 다.
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

// ── 9. 회사 프로필 ─────────────────────────────────────────────
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

// ── 10. 사전 리뷰·배정·감사 ────────────────────────────────────

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

// ── 11. 마지막 줄 ──────────────────────────────────────────────
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

// ── 12. 환경 변수 ──────────────────────────────────────────────
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
