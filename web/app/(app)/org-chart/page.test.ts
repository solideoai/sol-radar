import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { directory, access } = vi.hoisted(() => ({
  directory: vi.fn(),
  access: { authenticate: vi.fn(), getMyEmployment: vi.fn(), getMyBusinessAccess: vi.fn() },
}));
vi.mock("@/app/_lib/people-access", () => ({ peopleAccess: access }));
vi.mock("@/server/people", () => ({ getPeopleDirectory: directory }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(callback: T) => callback,
}));
import OrgChartPage from "./page";
const data = {
  departments: [],
  jobTitles: [],
  members: [],
  summary: { totalCount: 0, scoringCount: 0 },
};
beforeEach(() => {
  vi.clearAllMocks();
  directory.mockResolvedValue({ status: "ready", data });
});
describe("organization chart SSR", () => {
  it("reads the full guarded current-org directory without accepting a client org or list page", async () => {
    const element = await OrgChartPage();
    expect(directory).toHaveBeenCalledExactlyOnceWith(access);
    expect(element.props.directory).toEqual({ status: "ready", data });
  });
  it("passes only primitive failure fields including available requestId", async () => {
    directory.mockResolvedValue({
      status: "error",
      error: Object.assign(new Error("private"), {
        code: "SERVICE_UNAVAILABLE",
        details: { requestId: "request-1" },
      }),
    });
    const element = await OrgChartPage();
    expect(element.props.directory).toEqual({
      status: "error",
      code: "SERVICE_UNAVAILABLE",
      requestId: "request-1",
    });
  });
  it("keeps invalid-role denial distinct from recoverable catalog failure", async () => {
    directory.mockResolvedValue({ status: "error", error: { code: "FORBIDDEN", details: {} } });
    const element = await OrgChartPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("조회 권한이 없습니다");
    expect(html).toContain("조직도");
  });
  it.each([
    ["UNAUTHENTICATED", "/auth/login"],
    ["PROFILE_INCOMPLETE", "/auth/complete-profile"],
    ["UNSUPPORTED_ACCOUNT_STATE", "/auth/organization-state"],
  ])("preserves %s account routing", async (code, path) => {
    directory.mockResolvedValue({ status: "error", error: { code, details: {} } });
    await expect(OrgChartPage()).rejects.toThrow(`redirect:${path}`);
  });
});
