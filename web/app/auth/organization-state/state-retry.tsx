"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
export function StateRetry({ failed = false }: { failed?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      focusableWhenDisabled
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      aria-live="polite"
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "확인 중…" : failed ? "다시 시도" : "다시 확인"}
    </Button>
  );
}
