import { beforeEach, expect, it, vi } from "vitest";
const { profile, home, workspace, mutation, routeHeader, members } = vi.hoisted(() => ({
  routeHeader: vi.fn(),
  members: vi.fn(),
  profile: vi.fn(),
  home: vi.fn(),
  workspace: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: routeHeader }) }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({
  getMembersPage: members,
  getMyHome: home,
  getCurrentOrganization: home,
  getMyWorkspace: workspace,
  createTeam: mutation,
  inviteMember: mutation,
  cancelInvitation: mutation,
  changeMemberRole: mutation,
  removeMember: mutation,
  leaveOrg: mutation,
  renameTeam: mutation,
  deleteTeam: mutation,
}));
vi.mock("@/server/task", () => ({
  addTask: mutation,
  updateTask: mutation,
  changeTaskStatus: mutation,
  deleteTask: mutation,
}));
import { requireCompleteEmployment } from "./employment-guard";
import { loadWorkspace, requireWorkspace } from "./[slug]/workspace";
import LegacyMemosPage from "./memos/page";
import { createTask, saveTask, changeStatus, removeTask } from "./[slug]/tasks/actions";
import { invite, cancel, changeRole, remove, leave } from "./[slug]/settings/members/actions";
import { rename, remove as deleteTeam } from "./[slug]/settings/team/actions";
import { create } from "@/app/teams/new/actions";
beforeEach(() => {
  vi.clearAllMocks();
  routeHeader.mockReturnValue(null);
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
  mutation.mockResolvedValue({ status: "forbidden" });
});
it("직접 경로를 보완 next로 보존한다", async () => {
  await expect(requireCompleteEmployment("/alpha/tasks?q=1")).rejects.toThrow(
    "REDIRECT:/auth/complete-profile?next=%2Falpha%2Ftasks%3Fq%3D1",
  );
});
it("내부 페이지 이동은 조직 조회 전에 막는다", async () => {
  await expect(requireWorkspace("alpha", "/alpha/tasks")).rejects.toThrow(
    "REDIRECT:/auth/complete-profile",
  );
  expect(workspace).not.toHaveBeenCalled();
});
it("실제 /memos 진입은 정확한 복귀 주소를 보존하고 완료 뒤 업무 작업으로 이동한다", async () => {
  await expect(LegacyMemosPage()).rejects.toThrow(
    /^REDIRECT:\/auth\/complete-profile\?next=%2Fmemos$/,
  );
  expect(home).not.toHaveBeenCalled();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({
    status: "ready",
    userId: "me",
    current: { id: "org", slug: "business" },
  });
  await expect(LegacyMemosPage()).rejects.toThrow(/^REDIRECT:\/business\/tasks$/);
});
it.each([
  () => createTask("org", {}),
  () => saveTask("org", "id", {}),
  () => changeStatus("org", "id", "done"),
  () => removeTask("org", "id"),
  () => invite("org", {}),
  () => cancel("id"),
  () => changeRole("org", "id", "owner"),
  () => remove("org", "id"),
  () => leave("org"),
  () => rename("org", {}),
  () => deleteTeam("org", {}),
  () => create({}),
])("직접 Server Action도 저장 전에 보완한다", async (action) => {
  await expect(action()).rejects.toThrow("REDIRECT:/auth/complete-profile");
  expect(mutation).not.toHaveBeenCalled();
  for (const status of ["signed-out", "no-database"]) {
    profile.mockResolvedValue({ status });
    home.mockResolvedValue({ status });
    mutation.mockResolvedValue({ status: "signed-out" });
    await expect(action()).resolves.toEqual({ status: "signed-out" });
  }
  expect(mutation).not.toHaveBeenCalled();
});
it("완료도 기존 멤버십 거절을 통과하지 못한다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  workspace.mockResolvedValue({ status: "not-found" });
  await expect(requireWorkspace("stranger")).rejects.toThrow("NOT_FOUND");
  home.mockResolvedValue({ status: "ready", userId: "me", current: { id: "org", slug: "alpha" } });
  await expect(createTask("stranger", {})).rejects.toThrow("NOT_FOUND");
});
it.each(["missing", "suspended"])("%s는 로그인 안내로", async (status) => {
  profile.mockResolvedValue({ status });
  await expect(requireCompleteEmployment("/dashboard")).rejects.toThrow("REDIRECT:/auth/login");
});

it("레이아웃 직접 조회도 전달받은 업무 경로를 보존하고 데이터 읽기 전에 막는다", async () => {
  await expect(loadWorkspace("alpha", "/alpha/tasks?q=1")).rejects.toThrow(
    "REDIRECT:/auth/complete-profile?next=%2Falpha%2Ftasks%3Fq%3D1",
  );
  expect(workspace).not.toHaveBeenCalled();
});

it.each(["/alpha/tasks?q=hello", "/alpha/settings?link=linked"])(
  "페이지 가드가 먼저 실행돼도 실제 경로 %s를 보존한다",
  async (path) => {
    routeHeader.mockReturnValue(path);
    await expect(requireWorkspace("alpha", "/alpha/dashboard")).rejects.toThrow(
      `REDIRECT:/auth/complete-profile?next=${encodeURIComponent(path)}`,
    );
  },
);

it.each(["signed-out", "no-database"])(
  "%s는 기존 안내 조회를 허용하되 업무 페이지 진입은 허용하지 않는다",
  async (status) => {
    profile.mockResolvedValue({ status });
    workspace.mockResolvedValue({ status });
    home.mockResolvedValue({ status });
    await expect(loadWorkspace("alpha")).resolves.toEqual({ status });
    await expect(requireWorkspace("alpha")).rejects.toThrow(/^REDIRECT:\/auth\/login$/);
    await expect(LegacyMemosPage()).rejects.toThrow(/^REDIRECT:\/auth\/login$/);
  },
);

it.each(["no-org", "multiple-orgs"])(
  "every business action blocks %s before mutation",
  async (status) => {
    profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
    home.mockResolvedValue({ status, userId: "me" });
    for (const action of [
      () => createTask("org", {}),
      () => saveTask("org", "id", {}),
      () => changeStatus("org", "id", "done"),
      () => removeTask("org", "id"),
      () => invite("org", {}),
      () => cancel("id"),
      () => changeRole("org", "id", "owner"),
      () => remove("org", "id"),
      () => leave("org"),
      () => rename("org", {}),
      () => deleteTeam("org", {}),
      () => create({}),
    ]) {
      await expect(action()).rejects.toThrow("REDIRECT:/auth/organization-state");
    }
    expect(mutation).not.toHaveBeenCalled();
  },
);
it("a forged org cannot select the historical personal membership for mutation", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({
    status: "ready",
    userId: "me",
    current: { id: "business", slug: "alpha" },
  });
  for (const action of [
    () => createTask("personal", {}),
    () => invite("personal", {}),
    () => rename("personal", {}),
    () => create({ name: "company", slug: "new-company" }),
  ]) {
    await expect(action()).rejects.toThrow("NOT_FOUND");
  }
  expect(mutation).not.toHaveBeenCalled();
});

it.each([
  () => createTask("personal", {}),
  () => saveTask("personal", "id", {}),
  () => changeStatus("personal", "id", "done"),
  () => removeTask("personal", "id"),
  () => invite("personal", {}),
  () => changeRole("personal", "id", "owner"),
  () => remove("personal", "id"),
  () => leave("personal"),
  () => rename("personal", {}),
  () => deleteTeam("personal", {}),
])("every retained organization mutation rejects an alternate membership", async (action) => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({
    status: "ready",
    userId: "me",
    current: { id: "business", slug: "alpha" },
  });
  await expect(action()).rejects.toThrow("NOT_FOUND");
  expect(mutation).not.toHaveBeenCalled();
});
it("cancel invitation is bound to current business owner's pending invitations", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  const current = { id: "business", slug: "alpha", myRole: "owner" };
  home.mockResolvedValue({ status: "ready", userId: "me", current });
  members.mockResolvedValue({ status: "team", invitations: [{ id: "owned" }] });
  await expect(cancel("foreign")).rejects.toThrow("NOT_FOUND");
  expect(mutation).not.toHaveBeenCalled();
  mutation.mockResolvedValue({ status: "done" });
  await expect(cancel("owned")).resolves.toEqual({ status: "done" });
  expect(members).toHaveBeenCalledWith({ org: current, userId: "me" });
  expect(mutation).toHaveBeenCalledWith("owned");
});
it.each(["missing", "suspended"])(
  "%s precedes organization and mutation checks",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(createTask("foreign", {})).rejects.toThrow("REDIRECT:/auth/login");
    expect(home).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  },
);
