#!/usr/bin/env node
// 데모 ADMIN 한 계정만 준비한다. 명부·공고·분석을 초기화하는 demo:reset과 별도로 실행한다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { accountMetadata, DEMO_ACCOUNTS, DEMO_ADMIN_CATALOG } from "../demo/plan.mjs";
import { createRestClient } from "../demo/rest-client.mjs";
import { catalogUuid, orgUuid } from "../people/seed.mjs";
import { resolveOpsEnv } from "./close-stale-ingest-runs.mjs";

const admin = DEMO_ACCOUNTS.find(({ key }) => key === "admin");
const orgId = orgUuid(admin.org);
// 예전에 쓰던 ADMIN 이메일. 운영 계정은 admin@soltech.invalid → admin@admin.com → admin@solideos.com 순으로 바뀌었다.
const LEGACY_ADMIN_EMAILS = ["admin@admin.com", "admin@soltech.invalid"];

export const upsertDemoAdminCatalog = async (client) => {
  await client.upsert(
    "departments",
    [
      {
        id: catalogUuid(admin.departmentCode),
        org_id: orgId,
        code: admin.departmentCode,
        name: DEMO_ADMIN_CATALOG.department.label,
        kind: "TEAM",
        parent_id: null,
        source_count: 0,
        target_count: 1,
        is_demo: true,
      },
    ],
    "id",
  );
  await client.upsert(
    "job_titles",
    [
      {
        id: catalogUuid(admin.jobTitleCode),
        org_id: orgId,
        code: admin.jobTitleCode,
        label: DEMO_ADMIN_CATALOG.jobTitle.label,
        sort_order: 13,
      },
    ],
    "id",
  );
};

export const provisionDemoAdmin = async ({ client, apply = false, password } = {}) => {
  const organizations = await client.select("organizations", {
    columns: "id,slug,is_demo",
    filters: { id: orgId },
  });
  if (
    organizations.length !== 1 ||
    organizations[0].is_demo !== true ||
    organizations[0].slug !== "org-01"
  )
    throw new Error("솔리데오 데모 조직(org-01)을 먼저 확인해야 합니다");
  const users = await client.auth.listUsers();
  const target = users.find(({ email }) => email?.toLowerCase() === admin.email);
  // 이메일 변경 시에도 기존 계정의 멤버십·검토 기록을 같은 사용자 ID에 남긴다.
  const legacy = users.find(({ email }) => LEGACY_ADMIN_EMAILS.includes(email?.toLowerCase()));
  if (target && legacy && target.id !== legacy.id)
    throw new Error("새 이메일이 이미 다른 계정에 있습니다");
  const existing = target ?? legacy;
  const previousEmail = existing?.email ?? null;
  if (!apply) return { apply, userId: existing?.id ?? null, previousEmail, created: false };
  if (typeof password !== "string" || password.length < 8)
    throw new Error("DEMO_ADMIN_PASSWORD 또는 DEMO_SEED_PASSWORD는 8자 이상이어야 합니다");
  await upsertDemoAdminCatalog(client);
  const payload = { email: admin.email, password, userMetadata: accountMetadata(admin) };
  const user = existing
    ? await client.auth.updateUser(existing.id, payload)
    : await client.auth.createUser({ email: admin.email, ...payload });
  await client.update(
    "profiles",
    { id: user.id },
    {
      display_name: admin.displayName,
      declared_department_id: catalogUuid(admin.departmentCode),
      declared_job_title_id: catalogUuid(admin.jobTitleCode),
      status: "active",
    },
  );
  await client.upsert(
    "memberships",
    [
      {
        org_id: orgId,
        user_id: user.id,
        org_role: admin.orgRole,
        sol_role: admin.solRole,
      },
    ],
    "org_id,user_id",
  );
  return { apply, userId: user.id, previousEmail, created: !existing };
};

const main = async (argv) => {
  const args = argv.filter((arg) => arg !== "--");
  const envIndex = args.indexOf("--env-file");
  if (
    envIndex === -1 ||
    !args[envIndex + 1] ||
    args[envIndex + 1].startsWith("--") ||
    args.some((arg, index) => index !== envIndex && index !== envIndex + 1 && arg !== "--apply")
  )
    throw new Error("사용법: node scripts/ops/demo-admin.mjs --env-file <path> [--apply]");
  const values = parseEnv(await readFile(path.resolve(args[envIndex + 1]), "utf8"));
  const env = resolveOpsEnv(values);
  const password =
    process.env.DEMO_ADMIN_PASSWORD ?? values.DEMO_ADMIN_PASSWORD ?? values.DEMO_SEED_PASSWORD;
  const client = createRestClient(env);
  const before = await client.select("team_members", { columns: "id", filters: { org_id: orgId } });
  const result = await provisionDemoAdmin({ client, apply: args.includes("--apply"), password });
  const after = await client.select("team_members", { columns: "id", filters: { org_id: orgId } });
  if (
    JSON.stringify(before.map(({ id }) => id).sort()) !==
    JSON.stringify(after.map(({ id }) => id).sort())
  )
    throw new Error("실행 전후 인력 명부 ID가 다릅니다");
  console.log(
    JSON.stringify(
      {
        ...result,
        host: env.host,
        login: "admin",
        email: admin.email,
        name: admin.displayName,
        department: DEMO_ADMIN_CATALOG.department.label,
        jobTitle: DEMO_ADMIN_CATALOG.jobTitle.label,
        orgRole: admin.orgRole,
        solRole: admin.solRole,
        peopleBefore: before.length,
        peopleAfter: after.length,
      },
      null,
      2,
    ),
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    // 요청 본문·Auth 오류에는 비밀번호나 키가 포함될 수 있다.
    console.error(`데모 계정 준비 실패: ${error.code ?? error.name}`);
    process.exitCode = 1;
  }
}
