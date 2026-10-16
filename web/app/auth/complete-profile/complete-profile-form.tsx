"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AccountLink } from "@/app/auth/account-card";
import { EmploymentFields } from "@/app/auth/employment-fields";
import { EmploymentOptionsNotice, useEmploymentOptions } from "@/app/auth/employment-options";
import { createEmploymentSchema, selectionUnavailable } from "@/app/auth/employment-schema";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  employmentStateSchema,
  employmentNameSchema,
  type EmploymentInput,
  type EmploymentState,
  type SignupOptions,
} from "@/server/shared";

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z
      .object({ issues: z.array(z.object({ path: z.string(), message: z.string() })).optional() })
      .optional(),
  }),
});
const valuesOf = (state: EmploymentState | null): EmploymentInput => ({
  name: state?.name ?? "",
  departmentId: state?.employment?.departmentId ?? "",
  jobTitleId: state?.employment?.jobTitleId ?? "",
});
const SAVE_ERROR = "저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.";

export function CompleteProfileForm({
  options,
  state,
  next,
}: {
  options: SignupOptions | null;
  state: EmploymentState | null;
  next: string;
}) {
  const router = useRouter();
  const catalog = useEmploymentOptions(options);
  const [loaded, setLoaded] = useState(state !== null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const departureVersion = useRef(0);
  const leaving = useRef(false);
  const errorFocus = useRef<keyof EmploymentInput | null>(null);
  const [catalogRejected, setCatalogRejected] = useState(false);
  const pending = useRef(false);
  const form = useForm<EmploymentInput>({
    resolver: zodResolver(createEmploymentSchema(catalog.options)),
    defaultValues: valuesOf(state),
  });
  const { errors, isSubmitting } = form.formState;
  const { setFocus } = form;
  useEffect(() => {
    if (!isSubmitting && errorFocus.current) {
      setFocus(errorFocus.current);
      errorFocus.current = null;
    }
  }, [isSubmitting, errors, setFocus]);
  const [loadError, setLoadError] = useState(state === null);
  const handleFailure = (status: number, body: unknown) => {
    if (status === 401) {
      setSessionExpired(true);
      return;
    }
    const parsed = errorSchema.safeParse(body);
    if (parsed.success && parsed.data.error.code === "VALIDATION_ERROR") {
      const issues = parsed.data.error.details?.issues ?? [];
      issues.forEach(({ path }) => {
        if (path === "name" || path === "departmentId" || path === "jobTitleId") {
          if (!errorFocus.current) errorFocus.current = path;
          if (path !== "name") setCatalogRejected(true);
          form.setError(path, {
            message: path === "name" ? "이름을 확인해 주세요." : selectionUnavailable,
          });
        }
      });
      form.setError("root", { message: "필수 정보를 확인해 주세요." });
    } else
      form.setError("root", {
        message: status === 429 ? "잠시 후 다시 시도해 주세요." : SAVE_ERROR,
      });
  };
  const reloadProfile = async () => {
    if (isLoading) return;
    const version = departureVersion.current;
    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/me/employment", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        handleFailure(response.status, body);
        return;
      }
      if (version !== departureVersion.current || leaving.current) return;
      const current = employmentStateSchema.parse(body);
      if (current.profileComplete) {
        router.replace(next);
        router.refresh();
        return;
      }
      form.reset(valuesOf(current));
      setLoaded(true);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };
  const submit = async (values: EmploymentInput) => {
    if (
      pending.current ||
      leaving.current ||
      !loaded ||
      !catalog.available ||
      isComplete ||
      isSigningOut
    )
      return;
    const version = departureVersion.current;
    pending.current = true;
    try {
      const response = await fetch("/api/v1/me/employment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Requested-With": "sol-radar" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (version !== departureVersion.current || leaving.current) return;
      if (!response.ok) {
        handleFailure(response.status, body);
        return;
      }
      const saved = employmentStateSchema.parse(body);
      if (!saved.profileComplete) {
        if (!employmentNameSchema.safeParse(saved.name).success) {
          form.setError("name", { message: "이름을 확인해 주세요." });
          errorFocus.current = "name";
        }
        if (!saved.employment) {
          form.setError("departmentId", { message: selectionUnavailable });
          form.setError("jobTitleId", { message: selectionUnavailable });
          errorFocus.current ??= "departmentId";
          setCatalogRejected(true);
        }
        form.setError("root", { message: "필수 정보를 확인해 주세요." });
        return;
      }
      setIsComplete(true);
      router.replace(next);
      router.refresh();
    } catch {
      if (version === departureVersion.current && !leaving.current)
        form.setError("root", { message: SAVE_ERROR });
    } finally {
      pending.current = false;
    }
  };
  const signOut = async () => {
    if (isSigningOut) return;
    departureVersion.current += 1;
    leaving.current = true;
    setIsSigningOut(true);
    setLogoutError(null);
    try {
      const { error } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/auth/login");
      router.refresh();
    } catch {
      leaving.current = false;
      setLogoutError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      setIsSigningOut(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        noValidate
        aria-busy={isSubmitting}
        className="flex flex-col gap-4"
      >
        <EmploymentFields
          options={catalog.options}
          control={form.control}
          disabled={isSubmitting || isComplete || !loaded || isSigningOut}
          loading={catalog.isLoading}
        />
        <EmploymentOptionsNotice catalog={catalog} />
        {catalogRejected && catalog.available ? (
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting || catalog.isLoading}
            onClick={catalog.reload}
          >
            선택 목록 다시 불러오기
          </Button>
        ) : null}
        {!loaded ? (
          <div className="flex flex-col gap-2">
            <p role={isLoading ? "status" : "alert"} className="type-label text-muted-foreground">
              {isLoading
                ? "정보를 불러오는 중입니다."
                : loadError
                  ? "불러오지 못했습니다. 정보를 다시 불러와 주세요."
                  : "정보를 불러오는 중입니다."}
            </p>
            <Button type="button" variant="outline" disabled={isLoading} onClick={reloadProfile}>
              정보 다시 시도
            </Button>
          </div>
        ) : null}
        {sessionExpired ? (
          <p role="alert" className="type-label">
            로그인이 필요합니다. 다시 로그인해 주세요.{" "}
            <AccountLink href="/auth/login">로그인</AccountLink>
          </p>
        ) : null}
        {errors.root ? (
          <p role="alert" className="type-label text-destructive">
            {errors.root.message}
          </p>
        ) : null}
        {isComplete ? (
          <p role="status" className="type-label">
            정보를 저장했습니다.
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={
            isSubmitting ||
            isComplete ||
            !loaded ||
            !catalog.available ||
            catalog.isLoading ||
            isSigningOut ||
            sessionExpired
          }
        >
          {isSubmitting ? "저장 중…" : "저장하고 계속"}
        </Button>
      </form>
      <p className="text-center type-body">
        <AccountLink
          href="/auth/account"
          onNavigate={() => {
            departureVersion.current += 1;
            leaving.current = true;
          }}
        >
          계정 관리
        </AccountLink>
      </p>
      {logoutError ? (
        <p role="alert" className="type-label text-destructive">
          {logoutError}
        </p>
      ) : null}
      <Button type="button" variant="ghost" onClick={signOut} disabled={isSigningOut}>
        {isSigningOut ? "로그아웃 중…" : "로그아웃"}
      </Button>
    </div>
  );
}
