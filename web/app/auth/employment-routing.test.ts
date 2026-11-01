import { describe, expect, it } from "vitest";
import { loginPath } from "@/app/auth/employment-routing";

describe("loginPath", () => {
  it("업무 화면 경로를 ?next= 로 실어 로그인 뒤 그 화면으로 돌아오게 한다", () => {
    expect(loginPath("/bids/90c955ea-4724-453f-a076-1b29adbb9ba1")).toBe(
      "/auth/login?next=%2Fbids%2F90c955ea-4724-453f-a076-1b29adbb9ba1",
    );
  });

  it("돌아올 화면이 없거나 기본 화면이면 로그인 주소만 준다", () => {
    expect(loginPath(null)).toBe("/auth/login");
    expect(loginPath("/dashboard")).toBe("/auth/login");
  });

  it("사이트 밖 주소와 계정 화면은 싣지 않는다", () => {
    expect(loginPath("https://evil.example/bids/1")).toBe("/auth/login");
    expect(loginPath("//evil.example")).toBe("/auth/login");
    expect(loginPath("/auth/login?next=%2Fbids")).toBe("/auth/login");
  });
});
