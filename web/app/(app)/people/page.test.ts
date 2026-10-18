import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { directory, list, access, redirect } = vi.hoisted(() => ({
  directory: vi.fn(),
  list: vi.fn(),
  access: { authenticate: vi.fn(), getMyEmployment: vi.fn(), getMyBusinessAccess: vi.fn() },
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/app/_lib/people-access", () => ({ peopleAccess: access }));
vi.mock("@/server/people", () => ({ getPeopleDirectory: directory, listTeamMembers: list }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(callback: T) => callback,
}));
import PeoplePage from "./page";
const data = {
  departments: [],
  jobTitles: [],
  members: [],
  summary: { totalCount: 0, scoringCount: 0 },
};
beforeEach(() => {
  vi.clearAllMocks();
  directory.mockResolvedValue({ status: "ready", data });
  list.mockResolvedValue({
    status: "ready",
    data: {
      items: [],
      pageInfo: {
        cursor: null,
        nextCursor: null,
        previousCursor: null,
        hasNext: false,
        startIndex: 0,
      },
      totalCount: 0,
      summary: data.summary,
    },
  });
});
describe("people SSR page", () => {
  it("loads the whole directory for tree without using20-row list", async () => {
    const element = await PeoplePage({
      searchParams: Promise.resolve({ view: "tree", cursor: "page2", scoring: "1" }),
    });
    expect(directory).toHaveBeenCalledWith(access);
    expect(list).not.toHaveBeenCalled();
    expect(element.props.directory.data).toBe(data);
  });
  it("independently invokes guarded directory and list service, strips view and fixes page size20", async () => {
    await PeoplePage({
      searchParams: Promise.resolve({ view: "list", q: "김", cursor: "opaque" }),
    });
    expect(directory).toHaveBeenCalledWith(access);
    expect(list).toHaveBeenCalledWith(access, expect.any(URLSearchParams));
    const params = list.mock.calls[0][1] as URLSearchParams;
    expect(params.has("view")).toBe(false);
    expect(params.get("q")).toBe("김");
    expect(params.get("limit")).toBe("20");
  });
  it("passes primitive error fields rather than Error instance", async () => {
    list.mockResolvedValue({
      status: "error",
      error: Object.assign(new Error("private"), {
        code: "SERVICE_UNAVAILABLE",
        httpStatus: 503,
        details: {},
      }),
    });
    const element = await PeoplePage({ searchParams: Promise.resolve({}) });
    expect(element.props.list).toEqual({ status: "error", code: "SERVICE_UNAVAILABLE" });
  });
  it.each([
    ["UNAUTHENTICATED", "/auth/login"],
    ["PROFILE_INCOMPLETE", "/auth/complete-profile"],
    ["UNSUPPORTED_ACCOUNT_STATE", "/auth/organization-state"],
  ])("routes %s through existing auth flows", async (code, path) => {
    directory.mockResolvedValue({ status: "error", error: { code, details: {} } });
    await expect(PeoplePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      `redirect:${path}`,
    );
    expect(list).not.toHaveBeenCalled();
  });
  it("denies invalid business role without reading the page", async () => {
    directory.mockResolvedValue({ status: "error", error: { code: "FORBIDDEN", details: {} } });
    const element = await PeoplePage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(element)).toContain("조회 권한이 없습니다");
    expect(list).not.toHaveBeenCalled();
  });
});
