"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { DETAIL_CONTENT_CLASS } from "@/app/(app)/(work)/bids/[id]/detail-copy";
import { REVISIONS_TITLE } from "./revisions-copy";

// 변경 이력을 읽지 못했을 때(스펙 §5.2 S10). 없으면 [id]/error.tsx 가 잡아 제목이 공고 상세로 보인다.
export default function RevisionsError({
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
      title={REVISIONS_TITLE}
      contentClassName={DETAIL_CONTENT_CLASS}
    />
  );
}
