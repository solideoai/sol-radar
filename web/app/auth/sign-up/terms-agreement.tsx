"use client";

import { type UseFormReturn, useWatch } from "react-hook-form";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import type { SignUpValues } from "./sign-up-schema";

type AgreementName = "agreeTerms" | "agreePrivacy" | "agreeAge" | "agreeMarketing";

const AGREEMENTS: { name: AgreementName; label: string }[] = [
  { name: "agreeTerms", label: "이용약관 동의 (필수)" },
  { name: "agreePrivacy", label: "개인정보 수집·이용 동의 (필수)" },
  { name: "agreeAge", label: "만 14세 이상입니다 (필수)" },
  { name: "agreeMarketing", label: "마케팅 정보 수신 동의 (선택)" },
];
const AGREEMENT_NAMES = AGREEMENTS.map((agreement) => agreement.name);

// 체크 상자는 브라우저 기본 부품에 토큰 색(accent-primary)만 입힌다. 키보드·화면 읽기 프로그램이 그대로 동작한다.
const CHECKBOX = "size-4 shrink-0 accent-primary";

// 동의는 아직 저장하지 않는다(sign-up-schema.ts). 저장을 붙일 때 동의한 항목과 시각을 함께 남긴다.
// 이용약관 본문은 서비스마다 달라 이 템플릿에 없다. 운영 전에 약관 화면을 만들고 "이용약관 동의" 옆에 잇는다.
export function TermsAgreement({ form }: { form: UseFormReturn<SignUpValues> }) {
  const { errors, isSubmitted } = form.formState;
  const values = useWatch({ control: form.control, name: AGREEMENT_NAMES });
  const isAllChecked = values.every(Boolean);

  const setAll = (checked: boolean) =>
    AGREEMENTS.forEach(({ name }) =>
      form.setValue(name, checked, { shouldValidate: isSubmitted, shouldDirty: true }),
    );

  return (
    <FieldSet>
      <FieldLegend variant="label">약관 동의</FieldLegend>
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <Field orientation="horizontal">
          <input
            id="agreeAll"
            type="checkbox"
            className={CHECKBOX}
            checked={isAllChecked}
            onChange={(event) => setAll(event.target.checked)}
          />
          <FieldLabel htmlFor="agreeAll" className="font-semibold">
            전체 동의
          </FieldLabel>
        </Field>
        <Separator />
        {AGREEMENTS.map(({ name, label }) => (
          <div key={name} className="flex flex-col gap-1.5">
            <Field orientation="horizontal" data-invalid={Boolean(errors[name])}>
              <input
                id={name}
                type="checkbox"
                className={CHECKBOX}
                aria-invalid={Boolean(errors[name])}
                {...form.register(name)}
              />
              <FieldLabel htmlFor={name} className="font-normal">
                {label}
              </FieldLabel>
            </Field>
            {name === "agreePrivacy" ? <PrivacySummary /> : null}
            <FieldError errors={[errors[name]]} className="pl-6" />
          </div>
        ))}
      </div>
    </FieldSet>
  );
}

// 법이 동의 받을 때 알리라고 한 네 가지(항목·목적·기간·거부할 권리). 이 템플릿이 실제로 하는 일에 맞춰 적었다 — 서비스에 맞게 고친다.
function PrivacySummary() {
  return (
    <details className="pl-6 type-label text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        내용 보기
      </summary>
      <dl className="mt-2 grid gap-1.5 rounded-lg bg-muted px-3 py-2.5">
        <div>
          <dt className="font-medium text-foreground">수집 항목</dt>
          <dd>필수: 이메일, 비밀번호, 이름, 부서, 직급/직책 · 선택: 휴대폰 번호, 주소, 생년월일</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">이용 목적</dt>
          <dd>회원 식별과 로그인, 서비스 제공과 안내</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">보유 기간</dt>
          <dd>회원 탈퇴 때까지. 탈퇴하면 바로 지웁니다.</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">동의를 거부할 권리</dt>
          <dd>동의하지 않을 수 있지만, 필수 항목에 동의하지 않으면 가입할 수 없습니다.</dd>
        </div>
      </dl>
    </details>
  );
}
