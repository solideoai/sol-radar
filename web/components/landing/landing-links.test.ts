import { describe, expect, it } from "vitest";
import { startHrefFor } from "@/components/landing/landing-links";

// 시작하기의 목적지. 로그인해 개인 조직이 있으면 대시보드로 바로 가고, 그 밖은 가입 화면에서 시작한다.
describe("startHrefFor", () => {
  it("로그인해 개인 조직이 있으면 그 조직의 대시보드로 간다", () => {
    expect(
      startHrefFor({
        status: "ready",
        userId: "me",
        current: { id: "org", slug: "kim", name: "솔리데오", isPersonal: false, myRole: "member" },
      }),
    ).toBe("/dashboard");
  });

  it.each(["signed-out", "no-database"] as const)("%s 이면 가입 화면으로 간다", (status) => {
    expect(startHrefFor({ status })).toBe("/auth/sign-up");
  });
});
