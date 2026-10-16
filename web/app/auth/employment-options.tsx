"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signupOptionsSchema, type SignupOptions } from "@/server/shared";
export const EMPTY_OPTIONS: SignupOptions = {
  companyName: "솔리데오",
  catalogVersion: "solideo-organization/v1.0",
  departments: [],
  jobTitles: [],
};
export function useEmploymentOptions(initial: SignupOptions | null) {
  const [options, setOptions] = useState(initial);
  const [isLoading, setIsLoading] = useState(false);
  const reload = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/signup-options", { cache: "no-store" });
      if (!response.ok) throw new Error("options");
      setOptions(signupOptionsSchema.parse(await response.json()));
    } catch {
      setOptions(null);
    } finally {
      setIsLoading(false);
    }
  };
  return {
    options: options ?? EMPTY_OPTIONS,
    isLoading,
    available: Boolean(options?.departments.length && options?.jobTitles.length),
    failed: options === null,
    reload,
  };
}
export function EmploymentOptionsNotice({
  catalog,
}: {
  catalog: ReturnType<typeof useEmploymentOptions>;
}) {
  if (catalog.isLoading)
    return (
      <p role="status" className="type-label text-muted-foreground">
        선택 목록을 불러오는 중입니다.
      </p>
    );
  if (catalog.available) return null;
  return (
    <div className="flex flex-col gap-2">
      <p role="alert" className="type-label text-destructive">
        {catalog.failed
          ? "불러오지 못했습니다. 선택 목록을 다시 불러와 주세요."
          : "선택할 부서 또는 직급/직책이 없습니다."}
      </p>
      <Button type="button" variant="outline" onClick={catalog.reload}>
        {catalog.failed ? "다시 시도" : "목록 다시 불러오기"}
      </Button>
    </div>
  );
}
