import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import { test, type PeopleFixtures } from "./support/people-fixtures";
import { registerPeopleReadTests } from "./support/people-read-cases";

// Every successful setup mutation belongs to the dedicated exact-ID fixture
// closure. This suite issues only expected-denied employee/role writes.
let prepared: PeopleFixtures | undefined;
const fixture = () => {
  if (!prepared) throw new Error("Portable people worker fixture has not initialized.");
  return prepared;
};
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
const memberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  personCode: z.string(),
  departmentId: z.uuid(),
  jobTitleId: z.uuid(),
  portraitUrl: z.string().nullable(),
  isDemo: z.literal(true),
  scoringEligible: z.boolean(),
});
const memberPageSchema = z.object({
  items: z.array(memberSchema),
  totalCount: z.number(),
  summary: z.object({ totalCount: z.number(), scoringCount: z.number() }),
});
const rowIdsSchema = z.array(z.object({ id: z.uuid() }));
const local = () => ({
  API_URL: fixture().publicTarget.apiUrl,
  ANON_KEY: fixture().publicTarget.anonKey,
  PUBLISHABLE_KEY: fixture().publicTarget.anonKey,
});
const tokenFor = (request: APIRequestContext, name: string) => fixture().tokenFor(request, name);
const headers = async (request: APIRequestContext, role: string) => ({
  Authorization: `Bearer ${await tokenFor(request, role)}`,
});
const direct = async (request: APIRequestContext, role: string | null, path: string) => {
  const status = local();
  const key = status.ANON_KEY || status.PUBLISHABLE_KEY;
  return request.get(`${status.API_URL}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${role ? await tokenFor(request, role) : key}`,
    },
  });
};
const sample = async (request: APIRequestContext) => {
  const response = await request.get("/api/v1/team-members", {
    headers: await headers(request, "viewer"),
  });
  expect(response.status()).toBe(200);
  return memberPageSchema.parse(await response.json()).items[0];
};
const fillLogin = async (page: Page, role: string) => {
  const account = fixture().accounts[role];
  await page.goto("/auth/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
};

// New disposable users are created only in chromium-write, after the existing
// read project (including the global admin newest-user/count assertions).
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ people }) => {
  prepared = people;
});
registerPeopleReadTests();
test.describe("[people-read-qa] independent access and denied-write integration", () => {
  test("no-auth all four GET routes401 and /people requires login", async ({ page, request }) => {
    const person = await sample(request);
    for (const path of [
      "/api/v1/departments",
      "/api/v1/job-titles",
      "/api/v1/team-members",
      `/api/v1/team-members/${person.id}`,
    ]) {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      expect(errorSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED");
    }
    await page.goto("/people");
    await expect(page).toHaveURL(/\/auth\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "조직·인력", exact: true })).toHaveCount(0);
  });

  test("invalid/malformed/present-empty Bearer never falls back to valid cookies", async ({
    page,
  }) => {
    await fillLogin(page, "viewer");
    await expect(page).toHaveURL(/\/org-01\/dashboard$/);
    const cookie = await page.request.get("/api/v1/team-members");
    expect(cookie.status()).toBe(200);
    for (const Authorization of ["Bearer invalid", "Basic invalid", ""]) {
      for (const path of ["/api/v1/departments", "/api/v1/job-titles", "/api/v1/team-members"]) {
        const response = await page.request.get(path, {
          headers: { Authorization },
        });
        expect(response.status()).toBe(401);
        expect(errorSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED");
      }
    }
  });

  for (const scenario of [
    {
      role: "noorg",
      status: 403,
      code: "FORBIDDEN",
      details: {
        reason: "ORGANIZATION_REQUIRED",
        organizationStatePath: "/auth/organization-state",
      },
    },
    {
      role: "multiple",
      status: 403,
      code: "UNSUPPORTED_ACCOUNT_STATE",
      details: {},
    },
    { role: "suspended", status: 403, code: "ACCOUNT_DISABLED", details: {} },
    {
      role: "incomplete",
      status: 403,
      code: "PROFILE_INCOMPLETE",
      details: { completionPath: "/auth/complete-profile" },
    },
  ]) {
    test(`${scenario.role}: independent route guards enforce403${scenario.code}`, async ({
      request,
    }) => {
      const person = await sample(request);
      const as = await headers(request, scenario.role);
      for (const path of [
        "/api/v1/departments",
        "/api/v1/job-titles",
        "/api/v1/team-members",
        `/api/v1/team-members/${person.id}`,
      ]) {
        const response = await request.get(path, { headers: as });
        expect(response.status()).toBe(scenario.status);
        const error = errorSchema.parse(await response.json()).error;
        expect(error.code).toBe(scenario.code);
        expect(error.details).toMatchObject(scenario.details);
      }
    });
  }

  for (const role of ["noorg", "multiple", "incomplete"]) {
    test(`${role}: direct /people follows existing account-state UI and reveals no directory`, async ({
      page,
    }) => {
      await fillLogin(page, role);
      if (role === "incomplete") await expect(page).toHaveURL(/\/auth\/complete-profile(?:\?|$)/);
      else await expect(page).toHaveURL(/\/auth\/organization-state(?:\?|$)/);
      await page.goto("/people");
      await expect(page.getByRole("heading", { name: "조직·인력", exact: true })).toHaveCount(0);
      if (role === "noorg")
        await expect(
          page.getByRole("heading", {
            name: "조직 초대가 필요합니다",
            exact: true,
          }),
        ).toBeVisible();
      if (role === "multiple")
        await expect(
          page.getByText("지원되지 않는 계정 상태입니다. 관리자에게 문의하세요", { exact: true }),
        ).toBeVisible();
      if (role === "incomplete") await expect(page).toHaveURL(/\/auth\/complete-profile(?:\?|$)/);
    });
  }

  test("four roles have same direct RLS SELECT and other-org zero; anon cannot read tables", async ({
    request,
  }) => {
    const evidence: Array<{
      role: string;
      table: string;
      ownRows: number;
      foreignRows: number;
    }> = [];
    for (const role of ["viewer", "analyst", "sales", "admin"]) {
      for (const [table, count, id] of [
        ["departments", 48, "id"],
        ["job_titles", 12, "id"],
        ["team_members", 200, "id"],
        ["team_member_scoring", 27, "member_id"],
      ] as const) {
        const ownResponse = await direct(
          request,
          role,
          `${table}?select=${id}&org_id=eq.${fixture().orgId}&limit=1000`,
        );
        expect(ownResponse.status()).toBe(200);
        const own = z.array(z.record(z.string(), z.string())).parse(await ownResponse.json());
        expect(own).toHaveLength(count);
        const foreignResponse = await direct(
          request,
          role,
          `${table}?select=${id}&org_id=eq.${fixture().foreign.orgId}&limit=1000`,
        );
        expect(foreignResponse.status()).toBe(200);
        expect(z.array(z.unknown()).parse(await foreignResponse.json())).toHaveLength(0);
        evidence.push({ role, table, ownRows: own.length, foreignRows: 0 });
      }
    }
    for (const table of ["departments", "job_titles", "team_members", "team_member_scoring"]) {
      const response = await direct(request, null, `${table}?select=*&limit=1`);
      expect([401, 403]).toContain(response.status());
      expect(z.object({ code: z.string() }).parse(await response.json()).code).toBe("42501");
    }
    for (const role of ["foreign", "noorg", "suspended"]) {
      const response = await direct(
        request,
        role,
        `team_members?select=id&org_id=eq.${fixture().orgId}`,
      );
      expect(response.status()).toBe(200);
      expect(rowIdsSchema.parse(await response.json())).toHaveLength(0);
    }
    await test.info().attach("actual-role-rls-counts", {
      body: JSON.stringify(evidence),
      contentType: "application/json",
    });
  });

  test("all four people endpoints remain GET-only", async ({ request }) => {
    const person = await sample(request);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      for (const path of [
        "/api/v1/departments",
        "/api/v1/job-titles",
        "/api/v1/team-members",
        `/api/v1/team-members/${person.id}`,
      ]) {
        const response = await request.fetch(path, {
          method,
          headers: await headers(request, "viewer"),
          data: {},
        });
        expect(response.status()).toBe(405);
      }
    }
  });

  test("even owner VIEWER cannot INSERT/UPDATE sol_role or write roster/scoring; org_role remains owner", async ({
    request,
  }) => {
    const person = await sample(request);
    const status = local();
    const key = status.ANON_KEY || status.PUBLISHABLE_KEY;
    for (const role of ["viewer", "analyst", "sales", "admin"]) {
      const token = await tokenFor(request, role);
      const userHeaders = {
        apikey: key,
        Authorization: `Bearer ${token}`,
        Prefer: "return=representation",
      };
      const calls = [
        {
          method: "PATCH",
          path: `team_members?id=eq.${person.id}`,
          data: { name: person.name },
        },
        {
          method: "POST",
          path: "team_members",
          data: {
            id: randomUUID(),
            org_id: fixture().orgId,
            person_code: "SOL-P9998",
            name: "정시험",
            gender: "MALE",
            department_id: person.departmentId,
            job_title_id: person.jobTitleId,
            portrait_path: "/qa-denied.png",
            is_demo: true,
          },
        },
        {
          method: "PATCH",
          path: `team_member_scoring?org_id=eq.${fixture().orgId}`,
          data: { grade: "QA-DENIED" },
        },
        {
          method: "PATCH",
          path: `memberships?org_id=eq.${fixture().orgId}&user_id=eq.${fixture().accounts[role].id}`,
          data: { sol_role: "ADMIN" },
        },
        {
          method: "POST",
          path: "memberships",
          data: {
            org_id: fixture().orgId,
            user_id: fixture().accounts[role].id,
            org_role: "member",
            sol_role: "ADMIN",
          },
        },
      ];
      for (const attempt of calls) {
        const response = await request.fetch(`${status.API_URL}/rest/v1/${attempt.path}`, {
          method: attempt.method,
          headers: userHeaders,
          data: attempt.data,
        });
        expect(response.status()).toBe(403);
        expect(z.object({ code: z.string() }).parse(await response.json()).code).toBe("42501");
      }
    }
    const owner = await direct(
      request,
      "viewer",
      `memberships?select=user_id,org_role,sol_role&org_id=eq.${fixture().orgId}&user_id=eq.${fixture().accounts.viewer.id}`,
    );
    expect(owner.status()).toBe(200);
    expect(
      z
        .array(
          z.object({
            user_id: z.uuid(),
            org_role: z.string(),
            sol_role: z.string(),
          }),
        )
        .parse(await owner.json()),
    ).toEqual([
      {
        user_id: fixture().accounts.viewer.id,
        org_role: "owner",
        sol_role: "VIEWER",
      },
    ]);
    const still = await request.get("/api/v1/team-members", {
      headers: await headers(request, "viewer"),
    });
    expect(memberPageSchema.parse(await still.json()).summary).toEqual({
      totalCount: 200,
      scoringCount: 27,
    });
  });
});
