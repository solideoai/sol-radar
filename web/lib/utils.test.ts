import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/utils";

describe("maskEmail", () => {
  it("아이디 첫 글자만 두고 나머지 아이디를 *로 가린다", () => {
    expect(maskEmail("solideolab2@gmail.com")).toBe("s**********@gmail.com");
  });

  it("두 칸짜리 글자도 한 글자로 센다", () => {
    expect(maskEmail("한글아이디@kakao.com")).toBe("한****@kakao.com");
  });

  it("@ 가 없으면 첫 글자 뒤를 모두 가린다", () => {
    expect(maskEmail("abcd")).toBe("a***");
  });
});
