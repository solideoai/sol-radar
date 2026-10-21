import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectToPersonal } from "./home";

// 옛 주소(/settings 등) → 지금 업무 조직의 주소. 카카오 연결 콜백의 ?kakao=… 는 /settings 를 거쳐 그대로 옮겨져야 한다.
const { requireCurrentOrganization, redirect } = vi.hoisted(() => ({
  requireCurrentOrganization: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT ${destination}`);
  }),
}));
vi.mock("./employment-guard", () => ({ requireCurrentOrganization }));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  requireCurrentOrganization.mockReset();
  redirect.mockClear();
});

describe("redirectToPersonal", () => {
  it("검색값이 없으면 조직 주소로만 보낸다", async () => {
    requireCurrentOrganization.mockResolvedValue({ current: { slug: "solideo" } });
    await expect(redirectToPersonal("settings")).rejects.toThrow("REDIRECT /solideo/settings");
    expect(requireCurrentOrganization).toHaveBeenCalledWith("/settings");
  });

  it("넘긴 검색값을 붙인다(인코딩한다)", async () => {
    requireCurrentOrganization.mockResolvedValue({ current: { slug: "solideo" } });
    await expect(
      redirectToPersonal("settings", new URLSearchParams({ kakao: "connected" })),
    ).rejects.toThrow("REDIRECT /solideo/settings?kakao=connected");
    await expect(
      redirectToPersonal("settings", new URLSearchParams({ kakao: "a&b=/c" })),
    ).rejects.toThrow("REDIRECT /solideo/settings?kakao=a%26b%3D%2Fc");
  });

  it("빈 검색값은 붙이지 않는다", async () => {
    requireCurrentOrganization.mockResolvedValue({ current: { slug: "solideo" } });
    await expect(redirectToPersonal("settings", new URLSearchParams())).rejects.toThrow(
      "REDIRECT /solideo/settings",
    );
    expect(redirect).toHaveBeenLastCalledWith("/solideo/settings");
  });

  it("조직이 없으면 로그인으로(검색값을 싣지 않는다)", async () => {
    requireCurrentOrganization.mockResolvedValue(null);
    await expect(
      redirectToPersonal("settings", new URLSearchParams({ kakao: "connected" })),
    ).rejects.toThrow("REDIRECT /auth/login");
  });
});
