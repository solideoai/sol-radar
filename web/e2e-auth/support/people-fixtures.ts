import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test as base, expect, type APIRequestContext, type WorkerInfo } from "@playwright/test";
import { z } from "zod";
import { readLocalStatus } from "./local-status";
import { SEED_ACCOUNTS, SOLIDEO_ORG_ID, type SeedRole } from "./seed";

type Role = "VIEWER" | "ANALYST" | "SALES" | "ADMIN";
type Account = {
  id: string;
  email: string;
  password: string;
  solRole: Role;
  orgRole: "owner" | "member";
};
type Foreign = {
  orgId: string;
  divisionId: string;
  groupId: string;
  departmentId: string;
  emptyDepartmentId: string;
  jobTitleId: string;
  personId: string;
};
export type PeopleFixtures = {
  accounts: Record<string, Account>;
  orgId: string;
  foreign: Foreign;
  publicTarget: { apiUrl: string; anonKey: string };
  tokenFor: (request: APIRequestContext, name: string) => Promise<string>;
};
const rowSchema = z.record(z.string(), z.unknown());
const membershipSchema = z.object({
  user_id: z.uuid(),
  org_id: z.uuid(),
  org_role: z.string(),
  sol_role: z.string(),
});
const coreFields = {
  departments: "id,org_id,code,name,kind,parent_id,source_count,target_count,is_demo",
  job_titles: "id,org_id,code,label,sort_order",
  team_members:
    "id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo",
  team_member_scoring: "member_id,org_id,role,grade,skills,availability",
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(Reflect.get(value, key))]),
        )
      : value;
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

export const readInstalledAxeSource = () => {
  const require = createRequire(join(__dirname, "..", "..", "package.json"));
  const accessibility = createRequire(require.resolve("eslint-plugin-jsx-a11y/package.json"));
  return readFileSync(accessibility.resolve("axe-core/axe.min.js"), "utf8");
};

async function preparePeople(worker: WorkerInfo, browserName: string) {
  // Existing helper validates explicit workdir+expected API together when supplied,
  // and always refuses a nonlocal status origin. No .env files are read here.
  const status = readLocalStatus();
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!anonKey || !serviceKey)
    throw new Error("Local people QA requires the normal local Supabase seed target.");
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `Owned people fixture ${method} ${path.split("?")[0]} HTTP${response.status}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const seedUsers = async () => {
    const found: Array<{ id: string; email: string }> = [];
    for (let page = 1; ; page++) {
      const users = z
        .object({
          users: z.array(z.object({ id: z.uuid(), email: z.string() })),
        })
        .parse(await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`)).users;
      found.push(
        ...users.filter((user) =>
          Object.values(SEED_ACCOUNTS).some(({ email }) => email === user.email),
        ),
      );
      if (users.length < 200) break;
    }
    const ids = Object.fromEntries(
      Object.entries(SEED_ACCOUNTS).map(([name, account]) => {
        const matches = found.filter(({ email }) => email === account.email);
        expect(
          matches,
          `Normal seed account ${name} must exist before people fixtures`,
        ).toHaveLength(1);
        return [name, matches[0].id];
      }),
    ) as Record<SeedRole, string>;
    return ids;
  };
  const snapshot = async () => {
    const ids = await seedUsers();
    const cores = Object.fromEntries(
      await Promise.all(
        Object.entries(coreFields).map(async ([table, columns]) => {
          const rows = z
            .array(rowSchema)
            .parse(
              await call(
                "GET",
                `/rest/v1/${table}?select=${columns}&org_id=eq.${SOLIDEO_ORG_ID}&order=${table === "team_member_scoring" ? "member_id" : "id"}.asc&limit=1000`,
              ),
            );
          return [table, { count: rows.length, sha256: hash(rows) }];
        }),
      ),
    );
    const memberships = z
      .array(membershipSchema)
      .parse(
        await call(
          "GET",
          `/rest/v1/memberships?select=user_id,org_id,org_role,sol_role&user_id=in.(${Object.values(ids).join(",")})&order=user_id.asc,org_id.asc`,
        ),
      );
    expect(
      memberships.every(
        ({ org_id, sol_role }) => org_id !== SOLIDEO_ORG_ID && sol_role === "VIEWER",
      ),
    ).toBe(true);
    return { ids, cores, memberships };
  };
  const before = await snapshot();
  expect(
    before.cores.team_members.count,
    "Run the normal seed first; this helper never seeds org01",
  ).toBe(200);
  expect(before.cores.team_member_scoring.count).toBe(27);
  expect(before.cores.departments.count).toBe(48);
  expect(before.cores.job_titles.count).toBe(12);
  const preexistingOrgIds = new Set(
    z
      .array(z.object({ id: z.uuid() }))
      .parse(await call("GET", "/rest/v1/organizations?select=id&limit=10000"))
      .map(({ id }) => id),
  );
  const tag = `${worker.workerIndex}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const foreign: Foreign = {
    orgId: randomUUID(),
    divisionId: randomUUID(),
    groupId: randomUUID(),
    departmentId: randomUUID(),
    emptyDepartmentId: randomUUID(),
    jobTitleId: randomUUID(),
    personId: randomUUID(),
  };
  expect(preexistingOrgIds.has(foreign.orgId)).toBe(false);
  const accounts: Record<string, Account> = {};
  const ownedUserIds: string[] = [];
  let foreignCreated = false;
  const proof: Record<string, unknown> = {
    tag,
    project: worker.project.name,
    browserName,
    protectedOrg01: SOLIDEO_ORG_ID,
    ownedForeignOrgId: foreign.orgId,
    ownedUserIds,
    before,
    state: "preparing",
  };
  mkdirSync(worker.project.outputDir, { recursive: true });
  const proofPath = join(worker.project.outputDir, `people-fixture-${tag}.json`);
  const saveProof = () => writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  const cleanup = async () => {
    proof.state = "cleaning";
    saveProof();
    expect(ownedUserIds.every((id) => !Object.values(before.ids).includes(id))).toBe(true);
    if (ownedUserIds.length)
      await call("DELETE", `/rest/v1/memberships?user_id=in.(${ownedUserIds.join(",")})`);
    // Never infer ownership from members. org01/org02 and every preexisting org
    // remain protected even if their only members happen to be our QA users.
    if (foreignCreated) {
      expect(preexistingOrgIds.has(foreign.orgId)).toBe(false);
      expect(foreign.orgId).not.toBe(SOLIDEO_ORG_ID);
      await call("DELETE", `/rest/v1/organizations?id=eq.${foreign.orgId}`);
    }
    for (const id of ownedUserIds) await call("DELETE", `/auth/v1/admin/users/${id}`);
    const foreignRemaining: Record<string, number> = {};
    for (const table of ["departments", "job_titles", "team_members", "team_member_scoring"]) {
      const rows = z
        .array(rowSchema)
        .parse(
          await call("GET", `/rest/v1/${table}?select=*&org_id=eq.${foreign.orgId}&limit=1000`),
        );
      foreignRemaining[table] = rows.length;
      expect(rows).toHaveLength(0);
    }
    proof.foreignRemainingAfterCleanup = foreignRemaining;
    const after = await snapshot();
    proof.after = after;
    proof.state = "removed-owned-resources";
    saveProof();
    expect(after.ids).toEqual(before.ids);
    expect(after.cores).toEqual(before.cores);
    // Normal invitation.write may legitimately add invitee to seed-team while
    // this write-project fixture runs. Record both snapshots; the exact normal
    // memberships are compared externally after95->afterQA when stable.
    proof.state = "cleanup-verified";
    saveProof();
  };
  saveProof();
  try {
    await call("POST", "/rest/v1/organizations", {
      id: foreign.orgId,
      name: `People QA 격리 ${tag}`,
      slug: `people-qa-${tag}`,
      personal_owner_id: null,
      is_demo: true,
    });
    foreignCreated = true;
    saveProof();
    for (const department of [
      {
        id: foreign.divisionId,
        code: "SOL-D997",
        name: "QA본부",
        kind: "DIVISION",
        parent_id: null,
        source_count: null,
        target_count: null,
      },
      {
        id: foreign.groupId,
        code: "SOL-D998",
        name: "QA그룹",
        kind: "GROUP",
        parent_id: foreign.divisionId,
        source_count: null,
        target_count: null,
      },
      {
        id: foreign.departmentId,
        code: "SOL-D999",
        name: "QA팀",
        kind: "TEAM",
        parent_id: foreign.groupId,
        source_count: 1,
        target_count: 1,
      },
      {
        id: foreign.emptyDepartmentId,
        code: "SOL-D996",
        name: "QA빈팀",
        kind: "TEAM",
        parent_id: foreign.groupId,
        source_count: 1,
        target_count: 1,
      },
    ])
      await call("POST", "/rest/v1/departments", {
        ...department,
        org_id: foreign.orgId,
        is_demo: true,
      });
    await call("POST", "/rest/v1/job_titles", {
      id: foreign.jobTitleId,
      org_id: foreign.orgId,
      code: "SOL-J999",
      label: "QA직급",
      sort_order: 0,
    });
    await call("POST", "/rest/v1/team_members", {
      id: foreign.personId,
      org_id: foreign.orgId,
      person_code: "SOL-P9999",
      name: "김시험",
      gender: "MALE",
      department_id: foreign.departmentId,
      job_title_id: foreign.jobTitleId,
      portrait_path: "/qa-unapproved-portrait.png",
      is_demo: true,
    });
    const specs: Array<{
      name: string;
      solRole: Role;
      orgs: string[];
      orgRole: "owner" | "member";
    }> = [
      {
        name: "viewer",
        solRole: "VIEWER",
        orgs: [SOLIDEO_ORG_ID],
        orgRole: "owner",
      },
      ...(["ANALYST", "SALES", "ADMIN"] as const).map((solRole) => ({
        name: solRole.toLowerCase(),
        solRole,
        orgs: [SOLIDEO_ORG_ID],
        orgRole: "member" as const,
      })),
      { name: "noorg", solRole: "VIEWER", orgs: [], orgRole: "member" },
      {
        name: "multiple",
        solRole: "VIEWER",
        orgs: [SOLIDEO_ORG_ID, foreign.orgId],
        orgRole: "member",
      },
      {
        name: "foreign",
        solRole: "VIEWER",
        orgs: [foreign.orgId],
        orgRole: "member",
      },
      {
        name: "suspended",
        solRole: "VIEWER",
        orgs: [SOLIDEO_ORG_ID],
        orgRole: "member",
      },
      {
        name: "incomplete",
        solRole: "VIEWER",
        orgs: [SOLIDEO_ORG_ID],
        orgRole: "member",
      },
    ];
    for (const spec of specs) {
      const email = `people-qa-${spec.name}-${tag}@example.test`;
      const password = `qa-${randomBytes(24).toString("base64url")}`;
      const user = z.object({ id: z.uuid() }).parse(
        await call("POST", "/auth/v1/admin/users", {
          email,
          password,
          email_confirm: true,
          user_metadata: {
            name: "조회시험",
            ...(spec.name === "incomplete"
              ? {}
              : { department_code: "SOL-D001", job_title_code: "SOL-J007" }),
          },
        }),
      );
      expect(Object.values(before.ids)).not.toContain(user.id);
      ownedUserIds.push(user.id);
      saveProof();
      for (const orgId of spec.orgs)
        await call("POST", "/rest/v1/memberships", {
          org_id: orgId,
          user_id: user.id,
          org_role: spec.orgRole,
          sol_role: spec.solRole,
        });
      if (spec.name === "suspended")
        await call("PATCH", `/rest/v1/profiles?id=eq.${user.id}`, {
          status: "suspended",
        });
      accounts[spec.name] = {
        id: user.id,
        email,
        password,
        solRole: spec.solRole,
        orgRole: spec.orgRole,
      };
    }
    const tokens = new Map<string, string>();
    const tokenFor = async (request: APIRequestContext, name: string) => {
      const account = accounts[name];
      const cached = tokens.get(account.id);
      if (cached) return cached;
      const response = await request.post(`${apiUrl}/auth/v1/token?grant_type=password`, {
        headers: { apikey: anonKey },
        data: { email: account.email, password: account.password },
      });
      expect(response.status()).toBe(200);
      const token = z
        .object({ access_token: z.string() })
        .parse(await response.json()).access_token;
      await response.dispose();
      tokens.set(account.id, token);
      return token;
    };
    proof.foreignFixtureIds = foreign;
    proof.foreignCounts = { divisions: 1, groups: 1, teams: 2, people: 1, scoring: 0 };
    proof.state = "ready";
    saveProof();
    const fixtures: PeopleFixtures = {
      accounts,
      orgId: SOLIDEO_ORG_ID,
      foreign,
      publicTarget: { apiUrl, anonKey },
      tokenFor,
    };
    return { fixtures, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch {
      proof.state = "cleanup-required";
      saveProof();
    }
    throw new Error(
      `Owned people fixture setup failed (${error instanceof Error ? error.name : "Error"}); inspect safe ownership proof.`,
    );
  }
}

export const test = base.extend<object, { people: PeopleFixtures }>({
  people: [
    async ({ browserName }, provide, worker) => {
      const owned = await preparePeople(worker, browserName);
      try {
        await provide(owned.fixtures);
      } finally {
        await owned.cleanup();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});
