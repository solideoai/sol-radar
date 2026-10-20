"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { DETAIL_CONTENT_CLASS, DETAIL_TITLE } from "./detail-copy";

// 공고 상세를 읽지 못했을 때(스펙 §3.5). 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
// 사이드바·상단바는 (work) layout 이 그대로 그린다.
export default function BidDetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError
      error={error}
      retry={retry}
      title={DETAIL_TITLE}
      contentClassName={DETAIL_CONTENT_CLASS}
    />
  );
}
