"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AccountLink } from "@/app/auth/account-card";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { EmploymentFields } from "@/app/auth/employment-fields";
import { EmploymentOptionsNotice, useEmploymentOptions } from "@/app/auth/employment-options";
import type { SignupOptions } from "@/server/shared";
import { AddressSearch } from "./address-search";
import {
  formatPhone,
  MIN_BIRTH_DATE,
  SIGN_UP_DEFAULTS,
  SIGN_UP_EMAIL_DOMAIN,
  createSignUpSchema,
  type SignUpValues,
  toSignUpRequest,
} from "./sign-up-schema";
import { TermsAgreement } from "./terms-agreement";

// 규칙과 무엇을 서버로 보내는지는 sign-up-schema.ts 에 있다. 휴대폰·주소·생년월일은 아직 보내지 않는다.
// children: 이메일 가입 아래에 둘 다른 가입 방법(간편 로그인 버튼). 확인 메일을 보낸 뒤에는 그리지 않는다.
export function SignUpForm({
  children,
  options,
}: {
  children?: React.ReactNode;
  options: SignupOptions | null;
}) {
  const catalog = useEmploymentOptions(options);
  const pending = useRef(false);
  const errorFocus = useRef<keyof SignUpValues | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const router = useRouter();
  const [isMailSent, setIsMailSent] = useState(false);
  const form = useForm<SignUpValues>({
    resolver: zodResolver(createSignUpSchema(catalog.options)),
    defaultValues: SIGN_UP_DEFAULTS,
    shouldFocusError: false,
  });
  const { errors, isSubmitting, isSubmitted } = form.formState;
  const { setFocus } = form;
  useEffect(() => {
    if (!isSubmitting && errorFocus.current) {
      setFocus(errorFocus.current);
      errorFocus.current = null;
    }
  }, [isSubmitting, errors, setFocus]);
  const [postcode, address] = useWatch({ control: form.control, name: ["postcode", "address"] });

  const onAddress = useCallback(
    (selected: { postcode: string; address: string }) => {
      // 제출해 본 뒤에는 바로 다시 검사해 상세 주소의 "먼저 고르세요" 오류를 지운다.
      form.setValue("postcode", selected.postcode, { shouldValidate: isSubmitted });
      form.setValue("address", selected.address, { shouldValidate: isSubmitted });
      if (isSubmitted) void form.trigger("addressDetail");
    },
    [form, isSubmitted],
  );

  const onSubmit = async (values: SignUpValues) => {
    if (pending.current || isFinishing || !catalog.available) return;
    pending.current = true;
    try {
      const { data, error } = await getSupabaseBrowser().auth.signUp(toSignUpRequest(values));
      if (error) {
        const message =
          error.code === "user_already_exists"
            ? "이미 가입된 이메일입니다"
            : error.code === "weak_password"
              ? "더 안전한 비밀번호를 입력해 주세요."
              : error.code === "over_request_rate_limit" ||
                  error.code === "over_email_send_rate_limit"
                ? "잠시 후 다시 시도해 주세요."
                : "가입하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.";
        const field =
          error.code === "user_already_exists"
            ? "emailLocal"
            : error.code === "weak_password"
              ? "password"
              : "root";
        errorFocus.current = field === "root" ? null : field;
        form.setError(field, { message });
        return;
      }
      if (data.session) {
        setIsFinishing(true);
        router.replace("/auth/login");
        router.refresh();
        return;
      }
      setIsMailSent(true);
    } catch {
      form.setError("root", {
        message: "가입하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.",
      });
    } finally {
      pending.current = false;
    }
  };

  // 메일 확인을 켠 프로젝트에서 Supabase 는 이미 가입된 주소에도 같은 응답을 준다(가입 여부를 알려 주지 않으려는 것).
  if (isMailSent) {
    return (
      <p role="status" className="text-center type-body text-muted-foreground">
        확인 메일을 보냈습니다. 메일의 링크를 열면 가입이 끝납니다. 메일이 오지 않으면 이미 가입된
        주소일 수 있습니다 —{" "}
        <Link
          href="/auth/login"
          className="rounded-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          로그인
        </Link>
        해 보세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) =>
          void form.handleSubmit(onSubmit, (errors) => {
            errorFocus.current =
              (Object.keys(SIGN_UP_DEFAULTS) as Array<keyof SignUpValues>).find((name) =>
                Boolean(errors[name]),
              ) ?? null;
          })(event)
        }
        noValidate
        aria-busy={isSubmitting || isFinishing}
      >
        <fieldset disabled={isSubmitting || isFinishing} className="min-w-0">
          <FieldGroup className="gap-8">
            <FieldGroup>
              <EmploymentFields
                options={catalog.options}
                control={form.control}
                disabled={isSubmitting || isFinishing}
                loading={catalog.isLoading}
              />
              <EmploymentOptionsNotice catalog={catalog} />
              <Field data-invalid={Boolean(errors.emailLocal)}>
                <FieldLabel htmlFor="email">이메일</FieldLabel>
                {/* @ 뒤는 회사 도메인으로 고정한다. 화면 읽기에도 도메인이 함께 읽히게 설명으로 잇는다. */}
                <div className="flex items-center gap-2">
                  <Input
                    id="email"
                    type="text"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="아이디"
                    aria-describedby="email-domain"
                    aria-invalid={Boolean(errors.emailLocal)}
                    {...form.register("emailLocal")}
                  />
                  <span id="email-domain" className="shrink-0 type-body text-muted-foreground">
                    @{SIGN_UP_EMAIL_DOMAIN}
                  </span>
                </div>
                <FieldError errors={[errors.emailLocal]} />
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="password">비밀번호</FieldLabel>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  placeholder="6자 이상 입력해 주세요"
                  aria-invalid={Boolean(errors.password)}
                  {...form.register("password")}
                />
                <FieldError errors={[errors.password]} />
              </Field>
              <Field data-invalid={Boolean(errors.passwordConfirm)}>
                <FieldLabel htmlFor="passwordConfirm">비밀번호 확인</FieldLabel>
                <PasswordInput
                  id="passwordConfirm"
                  autoComplete="new-password"
                  placeholder="비밀번호를 한 번 더 입력해 주세요"
                  aria-invalid={Boolean(errors.passwordConfirm)}
                  {...form.register("passwordConfirm")}
                />
                <FieldError errors={[errors.passwordConfirm]} />
              </Field>
            </FieldGroup>

            <FieldSet>
              <FieldLegend variant="label">추가 정보 (선택)</FieldLegend>
              <FieldDescription>
                휴대폰 번호·주소·생년월일은 아직 저장하지 않습니다. 안전하게 저장하는 기능을 붙이면
                함께 저장됩니다.
              </FieldDescription>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.phone)}>
                  <FieldLabel htmlFor="phone">휴대폰 번호</FieldLabel>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="010-1234-5678"
                    aria-invalid={Boolean(errors.phone)}
                    {...form.register("phone", {
                      // 입력 중에는 건드리지 않고(커서가 튀지 않게) 칸을 떠날 때 하이픈을 맞춘다.
                      onBlur: (event: React.FocusEvent<HTMLInputElement>) =>
                        form.setValue("phone", formatPhone(event.target.value), {
                          shouldValidate: isSubmitted,
                        }),
                    })}
                  />
                  <FieldError errors={[errors.phone]} />
                </Field>
                {/* 칸 셋을 한 묶음으로 읽게 그룹에 제목을 잇는다. 칸마다의 이름은 aria-label 이다. */}
                <Field data-invalid={Boolean(errors.addressDetail)} aria-labelledby="address-title">
                  <FieldTitle id="address-title">주소</FieldTitle>
                  <div className="flex gap-2">
                    {/* 우편번호·기본 주소는 검색 결과로만 채운다(오타 없이 같은 모양으로 저장하려고). */}
                    <Input
                      id="postcode"
                      readOnly
                      value={postcode}
                      placeholder="우편번호"
                      aria-label="우편번호"
                      className="w-28 shrink-0"
                      tabIndex={-1}
                    />
                    <AddressSearch
                      onSelect={onAddress}
                      focusAfterSelect={() => document.getElementById("addressDetail")}
                    />
                  </div>
                  <Input
                    readOnly
                    value={address}
                    placeholder="주소 검색으로 채워집니다"
                    aria-label="기본 주소"
                    tabIndex={-1}
                  />
                  <Input
                    id="addressDetail"
                    autoComplete="address-line2"
                    placeholder="상세 주소 (동·호수 등)"
                    aria-label="상세 주소"
                    maxLength={100}
                    aria-invalid={Boolean(errors.addressDetail)}
                    {...form.register("addressDetail")}
                  />
                  <FieldError errors={[errors.addressDetail]} />
                </Field>
                <Field data-invalid={Boolean(errors.birthDate)}>
                  <FieldLabel htmlFor="birthDate">생년월일</FieldLabel>
                  <Input
                    id="birthDate"
                    type="date"
                    autoComplete="bday"
                    min={MIN_BIRTH_DATE}
                    aria-invalid={Boolean(errors.birthDate)}
                    {...form.register("birthDate")}
                  />
                  <FieldError errors={[errors.birthDate]} />
                </Field>
              </FieldGroup>
            </FieldSet>

            <TermsAgreement form={form} />

            <div className="flex flex-col gap-3">
              <FieldError errors={[errors.root]} />
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || isFinishing || !catalog.available || catalog.isLoading}
              >
                {isSubmitting || isFinishing ? "가입 중…" : "회원가입"}
              </Button>
            </div>
          </FieldGroup>
        </fieldset>
      </form>
      <p className="text-center type-label text-muted-foreground">
        이미 계정이 있나요? <AccountLink href="/auth/login">로그인</AccountLink>
      </p>
      {children}
    </div>
  );
}
