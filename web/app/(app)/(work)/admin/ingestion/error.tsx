"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { INGESTION_TITLE } from "./ingestion-copy";

// 수집 이력을 읽지 못했을 때(N8 스펙 §4.10 화면 오류). 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
export default function IngestionError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title={INGESTION_TITLE} contentClassName="max-w-360" />
  );
}
