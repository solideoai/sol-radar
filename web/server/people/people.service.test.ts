import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDepartments,
  getJobTitles,
  getPeopleDirectory,
  getTeamMember,
  listTeamMembers,
  type PeopleAccess,
} from "./people.service";
import type { PeopleRepo } from "./people.repo";
import type { PeoplePage, PeopleResult } from "./people.model";
import { rows } from "./people.test-data";
const orgId = "org-current";
const access = (): PeopleAccess => ({
  authenticate: vi.fn<PeopleAccess["authenticate"]>(async () => ({
    status: "ready",
    user: { id: "user", email: "user@example.com", role: "user" },
  })),
  getMyEmployment: vi.fn<PeopleAccess["getMyEmployment"]>(async () => ({
    status: "ready",
    state: {
      name: "사용자",
      employment: {
        companyName: "솔리데오",
        departmentId: "SOL-D001",
        departmentName: "팀",
        jobTitleId: "SOL-J007",
        jobTitleLabel: "팀장",
      },
      profileComplete: true,
    },
  })),
  getMyBusinessAccess: vi.fn<PeopleAccess["getMyBusinessAccess"]>(async () => ({
    status: "ready",
    userId: "user",
    current: {
      id: orgId,
      slug: "team",
      name: "회사",
      isPersonal: false,
      myRole: "member",
      solRole: "VIEWER",
    },
  })),
});
const repo = (): PeopleRepo => ({
  listDepartments: vi.fn(async () => rows.departments),
  listJobTitles: vi.fn(async () => rows.jobTitles),
  listMembers: vi.fn(async () =>
    rows.members.map((p) => ({ ...p, portrait_path: p.portrait_path ?? "" })),
  ),
  listScoring: vi.fn(async () =>
    rows.scoring.map((s) => ({
      ...s,
      skills: s.skills as string[],
      availability: s.availability as { startsAt: string; endsAt: string; fte: number }[],
    })),
  ),
  findMember: vi.fn(async (_org, id) => {
    const p = rows.members.find((m) => m.id === id);
    return p ? { ...p, portrait_path: p.portrait_path ?? "" } : null;
  }),
  findScoring: vi.fn(async (_org, id) => {
    const s = rows.scoring.find((s) => s.member_id === id);
    return s
      ? {
          ...s,
          skills: s.skills as string[],
          availability: s.availability as { startsAt: string; endsAt: string; fte: number }[],
        }
      : null;
  }),
});
function ready<T>(result: PeopleResult<T>): T {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw result.error;
  return result.data;
}
beforeEach(() => vi.stubEnv("API_CURSOR_SECRET", "test-only-cursor-secret-at-least-32-characters"));
afterEach(() => vi.unstubAllEnvs());
describe("independently authorized read services", () => {
  it.each(["VIEWER", "ANALYST", "SALES", "ADMIN"] as const)(
    "allows role %s and reads all 200 for tree",
    async (solRole) => {
      const auth = access();
      auth.getMyBusinessAccess = async () => ({
        status: "ready",
        userId: "user",
        current: {
          id: orgId,
          slug: "team",
          name: "회사",
          isPersonal: false,
          myRole: "member",
          solRole,
        },
      });
      const storage = repo();
      const directory = ready(await getPeopleDirectory(auth, storage));
      expect(directory.members).toHaveLength(200);
      expect(directory.summary).toEqual({ totalCount: 200, scoringCount: 200 });
      expect(storage.listMembers).toHaveBeenCalledWith(orgId);
      expect(ready(await getDepartments(auth, new URLSearchParams(), storage))).toHaveLength(48);
      expect(ready(await getJobTitles(auth, new URLSearchParams(), storage))).toEqual(
        rows.jobTitles,
      );
    },
  );
  it("walks 200 unique people with next/previous cursors and server totals", async () => {
    const auth = access(),
      storage = repo();
    const ids: string[] = [];
    let cursor: string | null = null;
    let second: PeoplePage | undefined;
    do {
      const page: PeoplePage = ready(
        await listTeamMembers(auth, new URLSearchParams(cursor ? { cursor } : {}), storage),
      );
      expect(page.totalCount).toBe(200);
      expect(page.summary).toEqual({ totalCount: 200, scoringCount: 200 });
      expect(page.pageInfo.startIndex).toBe(ids.length);
      ids.push(...page.items.map((p) => p.id));
      if (page.pageInfo.startIndex === 20) second = page;
      cursor = page.pageInfo.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(200);
    expect(ids).toHaveLength(200);
    expect(second?.pageInfo.previousCursor).toBeNull();
    const third = ready(
      await listTeamMembers(
        auth,
        new URLSearchParams({ cursor: second!.pageInfo.nextCursor! }),
        storage,
      ),
    );
    const back = ready(
      await listTeamMembers(
        auth,
        new URLSearchParams({ cursor: third.pageInfo.previousCursor! }),
        storage,
      ),
    );
    expect(back.items).toEqual(second!.items);
    expect(back.pageInfo.startIndex).toBe(20);
  });
  it("applies scoring filters and returns all calculation details only in detail", async () => {
    const auth = access(),
      storage = repo();
    expect(
      ready(await listTeamMembers(auth, new URLSearchParams("scoring=0&limit=100"), storage))
        .totalCount,
    ).toBe(0);
    expect(
      ready(await listTeamMembers(auth, new URLSearchParams("scoring=1&limit=100"), storage)).items,
    ).toHaveLength(100);
    expect(
      ready(await listTeamMembers(auth, new URLSearchParams("scoring=1&limit=100"), storage))
        .totalCount,
    ).toBe(200);
    const detail = ready(
      await getTeamMember(auth, rows.scoring[0].member_id, new URLSearchParams(), storage),
    );
    expect(detail.scoring).not.toBeNull();
    expect(
      ready(await getTeamMember(auth, rows.members[0].id, new URLSearchParams(), storage)).scoring,
    ).not.toBeNull();
    storage.findScoring = async () => null;
    expect(
      ready(await getTeamMember(auth, rows.members[0].id, new URLSearchParams(), storage)).scoring,
    ).toBeNull();
    expect(storage.findMember).toHaveBeenCalledWith(orgId, rows.members[0].id);
  });
  it.each(["departmentId", "jobTitleId"])("returns 404 for unknown/foreign %s", async (key) => {
    const result = await listTeamMembers(
      access(),
      new URLSearchParams({ [key]: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
      repo(),
    );
    expect(result).toMatchObject({
      status: "error",
      error: { httpStatus: 404, code: "NOT_FOUND" },
    });
  });
  it("rejects upper department filters, non-UUID details and org injection", async () => {
    const auth = access(),
      storage = repo();
    expect(
      await listTeamMembers(
        auth,
        new URLSearchParams({
          departmentId: rows.departments.find((d) => d.kind === "DIVISION")!.id,
        }),
        storage,
      ),
    ).toMatchObject({ status: "error", error: { code: "VALIDATION_ERROR", httpStatus: 400 } });
    expect(await getTeamMember(auth, "SOL-P0001", new URLSearchParams(), storage)).toMatchObject({
      status: "error",
      error: { httpStatus: 400 },
    });
    expect(
      await getTeamMember(
        auth,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        new URLSearchParams(),
        storage,
      ),
    ).toMatchObject({ status: "error", error: { httpStatus: 404 } });
    for (const run of [
      () => getDepartments(auth, new URLSearchParams("orgId=evil"), storage),
      () => getJobTitles(auth, new URLSearchParams("orgId=evil"), storage),
      () => getTeamMember(auth, rows.members[0].id, new URLSearchParams("orgId=evil"), storage),
      () => listTeamMembers(auth, new URLSearchParams("orgId=evil"), storage),
    ])
      expect(await run()).toMatchObject({ status: "error", error: { code: "VALIDATION_ERROR" } });
  });
  it.each(["no-org", "multiple-orgs", "forbidden", "signed-out", "no-database"] as const)(
    "rejects business context %s before directory read",
    async (status) => {
      const auth = access(),
        storage = repo();
      auth.getMyBusinessAccess = async () =>
        status === "no-org" || status === "multiple-orgs" ? { status, userId: "user" } : { status };
      const result = await getPeopleDirectory(auth, storage);
      expect(result).toMatchObject({
        status: "error",
        error: {
          httpStatus: status === "signed-out" ? 401 : status === "no-database" ? 503 : 403,
          code:
            status === "multiple-orgs"
              ? "UNSUPPORTED_ACCOUNT_STATE"
              : status === "signed-out"
                ? "UNAUTHENTICATED"
                : status === "no-database"
                  ? "SERVICE_UNAVAILABLE"
                  : "FORBIDDEN",
        },
      });
      expect(storage.listMembers).not.toHaveBeenCalled();
      if (status === "no-org")
        expect(result).toMatchObject({
          error: {
            details: {
              reason: "ORGANIZATION_REQUIRED",
              organizationStatePath: "/auth/organization-state",
            },
          },
        });
    },
  );
  it.each(["unauthenticated", "suspended", "no-database"] as const)(
    "rejects authentication %s before any service resource",
    async (status) => {
      const auth = access(),
        storage = repo();
      auth.authenticate = async () => ({ status });
      const results = await Promise.all([
        getDepartments(auth, new URLSearchParams(), storage),
        getJobTitles(auth, new URLSearchParams(), storage),
        getPeopleDirectory(auth, storage),
        listTeamMembers(auth, new URLSearchParams(), storage),
        getTeamMember(auth, rows.members[0].id, new URLSearchParams(), storage),
      ]);
      expect(results.every((result) => result.status === "error")).toBe(true);
      expect(auth.getMyBusinessAccess).not.toHaveBeenCalled();
      expect(storage.listMembers).not.toHaveBeenCalled();
    },
  );
  it("rejects incomplete, disabled or missing employment and mismatched identity", async () => {
    for (const status of ["incomplete", "suspended", "missing"] as const) {
      const auth = access(),
        storage = repo();
      auth.getMyEmployment = async () =>
        status === "incomplete"
          ? { status: "ready", state: { name: "", employment: null, profileComplete: false } }
          : { status };
      expect(await getPeopleDirectory(auth, storage)).toMatchObject({
        status: "error",
        error: {
          httpStatus: 403,
          code: status === "suspended" ? "ACCOUNT_DISABLED" : "PROFILE_INCOMPLETE",
        },
      });
      expect(storage.listMembers).not.toHaveBeenCalled();
    }
    const auth = access();
    auth.getMyBusinessAccess = async () => ({
      status: "ready",
      userId: "other",
      current: {
        id: orgId,
        slug: "team",
        name: "회사",
        isPersonal: false,
        myRole: "member",
        solRole: "VIEWER",
      },
    });
    expect(await getPeopleDirectory(auth, repo())).toMatchObject({
      status: "error",
      error: { code: "FORBIDDEN" },
    });
  });
  it("reports missing cursor configuration, rejects tampering/filter changes, propagates DB faults", async () => {
    const auth = access(),
      storage = repo();
    const page = ready(await listTeamMembers(auth, new URLSearchParams(), storage));
    expect(
      await listTeamMembers(
        auth,
        new URLSearchParams({ cursor: page.pageInfo.nextCursor!, scoring: "1" }),
        storage,
      ),
    ).toMatchObject({ status: "error", error: { code: "INVALID_CURSOR" } });
    expect(
      await listTeamMembers(auth, new URLSearchParams({ cursor: "tampered" }), storage),
    ).toMatchObject({ status: "error", error: { code: "INVALID_CURSOR" } });
    vi.stubEnv("API_CURSOR_SECRET", "");
    expect(await listTeamMembers(auth, new URLSearchParams(), storage)).toMatchObject({
      status: "error",
      error: { httpStatus: 503, code: "SERVICE_UNAVAILABLE", details: { component: "cursor" } },
    });
    storage.listDepartments = async () => {
      throw new Error("DB failure");
    };
    await expect(getPeopleDirectory(auth, storage)).rejects.toThrow("DB failure");
  });
});
