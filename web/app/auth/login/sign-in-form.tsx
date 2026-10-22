"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { signInSchema, type Credentials, type SignInValues } from "@/app/auth/login/sign-in-schema";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { SUSPENDED_NOTICE } from "@/app/auth/notices";

// 화면의 검증은 편의다. 맞는 비밀번호인지는 Supabase Auth 가, 무엇을 읽을 수 있는지는 RLS 가 판단한다.
export function SignInForm() {
  const router = useRouter();
  const form = useForm<SignInValues, unknown, Credentials>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (credentials: Credentials) => {
    const { error } = await getSupabaseBrowser().auth.signInWithPassword(credentials);
    if (error) {
      form.setError("root", {
        message:
          error.code === "invalid_credentials"
            ? "아이디·이메일 또는 비밀번호가 맞지 않습니다"
            : error.code === "user_banned"
              ? SUSPENDED_NOTICE
              : `로그인하지 못했습니다: ${error.message}`,
      });
      return;
    }
    // 서버 컴포넌트를 다시 그리면 로그인 화면(/auth/login)이 ?next= 나 개인 조직의 대시보드로 보낸다.
    router.refresh();
  };

  return (
    <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="email">아이디 또는 이메일</FieldLabel>
          <Input
            id="email"
            type="text"
            autoComplete="username"
            placeholder="아이디 또는 이메일을 입력해 주세요"
            aria-invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="password">비밀번호</FieldLabel>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="비밀번호를 입력해 주세요"
            aria-invalid={Boolean(errors.password)}
            {...form.register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>
        <FieldError errors={[errors.root]} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "로그인 중…" : "로그인"}
        </Button>
      </FieldGroup>
    </form>
  );
}
