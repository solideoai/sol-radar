"use client";
import { useEffect } from "react";
import { AppPage } from "@/components/app-page";
import { OrgChartFailure } from "@/components/people/org-chart-directory";
import { reportBrowserError } from "@/server/shared";
export default function OrgChartError({
  error,
  retry,
}: {
  error: Error & { digest?: string; requestId?: string };
  retry: () => void;
}) {
  useEffect(() => reportBrowserError(error), [error]);
  return (
    <AppPage title="조직도">
      <OrgChartFailure onRetry={retry} requestId={error.requestId} />
    </AppPage>
  );
}
