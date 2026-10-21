"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function OpportunityRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCwIcon aria-hidden className="size-4" />
      {isPending ? "불러오는 중…" : "데이터 새로고침"}
    </Button>
  );
}
