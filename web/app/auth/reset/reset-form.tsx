"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const schema = z.object({ email: z.email("이메일 형식이 아닙니다") });
type Values = z.infer<typeof schema>;

export function ResetForm() {
  const [isMailSent, setIsMailSent] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async ({ email }: Values) => {
    // 링크의 모양(/auth/confirm?…&next=/auth/password)은 메일 템플릿이 정한다(supabase/templates/recovery.html).
    const { error } = await getSupabaseBrowser().auth.resetPasswordForEmail(email);
    if (error) {
      form.setError("root", { message: `메일을 보내지 못했습니다: ${error.message}` });
      return;
    }
    setIsMailSent(true);
  };

  // 가입된 주소인지는 알려 주지 않는다. 알려 주면 남의 이메일이 가입돼 있는지 캐낼 수 있다.
  if (isMailSent) {
    return (
      <p role="status" className="text-center type-body text-muted-foreground">
        가입된 주소라면 재설정 메일을 보냈습니다. 메일의 링크를 열어 새 비밀번호를 정하세요.
      </p>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="email">이메일</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="이메일을 입력해 주세요"
            aria-invalid={Boolean(errors.email)}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <FieldError errors={[errors.root]} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "보내는 중…" : "재설정 메일 받기"}
        </Button>
      </FieldGroup>
    </form>
  );
}
