import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as departments } from "@/app/api/v1/departments/route";
import { GET as jobTitles } from "@/app/api/v1/job-titles/route";
import { GET as detail } from "@/app/api/v1/team-members/[id]/route";
import { peopleAccess } from "@/app/_lib/people-access";
import { getPeopleDirectory } from "@/server/people";
import * as listRoute from "./route";
const transport = vi.hoisted(() => ({
  headers: new Headers(),
  cookie: "token-a" as string | null,
  orgCount: 1,
  solRole: "VIEWER" as string | null,
  profileStatus: "active",
  complete: true,
  isAdmin: false,
  error: false,
  reads: [] as { token: string | null; table: string; filters: Record<string, string> }[],
}));
const uidA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  uidB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const departmentId = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84",
  titleId = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
const memberId = "11111111-1111-4111-8111-111111111111",
  otherId = "22222222-2222-4222-8222-222222222222";
function client(token: string | null) {
  const uid = token === "token-a" ? uidA : token === "token-b" ? uidB : null;
  const orgId = uid === uidB ? "org-b" : "org-a";
  return {
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
        error: null,
      }),
      getClaims: async () =>
        uid
          ? {
              data: {
                claims: {
                  sub: uid,
                  email: "user@example.com",
                  role: "authenticated",
                  aud: "authenticated",
                  iss: "https://test.supabase.co/auth/v1",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                },
              },
              error: null,
            }
          : { data: null, error: new AuthApiError("Invalid", 401, "bad_jwt") },
    },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      let columns = "";
      const result = () => {
        transport.reads.push({ token, table, filters: { ...filters } });
        if (transport.error && table === "team_members")
          return { data: null, error: { code: "XX000", message: "private database details" } };
        if (table === "profiles")
          return {
            data:
              filters.id === uid
                ? [
                    {
                      email: "user@example.com",
                      is_admin: transport.isAdmin,
                      display_name: "사용자",
                      avatar_url: null,
                      status: transport.profileStatus,
                      created_at: "2026-10-18",
                      declared_department_id: transport.complete ? departmentId : null,
                      declared_job_title_id: transport.complete ? titleId : null,
                    },
                  ]
                : [],
            error: null,
          };
        if (table === "memberships")
          return {
            data:
              filters.user_id !== uid
                ? []
                : columns === "sol_role"
                  ? transport.solRole === null
                    ? []
                    : [{ sol_role: transport.solRole }]
                  : Array.from({ length: transport.orgCount }, (_, i) => ({
                      org_role: "member",
                      organization: {
                        id: i ? "org-extra" : orgId,
                        slug: i ? "extra" : "team",
                        name: "회사",
                        personal_owner_id: null,
                      },
                    })),
            error: null,
          };
        if (filters.org_id !== orgId || transport.orgCount !== 1) return { data: [], error: null };
        const data =
          table === "departments"
            ? [
                {
                  id: departmentId,
                  code: "SOL-D001",
                  name: "팀",
                  kind: "TEAM",
                  parent_id: null,
                  target_count: 1,
                },
              ]
            : table === "job_titles"
              ? [{ id: titleId, code: "SOL-J007", label: "팀장" }]
              : table === "team_members"
                ? [
                    {
                      id: uid === uidB ? otherId : memberId,
                      person_code: uid === uidB ? "SOL-P0002" : "SOL-P0001",
                      name: uid === uidB ? "다른직원" : "가상직원",
                      department_id: departmentId,
                      job_title_id: titleId,
                      portrait_path: "/demo/people/SOL-P0001.png",
                      is_demo: true,
                      email: "private@example.com",
                      phone: "private",
                    },
                  ]
                : table === "team_member_scoring"
                  ? [
                      {
                        member_id: uid === uidB ? otherId : memberId,
                        role: "PM",
                        grade: "고급",
                        skills: ["Java"],
                        availability: [{ startsAt: "2026-12-01", endsAt: "2027-07-01", fte: 1 }],
                      },
                    ]
                  : [];
        return {
          data: data.filter(
            (row) =>
              (!filters.id || ("id" in row && row.id === filters.id)) &&
              (!filters.member_id || ("member_id" in row && row.member_id === filters.member_id)),
          ),
          error: null,
        };
      };
      const query = {
        select: (value: string) => {
          columns = value;
          return query;
        },
        eq: (key: string, value: string) => {
          filters[key] = value;
          return query;
        },
        order: () => query,
        maybeSingle: async () => {
          const out = result();
          return { ...out, data: out.data?.[0] ?? null };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    rpc: async () => ({
      data: [
        {
          department_id: departmentId,
          department_code: "SOL-D001",
          department_name: "팀",
          job_title_id: titleId,
          job_title_code: "SOL-J007",
          job_title_label: "팀장",
        },
      ],
      error: null,
    }),
  };
}
vi.mock("next/headers", () => ({
  headers: async () => transport.headers,
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => client(transport.cookie) }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (
    _url: string,
    _key: string,
    options: { global: { headers: { Authorization: string } } },
  ) => client(options.global.headers.Authorization.slice(7)),
}));
function request(query = "", headers: HeadersInit = {}) {
  const req = new Request(`https://app.example/api/v1/team-members${query}`, { headers });
  transport.headers = req.headers;
  return req;
}
const endpoints = [
  (req: Request) => departments(req),
  (req: Request) => jobTitles(req),
  (req: Request) => listRoute.GET(req),
  (req: Request) => detail(req, { params: Promise.resolve({ id: memberId }) }),
];
async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({
    code,
    requestId: response.headers.get("X-Request-Id"),
    details: expect.any(Object),
  });
  return body.error;
}
beforeEach(() => {
  Object.assign(transport, {
    headers: new Headers(),
    cookie: "token-a",
    orgCount: 1,
    solRole: "VIEWER",
    profileStatus: "active",
    complete: true,
    isAdmin: false,
    error: false,
    reads: [],
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("API_CURSOR_SECRET", "test-only-cursor-secret-at-least-32-characters");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("people HTTP contracts with real auth, services, repos and only SDK transport replaced", () => {
  it.each(["VIEWER", "ANALYST", "SALES", "ADMIN"])(
    "serves all four read routes for %s",
    async (role) => {
      transport.solRole = role;
      for (const endpoint of endpoints) {
        const response = await endpoint(request());
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
      const page = await (await listRoute.GET(request())).json();
      expect(page).toMatchObject({
        totalCount: 1,
        summary: { totalCount: 1, scoringCount: 1 },
        pageInfo: {
          cursor: null,
          nextCursor: null,
          previousCursor: null,
          hasNext: false,
          startIndex: 0,
        },
      });
      expect(Object.keys(page.items[0]).sort()).toEqual([
        "departmentId",
        "id",
        "isDemo",
        "jobTitleId",
        "name",
        "personCode",
        "portraitUrl",
        "scoringEligible",
      ]);
      expect(await (await departments(request())).json()).toEqual([
        {
          id: departmentId,
          code: "SOL-D001",
          name: "팀",
          kind: "TEAM",
          parentId: null,
          targetCount: 1,
          memberCount: 1,
        },
      ]);
      expect(await (await jobTitles(request())).json()).toEqual([
        { id: titleId, code: "SOL-J007", label: "팀장" },
      ]);
      expect(
        (await (await detail(request(), { params: Promise.resolve({ id: memberId }) })).json())
          .scoring,
      ).toMatchObject({ role: "PM", grade: "고급", skills: ["Java"] });
    },
  );
  it("Bearer B overrides cookie A consistently and ignores org header", async () => {
    const page = await (
      await listRoute.GET(
        request("", { Authorization: "Bearer token-b", "X-Organization-Id": "org-a" }),
      )
    ).json();
    expect(page.items[0].id).toBe(otherId);
    expect(transport.reads.every((read) => read.token === "token-b")).toBe(true);
    await errorOf(
      await detail(request("", { Authorization: "Bearer token-b" }), {
        params: Promise.resolve({ id: memberId }),
      }),
      404,
      "NOT_FOUND",
    );
  });
  it.each(["Bearer invalid", "Basic invalid", "Bearer", ""])(
    "rejects Authorization %s without using cookie",
    async (Authorization) => {
      for (const endpoint of endpoints)
        await errorOf(await endpoint(request("", { Authorization })), 401, "UNAUTHENTICATED");
      expect(transport.reads).toHaveLength(0);
      request("", { Authorization });
      expect(await getPeopleDirectory(peopleAccess)).toMatchObject({
        status: "error",
        error: { code: "UNAUTHENTICATED" },
      });
    },
  );
  it("returns 401 signed out, 403 disabled/incomplete and 503 no DB", async () => {
    transport.cookie = null;
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request()), 401, "UNAUTHENTICATED");
    transport.cookie = "token-a";
    transport.profileStatus = "suspended";
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request()), 403, "ACCOUNT_DISABLED");
    transport.profileStatus = "active";
    transport.complete = false;
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request()), 403, "PROFILE_INCOMPLETE");
    transport.complete = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request()), 503, "SERVICE_UNAVAILABLE");
  });
  it("enforces zero/one/multiple org and runtime roles even for platform admin", async () => {
    transport.orgCount = 0;
    transport.isAdmin = true;
    for (const endpoint of endpoints) {
      const error = await errorOf(await endpoint(request()), 403, "FORBIDDEN");
      expect(error.details).toMatchObject({
        reason: "ORGANIZATION_REQUIRED",
        organizationStatePath: "/auth/organization-state",
      });
    }
    transport.orgCount = 2;
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request()), 403, "UNSUPPORTED_ACCOUNT_STATE");
    transport.orgCount = 1;
    for (const role of [null, "owner", "INVALID"]) {
      transport.solRole = role;
      for (const endpoint of endpoints) await errorOf(await endpoint(request()), 403, "FORBIDDEN");
    }
  });
  it("rejects org query in every route and unknown/duplicate/malformed list queries", async () => {
    for (const endpoint of endpoints)
      await errorOf(await endpoint(request("?orgId=foreign")), 400, "VALIDATION_ERROR");
    for (const query of [
      "?unknown=x",
      "?q=a&q=b",
      "?limit=101",
      "?jobTitleId=SOL-J007",
      "?departmentId=SOL-D001",
      "?scoring=true",
    ])
      await errorOf(await listRoute.GET(request(query)), 400, "VALIDATION_ERROR");
    for (const field of ["departmentId", "jobTitleId"])
      await errorOf(
        await listRoute.GET(request(`?${field}=ffffffff-ffff-4fff-8fff-ffffffffffff`)),
        404,
        "NOT_FOUND",
      );
    await errorOf(
      await detail(request(), { params: Promise.resolve({ id: "SOL-P0001" }) }),
      400,
      "VALIDATION_ERROR",
    );
  });
  it("returns cursor error/configuration failure and sanitized DB errors", async () => {
    await errorOf(await listRoute.GET(request("?cursor=bad")), 400, "INVALID_CURSOR");
    vi.stubEnv("API_CURSOR_SECRET", "");
    expect(
      (await errorOf(await listRoute.GET(request()), 503, "SERVICE_UNAVAILABLE")).details,
    ).toEqual({ component: "cursor" });
    vi.stubEnv("API_CURSOR_SECRET", "test-only-cursor-secret-at-least-32-characters");
    transport.error = true;
    const error = await errorOf(await listRoute.GET(request()), 500, "INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("private database details");
  });
  it.each(["Basic invalid", "Bearer", ""])(
    "standalone service composition refuses malformed header %s",
    async (Authorization) => {
      request("", { Authorization });
      expect(await getPeopleDirectory(peopleAccess)).toMatchObject({
        status: "error",
        error: { code: "UNAUTHENTICATED" },
      });
      expect(transport.reads).toHaveLength(0);
    },
  );
  it("exposes only GET handlers", () => {
    expect(Object.keys(listRoute)).toEqual(["GET"]);
  });
});
