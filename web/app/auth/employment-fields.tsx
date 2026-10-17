"use client";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { SignupOptions } from "@/server/shared";
import { selectionUnavailable } from "./employment-schema";

export function EmploymentFields<T extends FieldValues>({
  options,
  control,
  disabled,
  loading = false,
}: {
  options: SignupOptions;
  control: Control<T>;
  disabled: boolean;
  loading?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="type-label font-medium">회사</p>
        <p className="type-body">{options.companyName}</p>
      </div>
      <Controller
        control={control}
        name={"name" as Path<T>}
        render={({ field, fieldState }) => (
          <Field data-invalid={Boolean(fieldState.error)}>
            <FieldLabel htmlFor="name">이름 (필수)</FieldLabel>
            <Input
              {...field}
              id="name"
              autoComplete="name"
              placeholder="이름을 입력해 주세요"
              maxLength={40}
              disabled={disabled}
              aria-required="true"
              aria-invalid={Boolean(fieldState.error)}
              aria-describedby={fieldState.error ? "name-error" : undefined}
            />
            <FieldError id="name-error" errors={[fieldState.error]} />
          </Field>
        )}
      />
      {(
        [
          {
            name: "departmentId",
            label: "부서",
            placeholder: "부서를 선택해 주세요",
            items: options.departments,
          },
          {
            name: "jobTitleId",
            label: "직급/직책",
            placeholder: "직급/직책을 선택해 주세요",
            items: options.jobTitles,
          },
        ] as const
      ).map(({ name, label, placeholder, items }) => (
        <Controller
          key={name}
          control={control}
          name={name as Path<T>}
          render={({ field, fieldState }) => {
            const selected = items.find((item) => item.id === field.value);
            const unavailable = Boolean(field.value) && !selected;
            const error =
              fieldState.error ?? (unavailable ? { message: selectionUnavailable } : undefined);
            return (
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={name}>{label} (필수)</FieldLabel>
                {loading ? (
                  <Skeleton className="h-10 w-full" aria-hidden />
                ) : (
                  <Select
                    items={Object.fromEntries(items.map((item) => [item.id, item.label]))}
                    value={selected?.id ?? null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                    disabled={disabled || !items.length}
                  >
                    <SelectTrigger
                      id={name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="w-full min-w-0"
                      aria-required="true"
                      aria-invalid={Boolean(error)}
                      aria-describedby={`${name}-description${error ? ` ${name}-error` : ""}`}
                    >
                      <SelectValue placeholder={placeholder}>
                        <span className="truncate">{selected?.label ?? placeholder}</span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      alignItemWithTrigger={false}
                      className="motion-reduce:animate-none"
                    >
                      {items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          <span className="min-w-0 whitespace-normal wrap-anywhere">
                            {item.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FieldDescription id={`${name}-description`} className="wrap-anywhere">
                  {selected?.label}
                </FieldDescription>
                <FieldError id={`${name}-error`} errors={[error]} />
              </Field>
            );
          }}
        />
      ))}
      <FieldDescription>
        부서와 직급/직책은 본인이 입력하는 정보입니다. 서비스 이용 권한은 별도로 확인합니다.
      </FieldDescription>
    </>
  );
}
