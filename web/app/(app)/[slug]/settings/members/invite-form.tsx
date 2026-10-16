"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
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
import type { InviteResult } from "@/server/organization";
import { invite } from "./actions";
import { ROLE_LABELS, showInviteToast } from "./messages";

// 화면의 검증은 편의다. 같은 규칙을 서버(@/server/organization)가 다시 보고, DB 제약이 한 번 더 지킨다.
// 대소문자는 서버가 소문자로 맞춘다. 화면은 입력 중에 글자를 바꾸지 않는다.
const schema = z.object({
  email: z.string().trim().min(1, "이메일을 입력하세요").pipe(z.email("이메일 형식이 아닙니다")),
  role: z.enum(["member", "owner"]),
});
type Values = z.infer<typeof schema>;

// 가장 작은 권한부터 준다.
const DEFAULT_VALUES: Values = { email: "", role: "member" };

// owner 에게만 보인다(초대 권한은 DB 정책이 강제한다). 메일은 서버 설정이 있을 때만 보내고, 결과는 토스트가 알린다.
export function InviteForm({ orgId }: { orgId: string }) {
  const router = useRouter();
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
      const result = await invite(orgId, values);
      if (result.status === "invited" || result.status === "renewed") {
        // 서버는 소문자로 저장한다. 목록과 같은 글자로 알린다.
        showInviteToast(values.email.trim().toLowerCase(), result);
        form.reset(DEFAULT_VALUES);
        setSentCount((count) => count + 1);
        return;
      }
      form.setError("root", { message: failureMessage(result) });
      // 그새 member 로 바뀌었다. 화면을 새로 그리면 이 폼이 사라진다.
      if (result.status === "forbidden") router.refresh();
    } catch {
      form.setError("root", { message: "초대하지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>초대하기</h2>
        </CardTitle>
      </CardHeader>
      {/* 기준은 화면 폭이 아니라 카드 안의 폭이다(사이드바를 접고 펴면 달라진다). */}
      <CardContent className="@container">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 @lg:grid-cols-[minmax(0,1fr)_10rem_auto] @lg:items-start">
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="invite-email">이메일</FieldLabel>
              {/* autoComplete 를 끈다. email 이면 브라우저가 내 이메일을 채운다. 제출 중 readOnly 는 초점을 지킨다. */}
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                readOnly={isSubmitting}
                aria-invalid={Boolean(errors.email)}
                {...form.register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">역할</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select
                    items={ROLE_LABELS}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value);
                    }}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                      <SelectItem value="owner">{ROLE_LABELS.owner}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            {/* 라벨(20px)과 간격(8px)만큼 내려 넓은 단에서 입력칸과 줄을 맞춘다. */}
            <Button type="submit" disabled={isSubmitting} className="w-full @lg:mt-7 @lg:w-auto">
              {isSubmitting ? "초대 중…" : "초대"}
            </Button>
          </div>
          {errors.root ? (
            <p role="alert" className="type-label text-destructive">
              {errors.root.message}
            </p>
          ) : null}
          <FieldDescription>
            초대받은 사람은 이 이메일로 로그인(계정이 없으면 가입)한 뒤 ‘받은 초대’에서 수락합니다.
            메일을 보냈는지는 초대한 뒤 알려 드립니다.
          </FieldDescription>
        </form>
      </CardContent>
    </Card>
  );
}

function failureMessage(result: Exclude<InviteResult, { status: "invited" | "renewed" }>): string {
  switch (result.status) {
    case "invalid":
      return result.message;
    case "forbidden":
      return "소유자만 초대할 수 있습니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return "로그인이 풀렸습니다. 다시 로그인하세요.";
  }
}
