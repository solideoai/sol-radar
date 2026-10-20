"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { NOTIFICATIONS_TITLE } from "./notifications-copy";

// 알림을 읽지 못했을 때(스펙 §3.5). 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
export default function NotificationsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <WorkError error={error} retry={retry} title={NOTIFICATIONS_TITLE} />;
}
