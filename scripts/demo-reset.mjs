#!/usr/bin/env node
// demo-reset.mjs — SOL RADAR 데모 seed. Supabase 프로젝트에 service role 로 데모 데이터를 넣고, 다시 돌리면 같은 상태로 만든다.
//
//   pnpm demo:reset                                   루트 .env.local 의 값으로 적재
//   pnpm demo:reset -- --env-file <path>              다른 env 파일(격리 시험용)
//   pnpm demo:reset -- --fixtures-root <dir>          fixtures/ 를 다른 저장소 경로에서 읽는다
//   pnpm demo:reset -- --write-summary <path>         마지막 줄과 같은 내용을 JSON 으로 저장(증거용)
//
// 읽는 값: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · DEMO_SEED_PASSWORD(계정 생성에만). 값은 출력하지 않는다.
// 마이그레이션은 적용하지 않는다(pnpm db:push, 사용자 확인 뒤). seed 가 쓰는 표가 없으면 멈추고 안내한다.
//
// 멱등(04 §6): 지우는 범위는 데모 공고(is_demo=true)와 그 하위, fixture 출처 수집 run, 데모 조직 두 곳의 조직 소유 행
// (프로필·분석·결정·배정·알림·감사·초대·seed 밖 구성원)이다. 조직·카탈로그·명부 200 은 고정 UUID 로 upsert 해 id 가
// 남고, Auth 5계정은 이메일로 찾아 있으면 비밀번호·메타데이터만 갱신한다. live 공고(is_demo=false)·eval_runs 는 건드리지 않는다.
//
// 마지막 줄(10 기동 절차 6): seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  deleteDemoBids,
  loadCompanyProfileFixture,
  loadDemoBidFixtures,
  loadExtractionFixtures,
  seedBidNotices,
  seedRequirementExtractions,
} from "./demo/bid-notices.mjs";
import {
  DEMO_ACCOUNTS,
  DEMO_ORGS,
  EXPECTED_COUNTS,
  accountMetadata,
  demoOrgIds,
  formatSummaryLine,
  planCompanyProfiles,
  resolveSeedEnv,
  toAssignmentRows,
  toReviewRows,
  toRunMode,
  toSeedAuditRows,
} from "./demo/plan.mjs";
import { createRestClient } from "./demo/rest-client.mjs";
import { readPortraitState, validatePortraitAssets } from "./people/portraits.mjs";
import { loadPeopleFixtures, orgUuid, seedSolideoPeople } from "./people/seed.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// seed 가 쓰거나 지우는 표. 하나라도 없으면 마이그레이션이 적용되지 않은 것이다.
export const REQUIRED_TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "invitations",
  "departments",
  "job_titles",
  "team_members",
  "team_member_scoring",
  "company_profiles",
  "bid_notices",
  "bid_revisions",
  "bid_documents",
  "bid_structured_requirements",
  "requirement_extractions",
  "score_runs",
  "bid_reviews",
  "assignments",
  "ingest_runs",
  "ingest_errors",
  "outbox_events",
  "notifications",
  "audit_logs",
];

// 데모 조직 두 곳의 조직 소유 행. 지우는 순서는 FK 를 따른다(score_runs 가 먼저, 결정은 run 을 가리킨다).
const ORG_SCOPED_TABLES = [
  "score_runs",
  "bid_reviews",
  "assignments",
  "company_profiles",
  "notifications",
  "outbox_events",
  "audit_logs",
  "invitations",
];

// ── fixture ────────────────────────────────────────────────────

export const loadDemoFixtures = async ({ fixturesRoot = ROOT } = {}) => {
  const [bids, extractions, company, people] = await Promise.all([
    loadDemoBidFixtures(fixturesRoot),
    loadExtractionFixtures(fixturesRoot),
    loadCompanyProfileFixture(fixturesRoot),
    loadPeopleFixtures(),
  ]);
  return { bids, extractions, company, people };
};

// 사진 200장: manifest READY + 사람 검수 PASS + 파일 해시 일치(10 "파일 이름만 200개 있다고 성공 처리하지 않는다").
export const validatePortraits = async ({ root = ROOT } = {}) => {
  const { people, manifest } = await readPortraitState({ root });
  const errors = await validatePortraitAssets(people, manifest, {
    root,
    requireReady: true,
    checkFiles: true,
  });
  const failed = new Set(errors.map((error) => error.personId).filter(Boolean));
  const ready = errors.some((error) => !error.personId)
    ? 0
    : manifest.portraits.filter(
        (portrait) => portrait.status === "READY" && !failed.has(portrait.personId),
      ).length;
  return { ready, errors };
};

// ── seed ───────────────────────────────────────────────────────

const assertTables = async (client) => {
  const missing = [];
  for (const table of REQUIRED_TABLES) if (!(await client.tableExists(table))) missing.push(table);
  if (missing.length > 0)
    throw new Error(
      `표가 없습니다: ${missing.join(", ")}. 마이그레이션이 적용되지 않았습니다 — pnpm db:verify 로 확인하고 pnpm db:push(사용자 확인 뒤)로 적용하세요.`,
    );
};

const upsertOrganizations = (client) =>
  client.upsert(
    "organizations",
    DEMO_ORGS.map((org) => ({
      id: orgUuid(org.code),
      slug: org.slug,
      name: org.name,
      personal_owner_id: null,
      is_demo: true,
    })),
    "id",
  );

// 명부 밖의 직원(데모 중 추가된 행)은 지워 처음 상태로 돌린다. 명부 200 은 upsert 라 id·created_at 이 남는다.
const seedPeople = async (client, fixtures) => {
  const result = await seedSolideoPeople({ client, orgId: orgUuid("org-01"), fixtures });
  await client.delete("team_members", {
    org_id: orgUuid("org-01"),
    person_code: { notIn: fixtures.people.people.map((person) => person.personId) },
  });
  return result;
};

const deleteOrgScopedRows = async (client, orgIds) => {
  for (const table of ORG_SCOPED_TABLES) await client.delete(table, { org_id: { in: orgIds } });
};

// Auth 계정: 이메일로 찾아 없으면 만들고, 있으면 비밀번호·메타데이터만 갱신한다(id 보존). profiles 행은 가입 트리거가 만든다.
const seedAccounts = async (client, password) => {
  const existing = await client.auth.listUsers();
  const users = {};
  for (const account of DEMO_ACCOUNTS) {
    const found = existing.find(
      (user) => user.email?.toLowerCase() === account.email.toLowerCase(),
    );
    const payload = { password, userMetadata: accountMetadata(account) };
    const user = found
      ? await client.auth.updateUser(found.id, payload)
      : await client.auth.createUser({ email: account.email, ...payload });
    await client.update(
      "profiles",
      { id: user.id },
      { display_name: account.displayName, status: "active" },
    );
    users[account.key] = { ...account, id: user.id, created: !found };
  }
  return users;
};

const seedMemberships = async (client, users, orgIds) => {
  await client.upsert(
    "memberships",
    DEMO_ACCOUNTS.map((account) => ({
      org_id: orgUuid(account.org),
      user_id: users[account.key].id,
      org_role: account.orgRole,
      sol_role: account.solRole,
    })),
    "org_id,user_id",
  );
  await client.delete("memberships", {
    org_id: { in: orgIds },
    user_id: { notIn: Object.values(users).map((user) => user.id) },
  });
};

const countRows = async (client, table, filters, columns) =>
  (await client.select(table, { columns, filters })).length;

const readCounts = async (client, { users, ingestRunId }) => {
  const orgIds = demoOrgIds();
  const memberships = await client.select("memberships", {
    columns: "org_id,user_id",
    filters: { org_id: { in: orgIds } },
  });
  const members = new Set(memberships.map((row) => `${row.org_id}:${row.user_id}`));
  return {
    orgs: await countRows(client, "organizations", { id: { in: orgIds }, is_demo: true }, "id"),
    users: Object.values(users).filter((user) => members.has(`${orgUuid(user.org)}:${user.id}`))
      .length,
    profileRevisions: await countRows(
      client,
      "company_profiles",
      { org_id: orgUuid("org-01") },
      "id",
    ),
    people: await countRows(client, "team_members", { org_id: orgUuid("org-01") }, "id"),
    bids: await countRows(client, "bid_notices", { is_demo: true }, "id"),
    quarantined: await countRows(client, "ingest_errors", { ingest_run_id: ingestRunId }, "id"),
    reviews: await countRows(client, "bid_reviews", { org_id: orgUuid("org-01") }, "id"),
  };
};

export const seedDemo = async ({
  client,
  fixtures,
  password,
  anchor = new Date(),
  runMode = "MOCK",
  portraits = validatePortraits,
  log = () => {},
}) => {
  const orgIds = demoOrgIds();
  await assertTables(client);
  log("표 확인 완료. 조직·카탈로그·명부부터 넣습니다.");
  await upsertOrganizations(client);
  const people = await seedPeople(client, fixtures.people);
  log(`명부 ${people.peopleCount}명·카탈로그 upsert. 데모 공고와 조직 소유 행을 지웁니다.`);
  await deleteDemoBids(client);
  await deleteOrgScopedRows(client, orgIds);
  const users = await seedAccounts(client, password);
  await seedMemberships(client, users, orgIds);
  log(
    `계정 ${Object.keys(users).length}개(새로 만든 ${Object.values(users).filter((user) => user.created).length}). 회사 프로필·공고를 넣습니다.`,
  );
  await client.insert(
    "company_profiles",
    planCompanyProfiles({
      profile: fixtures.company,
      anchor,
      createdBy: { "org-01": users.admin.id, "org-02": users.outsider.id },
    }),
  );
  const ingest = await seedBidNotices(client, { fixtures: fixtures.bids, anchor, runMode });
  const extracted = await seedRequirementExtractions(client, {
    bids: ingest.bids,
    extractions: fixtures.extractions,
  });
  await client.insert(
    "bid_reviews",
    toReviewRows({
      bids: ingest.bids,
      reviewerId: users.sales.id,
      decidedAt: anchor.toISOString(),
    }),
  );
  await client.insert("assignments", toAssignmentRows({ bids: ingest.bids }));
  log(
    `공고 ${ingest.summary.created}건 적재, ${ingest.summary.quarantined}건 격리, 추출 ${extracted.extractions}건. 사진을 검증합니다.`,
  );
  const portraitState = await portraits();
  const counts = {
    ...(await readCounts(client, { users, ingestRunId: ingest.ingestRunId })),
    portraits: portraitState.ready,
  };
  await client.insert("audit_logs", toSeedAuditRows({ counts, summary: ingest.summary, anchor }));
  const mismatches = Object.entries(EXPECTED_COUNTS)
    .filter(([key, expected]) => counts[key] !== expected)
    .map(([key, expected]) => `${key}=${counts[key]} (기대 ${expected})`);
  return {
    ok: mismatches.length === 0 && portraitState.errors.length === 0,
    line: formatSummaryLine(counts),
    counts,
    mismatches,
    portraitErrors: portraitState.errors,
    anchor: anchor.toISOString(),
    runMode,
    ingestRun: { id: ingest.ingestRunId, summary: ingest.summary },
    quarantined: ingest.quarantined,
    bids: ingest.bids,
    extractions: extracted.extractions,
    accounts: DEMO_ACCOUNTS.map(({ email, org, orgRole, solRole }) => ({
      email,
      org,
      orgRole,
      solRole,
    })),
  };
};

// ── 명령 ───────────────────────────────────────────────────────

export const parseArgs = (argv) => {
  const options = { envFile: null, fixturesRoot: null, writeSummary: null };
  const names = {
    "--env-file": "envFile",
    "--fixtures-root": "fixturesRoot",
    "--write-summary": "writeSummary",
  };
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const key = names[args[index]];
    const value = args[index + 1];
    if (!key || value === undefined || value.startsWith("--"))
      throw new Error(`모르는 인자입니다: ${args[index]}`);
    options[key] = value;
    index += 1;
  }
  return options;
};

// 파일이 없으면 빈 값이다(셸 환경만으로도 돈다). 값은 메모리에만 둔다.
const readEnvFile = async (file) => {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

const summaryJson = (result) => ({
  schemaVersion: "sol-seed-summary/v0.1",
  generatedAt: new Date().toISOString(),
  ok: result.ok,
  line: result.line,
  counts: result.counts,
  mismatches: result.mismatches,
  anchor: result.anchor,
  runMode: result.runMode,
  ingestRun: result.ingestRun,
  quarantined: result.quarantined,
  bids: result.bids,
  extractions: result.extractions,
  accounts: result.accounts,
  portraitErrors: result.portraitErrors,
});

const main = async (argv) => {
  const options = parseArgs(argv);
  const env = resolveSeedEnv({
    fileValues: await readEnvFile(path.resolve(ROOT, options.envFile ?? ".env.local")),
    processEnv: process.env,
  });
  const fixtures = await loadDemoFixtures({
    fixturesRoot: options.fixturesRoot ? path.resolve(options.fixturesRoot) : ROOT,
  });
  console.log(`▶ 데모 seed (${new URL(env.apiUrl).host})`);
  const result = await seedDemo({
    client: createRestClient({ apiUrl: env.apiUrl, serviceKey: env.serviceKey }),
    fixtures,
    password: env.password,
    runMode: toRunMode(process.env.SOL_RUN_MODE),
    log: (line) => console.log(`  ${line}`),
  });
  if (options.writeSummary)
    await writeFile(
      path.resolve(options.writeSummary),
      `${JSON.stringify(summaryJson(result), null, 2)}\n`,
    );
  for (const error of result.portraitErrors)
    console.error(`❌ 사진 검증: ${error.code}${error.personId ? ` ${error.personId}` : ""}`);
  for (const mismatch of result.mismatches) console.error(`❌ 집계가 다릅니다: ${mismatch}`);
  console.log(result.line);
  return result.ok ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ 데모 seed 실패: ${error.message}`);
    process.exitCode = 1;
  }
}
