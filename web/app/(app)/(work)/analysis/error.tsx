"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { ANALYSIS_TITLE } from "./analysis-query";

export default function AnalysisError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry(): void;
}) {
  return (
    <WorkError error={error} retry={retry} title={ANALYSIS_TITLE} contentClassName="max-w-360" />
  );
}
