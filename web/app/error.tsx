"use client";

// 루트 layout 자체가 깨지면 global-error.tsx 가 받는다. 오류 경계는 클라이언트 컴포넌트여야 한다.
import { useEffect } from "react";
import { AuthFrame, AuthHeader } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/server/shared";

export default function ErrorPage({
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

  // 운영에서 서버 오류의 message 는 Next 가 가려 브라우저로 오지 않는다. 서버 기록과 맞춰 볼 digest 만 보여 준다.
  return (
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
  );
}
