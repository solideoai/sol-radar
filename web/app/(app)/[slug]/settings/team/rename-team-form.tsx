"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { RenameTeamResult } from "@/server/organization";
import { rename } from "./actions";

// 화면의 검증은 편의다. 팀을 만들 때와 같은 규칙을 서버(@/server/organization)가 다시 보고, DB 제약이 한 번 더 지킨다.
// 공백을 몰래 고치지 않는다 — 앞뒤 공백만 떼고 보낸다.
const schema = z.object({
  name: z.string().trim().min(1, "팀 이름을 입력하세요").max(40, "팀 이름은 40자 이하입니다"),
});
type Values = z.infer<typeof schema>;

const SAVE_FAILURE = "팀 이름을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 폼 아래에 남길 오류. 권한 없음은 다시 그리면 이 폼이 사라지므로 토스트로 따로 알린다.
const rootFailure = (status: "signed-out" | "personal-org"): string =>
  status === "signed-out" ? "로그인이 풀렸습니다. 다시 로그인하세요." : SAVE_FAILURE;

export function RenameTeamForm({
  orgId,
  name,
  slug,
}: {
  orgId: string;
  name: string;
  slug: string;
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name } });
  const { errors, isSubmitting } = form.formState;
  const saveRef = useRef<HTMLButtonElement>(null);
  const wasSubmittingRef = useRef(false);
  // 누른 "저장"이 제출 중 꺼지면서 초점이 문서 처음으로 빠진다. 끝나면 그 버튼으로 돌려놓는다.
  // 칸에서 Enter 로 냈거나 오류 칸으로 초점이 갔으면 그대로 둔다.
  useEffect(() => {
    if (isSubmitting) {
      wasSubmittingRef.current = true;
      return;
    }
    if (!wasSubmittingRef.current) return;
    wasSubmittingRef.current = false;
    if (document.activeElement === document.body) saveRef.current?.focus();
  }, [isSubmitting]);

  const onResult = (result: RenameTeamResult) => {
    switch (result.status) {
      case "renamed":
        toast.success("팀 이름을 저장했습니다");
        // 칸을 서버가 저장한 이름(앞뒤 공백을 뗀 것)에 맞춘다. 앱 틀과 설명 줄은 서버 함수가 다시 그린다.
        form.reset({ name: result.name });
        return;
      case "invalid":
        form.setError(result.field, { message: result.message }, { shouldFocus: true });
        return;
      case "forbidden":
        // 서버 함수가 화면을 다시 그렸다. 그새 member 가 됐으면 이 폼 대신 읽기 전용 모양이 보인다.
        toast.error("소유자만 팀 이름을 바꿀 수 있습니다. 화면을 새로 고칩니다.");
        return;
      case "signed-out":
      case "personal-org":
        form.setError("root", { message: rootFailure(result.status) });
        return;
    }
  };

  const onSubmit = async (values: Values) => {
    try {
      onResult(await rename(orgId, values));
    } catch {
      form.setError("root", { message: SAVE_FAILURE });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="team-name">팀 이름</FieldLabel>
          {/* 제출 중 readOnly 는 초점을 지킨다(disabled 면 초점이 빠진다). */}
          <Input
            id="team-name"
            autoComplete="off"
            readOnly={isSubmitting}
            aria-invalid={Boolean(errors.name)}
            aria-describedby="team-name-hint"
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
          <FieldDescription id="team-name-hint" className="wrap-anywhere">
            40자까지 씁니다. 팀 주소(<code className="font-mono">/{slug}</code>)는 바뀌지 않습니다.
          </FieldDescription>
        </Field>
        {errors.root ? (
          <p role="alert" className="type-label text-destructive">
            {errors.root.message}
          </p>
        ) : null}
        <Button ref={saveRef} type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "저장 중…" : "저장"}
        </Button>
      </FieldGroup>
    </form>
  );
}
