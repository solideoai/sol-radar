#!/usr/bin/env node
// 운영자 CLI: 공개 자료로 만든 회사 프로필 JSON 을 org-01 의 새 revision 으로 넣는다.
// 검증 분담: CLI 는 구조(isDemo=false·필수 키·배열·note)와 출처 규칙(sourceIds·HELD 근거)을 직접 본다.
// 파일 시험(web/server/company-profile/public-profile-file.test.ts)은 zod 스키마 전체 + 같은 출처 규칙 + domain 값을 맡는다
// (CLI 는 TS 스키마를 못 가져온다). 운영자는 apply 전에 파일 시험을 먼저 돌린다.
// 기본은 dry-run 이고 --apply 가 있을 때만 insert 한다. 사람이 직접 돌린다(service role 키는 env 파일에서 읽는다).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { createRestClient, RestError } from "../demo/rest-client.mjs";
import { orgUuid } from "../people/seed.mjs";
import { resolveOpsEnv } from "./close-stale-ingest-runs.mjs";

const ORG_CODE = "org-01";
const USAGE =
  "사용법: node scripts/ops/company-profile.mjs --env-file <path> --file <json> --created-by <email> [--apply]";

const NAME_LISTS = [
  ["technologies", "technologies"],
  ["licenses", "licenses"],
  ["industryCodes", "industry_codes"],
  ["pastProjects", "past_projects"],
];

const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} 는 배열이어야 합니다`);
  return value;
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

// 항목 모양 검사. zod 스키마가 나중에 막겠지만 DB 에 넣기 전에 CLI 에서도 막는다.
const validateItems = (profile) => {
  profile.technologies.forEach((item, index) => {
    if (!isNonEmptyString(item?.name)) throw new Error(`technologies[${index}].name 이 비었습니다`);
  });
  profile.pastProjects.forEach((item, index) => {
    const label = `pastProjects[${index}]`;
    if (!isNonEmptyString(item?.name)) throw new Error(`${label}.name 이 비었습니다`);
    if (
      item.amountKrw !== null &&
      !(typeof item.amountKrw === "string" && /^\d+$/.test(item.amountKrw))
    )
      throw new Error(`${label}.amountKrw 는 null 또는 숫자 문자열이어야 합니다`);
    if (
      item.completedAt !== null &&
      !(typeof item.completedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.completedAt))
    )
      throw new Error(`${label}.completedAt 은 null 또는 YYYY-MM-DD 여야 합니다`);
  });
};

const validateDocument = (document) => {
  const profile = document?.profile;
  if (!profile || typeof profile !== "object") throw new Error("document.profile 이 없습니다");
  if (profile.isDemo !== false) throw new Error("profile.isDemo 는 false 여야 합니다");
  if (typeof profile.name !== "string" || profile.name.trim() === "")
    throw new Error("profile.name 이 비었습니다");
  for (const key of ["technologies", "licenses", "industryCodes", "pastProjects"])
    requireArray(profile[key], `profile.${key}`);
  if (typeof profile.technologiesComplete !== "boolean")
    throw new Error("profile.technologiesComplete 는 boolean 이어야 합니다");
  validateItems(profile);
  requireArray(document.sources, "sources");
  requireArray(document.publicHistory, "publicHistory");
  if (typeof document.note !== "string" || document.note.trim() === "")
    throw new Error("document.note 는 빈 문자열이 아닌 string 이어야 합니다");
  return profile;
};

const isBackingSource = (source) =>
  source?.kind === "PUBLIC"
    ? typeof source.quote === "string" && source.quote !== ""
    : source?.kind === "COMPANY_CONFIRMED" &&
      typeof source.confirmedBy === "string" &&
      source.confirmedBy !== "";

// 출처 규칙: 모든 항목에 존재하는 sourceIds 가 있어야 하고, HELD 자격·업종은 근거 있는 출처를 하나 이상 가리켜야 한다.
export const findSourceProblems = (document) => {
  const profile = document?.profile ?? {};
  const sources = Array.isArray(document?.sources) ? document.sources : [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const items = [
    ...(profile.technologies ?? []).map((item) => ({ label: `기술 ${item.name}`, item })),
    ...(profile.licenses ?? []).map((item) => ({ label: `자격 ${item.name}`, item, held: true })),
    ...(profile.industryCodes ?? []).map((item) => ({
      label: `업종 ${item.name}`,
      item,
      held: true,
    })),
    ...(profile.pastProjects ?? []).map((item) => ({ label: `실적 ${item.name}`, item })),
    ...(profile.financials ? [{ label: "재무", item: profile.financials }] : []),
  ];
  const problems = [];
  for (const source of sources) {
    if (source.url === null || source.url === undefined) continue;
    let protocol = null;
    try {
      protocol = new URL(source.url).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== "http:" && protocol !== "https:")
      problems.push(`출처 ${source.id}: url 스킴은 http·https 만`);
  }
  for (const entry of document?.publicHistory ?? []) {
    const label = `이력 ${entry.year} ${entry.name}`;
    const ids = entry.sourceIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      problems.push(`${label}: sourceIds 없음`);
      continue;
    }
    for (const id of ids) if (!byId.has(id)) problems.push(`${label}: 없는 출처 ${id}`);
  }
  for (const { label, item, held } of items) {
    const ids = item.sourceIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      problems.push(`${label}: sourceIds 없음`);
      continue;
    }
    const missing = ids.filter((id) => !byId.has(id));
    for (const id of missing) problems.push(`${label}: 없는 출처 ${id}`);
    if (held && item.status === "HELD" && !ids.some((id) => isBackingSource(byId.get(id))))
      problems.push(`${label}: HELD 근거 없음`);
  }
  return problems;
};

const LARGE_ROW_FIELDS = [
  "technologies",
  "licenses",
  "industry_codes",
  "past_projects",
  "sources",
  "public_history",
];

// dry-run 출력용: 큰 배열은 개수로 줄이고 나머지 필드는 그대로 둔다.
export const summarizeRow = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      LARGE_ROW_FIELDS.includes(key) && Array.isArray(value) ? value.length : value,
    ]),
  );

const namesOf = (items) => (Array.isArray(items) ? items.map((item) => item.name) : []);

const diffNames = (before, after) => ({
  added: after.filter((name) => !before.includes(name)),
  removed: before.filter((name) => !after.includes(name)),
});

export const planCompanyProfileRevision = async ({ client, document, createdByEmail }) => {
  const profile = validateDocument(document);
  const sourceProblems = findSourceProblems(document);
  if (sourceProblems.length > 0)
    throw new Error(`출처 규칙 위반 ${sourceProblems.length}건: ${sourceProblems.join("; ")}`);
  const orgId = orgUuid(ORG_CODE);
  const organizations = await client.select("organizations", {
    columns: "id,slug",
    filters: { id: orgId },
  });
  if (organizations.length !== 1 || organizations[0].slug !== ORG_CODE)
    throw new Error(`조직 ${ORG_CODE} 를 확인하지 못했습니다`);

  const email = String(createdByEmail ?? "")
    .trim()
    .toLowerCase();
  if (email === "") throw new Error("created-by 이메일이 없습니다");
  const profiles = await client.select("profiles", { columns: "id,email", filters: { email } });
  if (profiles.length !== 1) throw new Error("created-by 이메일의 프로필을 찾지 못했습니다");
  const createdBy = profiles[0].id;
  const memberships = await client.select("memberships", {
    columns: "user_id,sol_role",
    filters: { org_id: orgId, user_id: createdBy, sol_role: "ADMIN" },
  });
  if (memberships.length !== 1) throw new Error(`created-by 는 ${ORG_CODE} 의 ADMIN 이어야 합니다`);

  const revisions = await client.select("company_profiles", {
    columns: "revision,technologies,licenses,industry_codes,past_projects,financials",
    filters: { org_id: orgId },
  });
  const latest = revisions.reduce(
    (best, row) => (best === null || row.revision > best.revision ? row : best),
    null,
  );
  const nextRevision = (latest?.revision ?? 0) + 1;

  const changes = {
    ...Object.fromEntries(
      NAME_LISTS.map(([key, column]) => [
        key,
        diffNames(namesOf(latest?.[column]), namesOf(profile[key])),
      ]),
    ),
    financials:
      JSON.stringify(latest?.financials ?? null) !== JSON.stringify(profile.financials ?? null),
  };

  const row = {
    org_id: orgId,
    revision: nextRevision,
    name: profile.name,
    technologies: profile.technologies,
    technologies_complete: profile.technologiesComplete,
    licenses: profile.licenses,
    industry_codes: profile.industryCodes,
    past_projects: profile.pastProjects,
    financials: profile.financials ?? null,
    preferences: profile.preferences ?? null,
    sources: document.sources,
    public_history: document.publicHistory,
    is_demo: false,
    created_by: createdBy,
    note: document.note,
  };
  return { orgId, nextRevision, createdBy, row, changes };
};

export const applyCompanyProfileRevision = async ({ client, plan }) => {
  let inserted;
  try {
    [inserted] = await client.insert("company_profiles", [plan.row], { returning: true });
  } catch (error) {
    if (error?.code === "23505")
      throw new Error(
        "revision 중복(23505): 다른 실행이 먼저 넣었을 수 있습니다. dry-run 을 다시 돌려 다음 revision 을 확인하세요",
      );
    throw error;
  }
  if (!inserted) throw new Error("revision 을 넣었지만 결과를 받지 못했습니다");
  return { id: inserted.id, revision: inserted.revision };
};

const FLAGS = new Set(["--env-file", "--file", "--created-by"]);

const parseArgs = (argv) => {
  const args = argv.filter((arg) => arg !== "--");
  const values = {};
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (FLAGS.has(arg) && args[index + 1] && !args[index + 1].startsWith("--")) {
      values[arg] = args[index + 1];
      index += 1;
    } else throw new Error(USAGE);
  }
  if (!values["--env-file"] || !values["--file"] || !values["--created-by"]) throw new Error(USAGE);
  return {
    envFile: values["--env-file"],
    file: values["--file"],
    createdBy: values["--created-by"],
    apply,
  };
};

const main = async (argv) => {
  const options = parseArgs(argv);
  const env = resolveOpsEnv(parseEnv(await readFile(path.resolve(options.envFile), "utf8")));
  const document = JSON.parse(await readFile(path.resolve(options.file), "utf8"));
  const client = createRestClient(env);
  const plan = await planCompanyProfileRevision({
    client,
    document,
    createdByEmail: options.createdBy,
  });
  const applied = options.apply ? await applyCompanyProfileRevision({ client, plan }) : null;
  console.log(
    JSON.stringify(
      {
        host: env.host,
        org: ORG_CODE,
        orgId: plan.orgId,
        nextRevision: plan.nextRevision,
        createdBy: plan.createdBy,
        changes: plan.changes,
        row: summarizeRow(plan.row),
        apply: options.apply,
        applied,
      },
      null,
      2,
    ),
  );
};

// RestError 메시지는 rest-client 가 키를 이미 가렸으므로 코드 뒤에 보인다. 다른 오류는 이름·코드만 낸다.
export const describeFailure = (error) =>
  error instanceof RestError
    ? `${error.code ?? error.name}: ${error.message}`
    : (error.code ?? error.message ?? error.name);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    // 요청 본문·Auth 오류에는 키가 포함될 수 있어 오류 이름·코드만 낸다. 입력 오류는 메시지를 그대로 보인다.
    console.error(`회사 프로필 revision 실패: ${describeFailure(error)}`);
    process.exitCode = 1;
  }
}
