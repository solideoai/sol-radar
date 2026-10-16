"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveDisplayName } from "./actions";

// 화면의 검증은 편의다. 같은 규칙을 서버(@/server/profile)가 다시 보고, DB 제약이 한 번 더 지킨다.
const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "표시 이름을 입력하세요")
    .max(40, "표시 이름은 40자 이하입니다"),
});
type Values = z.infer<typeof schema>;

export function DisplayNameForm({ displayName }: { displayName: string | null }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: displayName ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (values: Values) => {
    const result = await saveDisplayName(values.displayName);
    if (result.status === "saved") {
      toast.success("표시 이름을 저장했습니다");
      return;
    }
    form.setError("root", {
      message:
        result.status === "invalid" ? result.message : "로그인이 풀렸습니다. 다시 로그인하세요.",
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.displayName)}>
          <FieldLabel htmlFor="displayName">표시 이름</FieldLabel>
          <Input
            id="displayName"
            autoComplete="nickname"
            aria-invalid={Boolean(errors.displayName)}
            {...form.register("displayName")}
          />
          <FieldError errors={[errors.displayName]} />
        </Field>
        <FieldError errors={[errors.root]} />
        <Button type="submit" className="self-start" disabled={isSubmitting}>
          {isSubmitting ? "저장 중…" : "저장"}
        </Button>
      </FieldGroup>
    </form>
  );
}
