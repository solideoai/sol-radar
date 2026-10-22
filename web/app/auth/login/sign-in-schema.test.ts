import { describe, expect, it } from "vitest";
import { signInSchema } from "@/app/auth/login/sign-in-schema";

describe("로그인 식별자", () => {
  it("admin을 데모 계정으로 연결하고 입력한 비밀번호를 그대로 전달한다", () => {
    const input = { email: "admin", password: "entered-password" };
    const result = signInSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      email: "admin@admin.com",
      password: input.password,
    });
  });

  it("이메일 로그인은 유지하고 등록되지 않은 아이디는 거절한다", () => {
    const input = { email: "person@example.com", password: "entered-password" };
    expect(signInSchema.parse(input)).toEqual(input);
    expect(signInSchema.safeParse({ ...input, email: "someone" }).success).toBe(false);
  });
});
