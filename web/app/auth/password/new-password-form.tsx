"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// 화면의 검증은 편의다. 비밀번호 규칙의 정본은 Supabase Auth 설정이다.
const schema = z.object({ password: z.string().min(6, "비밀번호는 6자 이상입니다") });
type Values = z.infer<typeof schema>;

export function NewPasswordForm() {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async ({ password }: Values) => {
    // 로그인한 본인의 비밀번호만 바뀐다. 누구인지는 로그인 쿠키가 정한다.
    const { error } = await getSupabaseBrowser().auth.updateUser({ password });
    if (error) {
      form.setError("root", {
        message:
          error.code === "same_password"
            ? "지금 쓰는 비밀번호와 다른 것으로 정하세요"
            : `비밀번호를 바꾸지 못했습니다: ${error.message}`,
      });
      return;
    }
    toast.success("비밀번호를 바꿨습니다");
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="password">새 비밀번호</FieldLabel>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="새 비밀번호를 입력해 주세요"
            aria-invalid={Boolean(errors.password)}
            {...form.register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>
        <FieldError errors={[errors.root]} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </Button>
      </FieldGroup>
    </form>
  );
}
