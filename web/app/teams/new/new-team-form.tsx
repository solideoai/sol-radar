"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { create } from "./actions";

// 화면의 검증은 편의다. 같은 규칙을 서버(@/server/organization)가 다시 보고, DB 제약이 한 번 더 지킨다.
// 쓸 수 없는 주소(최상위 경로 이름)와 이미 쓰는 주소는 서버가 주소 칸의 오류로 돌려준다.
// 대문자·공백을 몰래 고치지 않고 오류로 알린다.
const schema = z.object({
  name: z.string().trim().min(1, "팀 이름을 입력하세요").max(40, "팀 이름은 40자 이하입니다"),
  slug: z
    .string()
    .min(1, "주소 이름을 입력하세요")
    .regex(/^[a-z0-9-]{3,32}$/, "소문자·숫자·하이픈으로 3~32자를 씁니다"),
});
type Values = z.infer<typeof schema>;

export function NewTeamForm() {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const slug = useWatch({ control: form.control, name: "slug" });

  const onSubmit = async (values: Values) => {
    try {
      const result = await create(values);
      switch (result.status) {
        case "created":
          toast.success("팀을 만들었습니다. 이제 멤버를 초대하세요.");
          router.push(`/${result.slug}/settings/members`);
          return;
        case "invalid":
          form.setError(result.field, { message: result.message }, { shouldFocus: true });
          return;
        case "signed-out":
          form.setError("root", { message: "로그인이 풀렸습니다. 다시 로그인하세요." });
          return;
      }
    } catch {
      form.setError("root", { message: "팀을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="team-name">팀 이름</FieldLabel>
          <Input
            id="team-name"
            autoComplete="off"
            readOnly={isSubmitting}
            aria-invalid={Boolean(errors.name)}
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={Boolean(errors.slug)}>
          <FieldLabel htmlFor="team-slug">주소 이름</FieldLabel>
          <Input
            id="team-slug"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            readOnly={isSubmitting}
            aria-invalid={Boolean(errors.slug)}
            aria-describedby="team-slug-hint"
            {...form.register("slug")}
          />
          <FieldError errors={[errors.slug]} />
          <FieldDescription id="team-slug-hint" className="wrap-anywhere">
            소문자·숫자·하이픈 3~32자입니다.
            {slug ? (
              <>
                {" "}
                팀 주소는 <code className="font-mono">/{slug}</code> 이 됩니다.
              </>
            ) : null}{" "}
            만든 뒤에는 바꿀 수 없습니다.
          </FieldDescription>
        </Field>
        {errors.root ? (
          <p role="alert" className="type-label text-destructive">
            {errors.root.message}
          </p>
        ) : null}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "만드는 중…" : "팀 만들기"}
        </Button>
      </FieldGroup>
    </form>
  );
}
