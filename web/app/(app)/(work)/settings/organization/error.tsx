"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { ORG_SETTINGS_TITLE } from "./org-settings-copy";

// 구성원·초대·기록 중 하나라도 읽지 못했을 때(디자인 스펙 §4.7 화면 오류). 다시 시도는 retry()(Next 16).
// 하위 메뉴는 그리지 않는다(사이드바 "설정"으로 계정 화면에 간다).
export default function OrgSettingsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <WorkError error={error} retry={retry} title={ORG_SETTINGS_TITLE} />;
}
