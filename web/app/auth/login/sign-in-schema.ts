import { z } from "zod";

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal("admin"), z.email()], { error: "아이디 또는 이메일을 확인하세요" }))
    .transform((value) => (value === "admin" ? "admin@admin.com" : value)),
  password: z.string().min(6, "비밀번호는 6자 이상입니다"),
});

export type SignInValues = z.input<typeof signInSchema>;
export type Credentials = z.output<typeof signInSchema>;
