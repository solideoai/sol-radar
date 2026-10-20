"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { COMPANY_TITLE } from "@/components/company/company-tabs";

// 회사 프로필을 읽지 못했을 때. 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
export default function CompanyError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <WorkError error={error} retry={retry} title={COMPANY_TITLE} />;
}
