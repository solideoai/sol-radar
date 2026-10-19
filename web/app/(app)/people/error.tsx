"use client";
import { useEffect } from "react";
import { AppPage } from "@/components/app-page";
import { PeopleFailure } from "@/components/people/people-directory";
import { reportBrowserError } from "@/server/shared";
export default function PeopleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => reportBrowserError(error), [error]);
  return (
    <AppPage title="조직·인력">
      <PeopleFailure onRetry={retry} />
    </AppPage>
  );
}
