import { expect, it, vi } from "vitest";
const { home } = vi.hoisted(() => ({ home: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({
  getMyProfile: async () => ({ status: "ready", profile: { profileComplete: false } }),
}));
vi.mock("@/server/organization", () => ({ getMyHome: home }));
import NewTeamPage from "./page";
it("새 팀 페이지도 홈 데이터 조회 전에 미완료 사용자를 차단한다", async () => {
  await expect(NewTeamPage()).rejects.toThrow(
    "REDIRECT:/auth/complete-profile?next=%2Fteams%2Fnew",
  );
  expect(home).not.toHaveBeenCalled();
});
