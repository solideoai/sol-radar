import { beforeEach, expect, it, vi } from "vitest";
const { profile, home, workspace, mutation, routeHeader } = vi.hoisted(() => ({
  routeHeader: vi.fn(),
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
  getMyHome: home,
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
it("실제 /memos 진입은 정확한 복귀 주소를 보존하고 완료 뒤 개인 작업으로 이동한다", async () => {
  await expect(LegacyMemosPage()).rejects.toThrow(
    /^REDIRECT:\/auth\/complete-profile\?next=%2Fmemos$/,
  );
  expect(home).not.toHaveBeenCalled();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({ status: "ready", personalSlug: "personal" });
  await expect(LegacyMemosPage()).rejects.toThrow(/^REDIRECT:\/personal\/tasks$/);
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
});
it("완료도 기존 멤버십 거절을 통과하지 못한다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  workspace.mockResolvedValue({ status: "not-found" });
  await expect(requireWorkspace("stranger")).rejects.toThrow("NOT_FOUND");
  expect(await createTask("stranger", {})).toEqual({ status: "forbidden" });
});
it.each(["signed-out", "missing", "suspended", "no-database"])(
  "%s는 로그인 안내로",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(requireCompleteEmployment("/dashboard")).rejects.toThrow("REDIRECT:/auth/login");
  },
);

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
