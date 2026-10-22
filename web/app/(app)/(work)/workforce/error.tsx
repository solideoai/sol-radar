"use client";
import { WorkError } from "@/app/(app)/(work)/work-error";
import { WORKFORCE_TITLE } from "./workforce-query";
export default function WorkforceError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title={WORKFORCE_TITLE} contentClassName="max-w-360" />
  );
}
