"use client";

import { useEffect } from "react";
import { kakaoOpenExternalUrl } from "@/app/auth/in-app-browser";
import { Button } from "@/components/ui/button";

// next 는 서버가 거른 사이트 안 경로다. 지금 사이트 주소를 붙여 카카오톡에 넘긴다.
const openInBrowser = (next: string): void => {
  window.location.assign(kakaoOpenExternalUrl(new URL(next, window.location.origin).toString()));
};

// 화면이 뜨면 한 번 바로 넘긴다. 카카오톡이 사용자 누름 없이는 넘기지 않을 때를 위해 버튼도 둔다.
export function OpenInBrowserButton({ next }: { next: string }) {
  useEffect(() => {
    openInBrowser(next);
  }, [next]);

  return (
    <Button type="button" className="w-full" onClick={() => openInBrowser(next)}>
      브라우저로 열기
    </Button>
  );
}
