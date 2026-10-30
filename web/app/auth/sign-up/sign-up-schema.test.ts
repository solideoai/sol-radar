import { describe, expect, it } from "vitest";
import {
  SIGN_UP_DEFAULTS,
  signUpEmailLocal,
  toSignUpRequest,
} from "@/app/auth/sign-up/sign-up-schema";

describe("가입 이메일", () => {
  it("@ 앞부분만 받아 회사 도메인을 붙여 보낸다", () => {
    expect(signUpEmailLocal.parse(" hong ")).toBe("hong");
    expect(signUpEmailLocal.parse("Hong.Gil@SOLIDEOS.com")).toBe("Hong.Gil");
    expect(toSignUpRequest({ ...SIGN_UP_DEFAULTS, emailLocal: "hong" }).email).toBe(
      "hong@solideos.com",
    );
  });

  it("다른 도메인·빈 칸·형식 오류는 오류 하나로 거절한다", () => {
    for (const value of ["hong@gmail.com", "", "hong..gil"]) {
      const result = signUpEmailLocal.safeParse(value);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues).toHaveLength(1);
    }
  });
});
