import { beforeEach, expect, it, vi } from "vitest";
const { employment, options } = vi.hoisted(() => ({ employment: vi.fn(), options: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({ getMyEmployment: employment, getSignupOptions: options }));
import CompleteProfilePage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  employment.mockResolvedValue({
    status: "ready",
    state: { name: "이름", employment: null, profileComplete: true },
  });
});
it.each(["/auth/complete-profile", "//evil.test", "/auth/callback"])(
  "완료자는 순환/외부 next %s 대신 기본 진입으로",
  async (next) => {
    await expect(CompleteProfilePage({ searchParams: Promise.resolve({ next }) })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
    expect(options).not.toHaveBeenCalled();
  },
);
it("완료자는 안전한 내부 목적지로", async () => {
  await expect(
    CompleteProfilePage({ searchParams: Promise.resolve({ next: "/alpha/tasks" }) }),
  ).rejects.toThrow("REDIRECT:/alpha/tasks");
});
it.each(["signed-out", "suspended", "missing", "no-database"])(
  "%s 안내는 로그인으로",
  async (status) => {
    employment.mockResolvedValue({ status });
    await expect(CompleteProfilePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/auth/login",
    );
  },
);
