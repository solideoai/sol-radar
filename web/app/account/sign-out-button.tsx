"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// 이 브라우저만 로그아웃한다(scope: local). Supabase 의 기본값(global)은 다른 기기까지 끊는다 — 그 일은 "모든 기기에서 로그아웃"이 한다.
// 폭은 쓰는 쪽이 정한다.
export function SignOutButton({
  className,
  label = "로그아웃",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const signOut = async () => {
    setIsPending(true);
    const { error } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
    setIsPending(false);
    if (error) {
      toast.error(`로그아웃하지 못했습니다: ${error.message}`);
      return;
    }
    // 브라우저에 남은 로그인 뒤 화면(라우터 캐시)을 버린다.
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <Button variant="outline" className={className} onClick={signOut} disabled={isPending}>
      {isPending ? "로그아웃 중…" : label}
    </Button>
  );
}
