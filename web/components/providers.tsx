"use client";

import { Toaster } from "@/components/ui/sonner";

// 앱 전체에 한 번만 까는 클라이언트 쪽 장치. layout(서버 컴포넌트)은 context 를 못 들기 때문에 여기 모은다.
// 브라우저 데이터 캐시(TanStack Query)가 필요해지면 그때 설치하고 QueryClientProvider 를 여기에 둔다.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
