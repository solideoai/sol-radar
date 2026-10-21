"use client";

import { OctagonAlertIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { AppPage } from "@/components/app-page";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/server/shared";

// 업무 화면(대시보드·공고·알림)의 error.tsx 가 함께 그리는 오류 화면(스펙 §3.5).
// 사이드바·상단바는 (work) layout 이 그대로 그리므로 여기서는 본문만 바꾼다.

// 운영 빌드에서 서버 컴포넌트 오류의 message 는 Next 가 이 영어 문장으로 바꿔 보낸다. 사용자에게는 한국어로 보인다.
const REDACTED_MARK = "omitted in production builds";
const FALLBACK_MESSAGE = "화면 데이터를 읽는 중에 오류가 났습니다. 잠시 뒤 다시 시도하세요.";

const visibleMessage = (message: string): string =>
  message.trim() === "" || message.includes(REDACTED_MARK) ? FALLBACK_MESSAGE : message;

export function WorkError({
  error,
  retry,
  title,
  contentClassName,
  typeScale,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  // 오류가 난 화면의 제목(h1). 어느 화면에서 났는지 그대로 보인다.
  title: string;
  // 그 화면의 단 폭. 읽는 중(loading)·오류·정상 화면의 제목 자리가 같게 화면과 같은 값을 넘긴다.
  contentClassName?: string;
  typeScale?: "dashboard";
}) {
  useEffect(() => reportBrowserError(error), [error]);
  return (
    <AppPage title={title} contentClassName={contentClassName} typeScale={typeScale}>
      <section
        role="alert"
        aria-labelledby="work-error-title"
        className="flex flex-col items-start gap-3 rounded-lg border border-destructive p-6"
      >
        <div className="flex items-center gap-2">
          <OctagonAlertIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
          <h2 id="work-error-title" className="type-heading text-foreground">
            불러오지 못했습니다
          </h2>
        </div>
        <p className="type-body wrap-anywhere text-foreground">{visibleMessage(error.message)}</p>
        {error.digest ? (
          // 서버 기록(reportServerError)과 맞춰 볼 번호다.
          <p className="font-mono type-caption text-muted-foreground">오류 ID {error.digest}</p>
        ) : null}
        <Button variant="outline" onClick={() => retry()}>
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          다시 시도
        </Button>
      </section>
    </AppPage>
  );
}
