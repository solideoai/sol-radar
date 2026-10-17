import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const { complete, profile } = vi.hoisted(() => ({ complete: vi.fn(), profile: vi.fn() }));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  completeOAuthSignIn: complete,
}));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  complete.mockResolvedValue("/alpha/tasks");
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
});
it("인증 성공 후 미완료 정보로 이동한다", async () => {
  const result = await GET(
    new NextRequest("http://localhost/auth/callback?code=ok&type=email&token_hash=ok"),
  );
  expect(result.headers.get("location")).toBe(
    "http://localhost/auth/complete-profile?next=%2Falpha%2Ftasks",
  );
});
it("완료자는 기존 경로를 따른다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  const result = await GET(
    new NextRequest("http://localhost/auth/callback?code=ok&type=email&token_hash=ok"),
  );
  expect(result.headers.get("location")).toBe("http://localhost/alpha/tasks");
});
it("인증 실패는 보완 검사를 하지 않는다", async () => {
  complete.mockResolvedValue("/auth/login?link=oauth-failed");
  const result = await GET(new NextRequest("http://localhost/auth/callback"));
  expect(result.headers.get("location")).toContain("link=");
  expect(profile).not.toHaveBeenCalled();
});
it("계정 연결는 가로채지 않는다", async () => {
  complete.mockResolvedValue("/account?link=linked");
  const result = await GET(new NextRequest("http://localhost/auth/callback?flow=link&code=ok"));
  expect(result.headers.get("location")).toBe("http://localhost/account?link=linked");
  expect(profile).not.toHaveBeenCalled();
});
