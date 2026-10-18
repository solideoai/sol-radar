import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { peopleAccess } from "@/app/_lib/people-access";
import { getPeopleDirectory } from "@/server/people";
import type { PeopleResult } from "@/server/people";
import type { PeopleUiResult } from "@/components/people/people-directory";
import { AppPage } from "@/components/app-page";
// The layout and page share only request-local work; both still invoke the guarded service.
export const loadPeopleDirectory = cache(() => getPeopleDirectory(peopleAccess));
export function peopleUiResult<T>(result: PeopleResult<T>): PeopleUiResult<T> {
  if (result.status === "ready") return result;
  const { code, details } = result.error;
  if (code === "UNAUTHENTICATED" || code === "ACCOUNT_DISABLED") redirect("/auth/login");
  if (code === "PROFILE_INCOMPLETE") redirect("/auth/complete-profile");
  if (
    code === "UNSUPPORTED_ACCOUNT_STATE" ||
    (code === "FORBIDDEN" && details.reason === "ORGANIZATION_REQUIRED")
  )
    redirect("/auth/organization-state");
  return {
    status: "error",
    code,
    ...(typeof details.requestId === "string" ? { requestId: details.requestId } : {}),
  };
}
export function PeopleForbidden({ title = "조직·인력" }: { title?: string } = {}) {
  return (
    <AppPage title={title}>
      <p role="alert" className="type-body">
        조회 권한이 없습니다
      </p>
    </AppPage>
  );
}
