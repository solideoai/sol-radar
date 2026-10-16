import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireCompleteUser } from "@/app/api/v1/_lib/http";
import { GET as getOptions } from "@/app/api/v1/signup-options/route";
import { GET, PATCH } from "./route";

// Keep auth, infra, repository and services real; replace only Next request storage and remote SDK transport.
const transport = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  cookieToken: "token-a" as string | null,
  rows: new Map<
    string,
    {
      display_name: string | null;
      status: string;
      declared_department_id: string | null;
      declared_job_title_id: string | null;
    }
  >(),
  writes: [] as { session: string | null; id: string; values: Record<string, unknown> }[],
  resolverError: null as { code: string; message: string } | null,
  updateError: null as { code: string; message: string } | null,
}));
const departmentId = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
const jobTitleId = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
const catalogRow = {
  department_id: departmentId,
  department_code: "SOL-D001",
  department_name: "AX사업본부 AI플랫폼운영팀",
  job_title_id: jobTitleId,
  job_title_code: "SOL-J007",
  job_title_label: "팀장",
};
function client(token: string | null) {
  const sessionId =
    token === "token-a"
      ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      : token === "token-b"
        ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : null;
  return {
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
        error: null,
      }),
      getClaims: async () =>
        sessionId
          ? {
              data: {
                claims: {
                  sub: sessionId,
                  email: `${sessionId}@example.com`,
                  role: "authenticated",
                  aud: "authenticated",
                  iss: "https://test.supabase.co/auth/v1",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                },
              },
              error: null,
            }
          : { data: null, error: new AuthApiError("Invalid token", 401, "bad_jwt") },
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error("Unexpected table");
      let id = "";
      let values: Record<string, unknown> | null = null;
      const query = {
        eq: (_column: string, value: string) => {
          id = value;
          return query;
        },
        update: (input: Record<string, unknown>) => {
          values = input;
          return query;
        },
        select: () =>
          values === null
            ? query
            : Promise.resolve(
                (() => {
                  transport.writes.push({ session: sessionId, id, values });
                  if (transport.updateError) return { data: null, error: transport.updateError };
                  const row = transport.rows.get(id);
                  if (row && id === sessionId && row.status === "active") {
                    Object.assign(row, values);
                    return { data: [{ id }], error: null };
                  }
                  return { data: [], error: null };
                })(),
              ),
        maybeSingle: async () => ({
          data:
            id === sessionId && transport.rows.has(id)
              ? {
                  email: `${id}@example.com`,
                  is_admin: false,
                  avatar_url: null,
                  created_at: "2026-10-16T00:00:00Z",
                  ...transport.rows.get(id),
                }
              : null,
          error: null,
        }),
      };
      return query;
    },
    rpc: async (_name: string, input: { p_department: string; p_job_title: string }) => {
      if (transport.resolverError) return { data: null, error: transport.resolverError };
      const valid =
        [departmentId, "SOL-D001"].includes(input.p_department) &&
        [jobTitleId, "SOL-J007"].includes(input.p_job_title);
      return valid
        ? { data: [catalogRow], error: null }
        : { data: null, error: { code: "22023", message: "invalid_employment" } };
    },
  };
}
vi.mock("next/headers", () => ({
  headers: async () => transport.requestHeaders,
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => client(transport.cookieToken) }));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (
    _url: string,
    _key: string,
    options: { global: { headers: { Authorization: string } } },
  ) => client(options.global.headers.Authorization.slice(7)),
}));
const validInput = { name: "새 이름", departmentId: "SOL-D001", jobTitleId: "SOL-J007" };
function request(method = "GET", headers: HeadersInit = {}, body: unknown = validInput) {
  const req = new Request("https://app.example/api/v1/me/employment", {
    method,
    headers,
    ...(method === "PATCH" ? { body: JSON.stringify(body) } : {}),
  });
  transport.requestHeaders = req.headers;
  return req;
}
async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({
    code,
    message: expect.any(String),
    details: expect.any(Object),
    requestId: expect.any(String),
  });
  expect(body.error.requestId).toBe(response.headers.get("X-Request-Id"));
  return body.error;
}
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  transport.cookieToken = "token-a";
  transport.requestHeaders = new Headers();
  transport.writes = [];
  transport.resolverError = null;
  transport.updateError = null;
  transport.rows = new Map(
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"].map((id) => [
      id,
      {
        display_name: id,
        status: "active",
        declared_department_id: departmentId,
        declared_job_title_id: jobTitleId,
      },
    ]),
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("v1 employment contract with real identity binding", () => {
  it("serves a public exact-key projection without a session", async () => {
    transport.cookieToken = null;
    const response = await getOptions(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "catalogVersion",
      "companyName",
      "departments",
      "jobTitles",
    ]);
    expect(body.departments).toHaveLength(38);
    expect(body.jobTitles).toHaveLength(12);
    for (const option of [...body.departments, ...body.jobTitles])
      expect(Object.keys(option).sort()).toEqual(["id", "label"]);
  });
  it("returns 401 to a signed-out user", async () => {
    transport.cookieToken = null;
    await errorOf(await GET(request()), 401, "UNAUTHENTICATED");
  });
  it("returns 403 for a suspended session", async () => {
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.status = "suspended";
    await errorOf(await GET(request()), 403, "ACCOUNT_DISABLED");
    expect(transport.writes).toHaveLength(0);
  });
  it("rejects a cookie PATCH without the CSRF header", async () => {
    await errorOf(await PATCH(request("PATCH")), 403, "CSRF_REJECTED");
    expect(transport.writes).toHaveLength(0);
  });
  it("cookie PATCH writes current user A in one statement and returns persisted state", async () => {
    const response = await PATCH(request("PATCH", { "X-Requested-With": "sol-radar" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "새 이름",
      employment: {
        companyName: "솔리데오",
        departmentId: "SOL-D001",
        departmentName: catalogRow.department_name,
        jobTitleId: "SOL-J007",
        jobTitleLabel: "팀장",
      },
      profileComplete: true,
    });
    expect(transport.writes).toEqual([
      {
        session: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        values: {
          display_name: "새 이름",
          declared_department_id: departmentId,
          declared_job_title_id: jobTitleId,
        },
      },
    ]);
    expect(transport.rows.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!.display_name).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });
  it("Bearer B overrides cookie A for guard, lookup and persistence without CSRF", async () => {
    const response = await PATCH(request("PATCH", { Authorization: "Bearer token-b" }));
    expect(response.status).toBe(200);
    expect(transport.writes[0]).toMatchObject({
      session: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.display_name).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const read = await GET(request("GET", { Authorization: "Bearer token-b" }));
    expect((await read.json()).name).toBe("새 이름");
  });
  it.each(["Bearer invalid", "Basic invalid", "Bearer", ""])(
    "does not fall through authorization %s to cookie A",
    async (authorization) => {
      await errorOf(await PATCH(request("PATCH", { authorization })), 401, "UNAUTHENTICATED");
      expect(transport.writes).toHaveLength(0);
    },
  );
  it.each(["userId", "orgId", "is_admin", "profileComplete"])(
    "rejects injected %s before any write",
    async (key) => {
      const error = await errorOf(
        await PATCH(
          request(
            "PATCH",
            { "X-Requested-With": "sol-radar" },
            { ...validInput, [key]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          ),
        ),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.any(String), message: expect.any(String) }),
        ]),
      );
      expect(transport.writes).toHaveLength(0);
    },
  );
  it("rejects malformed JSON and unknown catalogs", async () => {
    const req = new Request("https://app.example/api/v1/me/employment", {
      method: "PATCH",
      headers: { "X-Requested-With": "sol-radar" },
      body: "{",
    });
    transport.requestHeaders = req.headers;
    await errorOf(await PATCH(req), 400, "VALIDATION_ERROR");
    await errorOf(
      await PATCH(
        request(
          "PATCH",
          { "X-Requested-With": "sol-radar" },
          { ...validInput, departmentId: "other-company" },
        ),
      ),
      400,
      "VALIDATION_ERROR",
    );
    expect(transport.writes).toHaveLength(0);
  });
  it("recomputes incomplete state after name or catalog deletion", async () => {
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.display_name = null;
    expect((await (await GET(request())).json()).profileComplete).toBe(false);
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.display_name = "가";
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.declared_department_id = null;
    expect(await (await GET(request())).json()).toEqual({
      name: "가",
      employment: null,
      profileComplete: false,
    });
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.declared_department_id =
      "deleted-uuid";
    expect((await (await GET(request())).json()).profileComplete).toBe(false);
  });
  it("maps only known invalid employment SQL errors to validation", async () => {
    transport.updateError = { code: "22023", message: "invalid_employment" };
    await errorOf(
      await PATCH(request("PATCH", { "X-Requested-With": "sol-radar" })),
      400,
      "VALIDATION_ERROR",
    );
  });
  it("maps a deleted catalog rejected by the save resolver to field validation", async () => {
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.declared_department_id = null;
    transport.resolverError = { code: "22023", message: "invalid_employment" };
    const error = await errorOf(
      await PATCH(request("PATCH", { "X-Requested-With": "sol-radar" })),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      "departmentId",
      "jobTitleId",
    ]);
    expect(transport.writes).toHaveLength(0);
  });
  it("does not mistake other 22023 errors for an invalid employment declaration", async () => {
    transport.updateError = { code: "22023", message: "unrelated database constraint" };
    await errorOf(
      await PATCH(request("PATCH", { "X-Requested-With": "sol-radar" })),
      500,
      "INTERNAL_ERROR",
    );
  });
  it("arbitrary resolver faults return generic internal error instead of incomplete or success", async () => {
    transport.resolverError = { code: "XX000", message: "private database detail" };
    const error = await errorOf(await GET(request()), 500, "INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("private database detail");
  });
  it("correlates unexpected failure logs with the generic response without logging request credentials", async () => {
    transport.resolverError = { code: "XX000", message: "catalog unavailable" };
    const response = await GET(request("GET", { Authorization: "Bearer token-b" }));
    const error = await errorOf(response, 500, "INTERNAL_ERROR");
    expect(console.error).toHaveBeenCalledTimes(1);
    const record = JSON.parse(vi.mocked(console.error).mock.calls[0][0]);
    expect(record).toMatchObject({
      source: "server",
      requestId: error.requestId,
      message: "catalog unavailable",
      method: "GET",
    });
    expect(JSON.stringify(record)).not.toContain("token-b");
  });
  it("returns service unavailable when DB is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await errorOf(await GET(request()), 503, "SERVICE_UNAVAILABLE");
  });
  it("completion guard allows complete current users and blocks incomplete users before business access", async () => {
    expect(await requireCompleteUser(request())).toMatchObject({
      ok: true,
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    transport.rows.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.display_name = null;
    const blocked = await requireCompleteUser(request());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      const error = await errorOf(blocked.response, 403, "PROFILE_INCOMPLETE");
      expect(error.details).toEqual({ completionPath: "/auth/complete-profile" });
    }
  });
});
