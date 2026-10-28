"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { GAPS_CONTENT_CLASS, GAPS_TITLE } from "./gaps-copy";

// 서버 오류(가정 재계산 실패 포함). 주소의 assume 은 남아 다시 시도하면 같은 가정으로 다시 계산한다.
export default function GapsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry(): void;
}) {
  return (
    <WorkError
      error={error}
      retry={retry}
      title={GAPS_TITLE}
      contentClassName={GAPS_CONTENT_CLASS}
    />
  );
}
