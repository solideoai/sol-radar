"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { CALENDAR_TITLE } from "./calendar-copy";

// 관심 공고나 입찰 프로젝트를 읽지 못했을 때. 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
export default function CalendarError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title={CALENDAR_TITLE} contentClassName="max-w-360" />
  );
}
