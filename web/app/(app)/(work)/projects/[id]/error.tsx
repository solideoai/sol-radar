"use client";
import { WorkError } from "@/app/(app)/(work)/work-error";
export default function ProjectsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title="입찰 프로젝트" contentClassName="max-w-360" />
  );
}
