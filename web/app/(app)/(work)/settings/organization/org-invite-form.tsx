"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteToOrg } from "./actions";
import { ErrorParagraph } from "./error-paragraph";
import {
  INVITE_COPY,
  INVITE_FAILURE,
  inviteFailure,
  inviteToastOf,
  SIGNED_OUT,
  SOL_ROLE_ITEMS,
  SOL_ROLE_ORDER,
} from "./org-settings-copy";

// 화면의 검증은 편의다. 같은 규칙을 서버(@/server/organization)가 다시 보고, DB 제약이 한 번 더 지킨다.
// 대소문자는 서버가 소문자로 맞춘다. 화면은 입력 중에 글자를 바꾸지 않는다.
const schema = z.object({
  email: z.string().trim().min(1, INVITE_COPY.emailRequired).pipe(z.email(INVITE_COPY.emailFormat)),
  solRole: z.enum(SOL_ROLE_ORDER),
});
type Values = z.infer<typeof schema>;

// 가장 작은 권한부터 준다(D7, DB 기본값과 같다).
const DEFAULT_VALUES: Values = { email: "", solRole: "VIEWER" };

export function OrgInviteForm() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES });
  const { errors, isSubmitting } = form.formState;
  // reset 직후에는 칸이 다시 등록되지 않아, 초점은 렌더 뒤에 이메일 칸으로 돌린다.
  const [sentCount, setSentCount] = useState(0);
  const { setFocus } = form;
  useEffect(() => {
    if (sentCount > 0) setFocus("email");
  }, [sentCount, setFocus]);

  const onSubmit = async (values: Values) => {
    try {
      const result = await inviteToOrg(values);
      if (result.status === "invited" || result.status === "renewed") {
        // 서버는 소문자로 저장한다. 목록과 같은 글자로 알린다.
        const { tone, message } = inviteToastOf(
          values.email.trim().toLowerCase(),
          values.solRole,
          result,
        );
        // 메일 실패는 이 토스트 말고 남는 곳이 없어 오래(10초) 둔다.
        if (tone === "warning") toast.warning(message, { duration: 10_000 });
        else toast.success(message);
        form.reset(DEFAULT_VALUES);
        setSentCount((count) => count + 1);
        return;
      }
      const failure = inviteFailure(result);
      if (failure.field === "email")
        form.setError("email", { message: failure.message }, { shouldFocus: true });
      else form.setError("root", { message: failure.message });
    } catch {
      form.setError("root", { message: INVITE_FAILURE });
    }
  };

  const rootMessage = errors.root?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="org-invite-title">{INVITE_COPY.title}</h2>
        </CardTitle>
      </CardHeader>
      {/* 기준은 화면 폭이 아니라 카드 안의 폭이다(사이드바를 접고 펴면 달라진다). */}
      <CardContent className="@container">
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          aria-labelledby="org-invite-title"
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 @lg:grid-cols-[minmax(0,28rem)_10rem_auto] @lg:items-start @lg:justify-start">
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="org-invite-email">{INVITE_COPY.email}</FieldLabel>
              {/* autoComplete 를 끈다. email 이면 브라우저가 내 이메일을 채운다. 제출 중 readOnly 는 초점을 지킨다. */}
              <Input
                id="org-invite-email"
                type="email"
                autoComplete="off"
                readOnly={isSubmitting}
                aria-invalid={Boolean(errors.email)}
                {...form.register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-invite-role">{INVITE_COPY.role}</FieldLabel>
              <Controller
                control={form.control}
                name="solRole"
                render={({ field }) => (
                  <Select
                    items={SOL_ROLE_ITEMS}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value);
                    }}
                    readOnly={isSubmitting}
                  >
                    <SelectTrigger id="org-invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOL_ROLE_ORDER.map((role) => (
                        <SelectItem key={role} value={role}>
                          {SOL_ROLE_ITEMS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            {/* 라벨(20px)과 간격(8px)만큼 내려 넓은 단에서 입력칸과 줄을 맞춘다. */}
            <Button
              type="submit"
              disabled={isSubmitting}
              focusableWhenDisabled
              className="w-full @lg:mt-7 @lg:w-auto"
            >
              {isSubmitting ? INVITE_COPY.submitting : INVITE_COPY.submit}
            </Button>
          </div>
          {rootMessage ? (
            <ErrorParagraph
              error={{ message: rootMessage, isSignedOut: rootMessage === SIGNED_OUT }}
            />
          ) : null}
          <FieldDescription>{INVITE_COPY.help}</FieldDescription>
        </form>
      </CardContent>
    </Card>
  );
}
