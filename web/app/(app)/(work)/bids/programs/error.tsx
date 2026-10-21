"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { PROGRAMS_TITLE } from "./programs-copy";

// 부처 공고 목록을 읽지 못했을 때(디자인 스펙 §4.7 오류). 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
// WorkError 는 AppPage 를 직접 그려 자식을 받지 않으므로 링크 줄이 없다(사이드바·주소로 옮긴다, §4.2).
export default function ProgramsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title={PROGRAMS_TITLE} contentClassName="max-w-360" />
  );
}
