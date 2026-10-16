"use client";

// 루트 layout 을 통째로 대신하므로 html·body 를 직접 두고 전역 CSS(토큰·글꼴)도 다시 불러온다.
// metadata 를 못 쓰므로 제목은 <title> 로 단다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { useEffect } from "react";
import { AuthFrame, AuthHeader } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/server/shared";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // 오류 수집 도구는 reportBrowserError 한 곳에 붙인다(server/shared/error-report.ts).
    reportBrowserError(error);
  }, [error]);

  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col break-keep">
        <title>문제가 생겼습니다</title>
        {/* 루트 layout 이 깨진 상태라 홈으로 보내도 같은 오류가 난다. 그래서 홈 링크를 두지 않는다. */}
        <AuthFrame>
          <AuthHeader
            title="문제가 생겼습니다"
            note={
              error.digest ? (
                <>
                  오류 번호 <code className="font-mono">{error.digest}</code>
                </>
              ) : null
            }
          >
            화면을 보여 주는 중에 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.
          </AuthHeader>
          <Button className="w-full" onClick={() => retry()}>
            다시 시도
          </Button>
        </AuthFrame>
      </body>
    </html>
  );
}
