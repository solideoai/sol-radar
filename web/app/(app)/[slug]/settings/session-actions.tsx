"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignOutButton } from "@/app/account/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// 이 기기만(local) 또는 모든 기기(global). global 은 Supabase Auth 가 그 사람의 모든 refresh token 을 끊고, 이 브라우저의 쿠키도 지운다.
// 다른 기기는 이미 받은 access token 이 만료될 때(기본 1시간)까지 남는다 — 문구가 그만큼만 약속한다.
export function SessionActions() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignOutEverywhere = async () => {
    setIsPending(true);
    setError(null);
    const { error: signOutError } = await getSupabaseBrowser().auth.signOut({ scope: "global" });
    if (signOutError) {
      setError(`로그아웃하지 못했습니다: ${signOutError.message}`);
      setIsPending(false);
      return;
    }
    toast.success("모든 기기에서 로그아웃했습니다");
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-3">
      <SignOutButton label="이 기기에서 로그아웃" />
      <Button
        variant="outline"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
      >
        모든 기기에서 로그아웃
      </Button>
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>모든 기기에서 로그아웃할까요?</DialogTitle>
            <DialogDescription>
              이 브라우저를 포함해 로그인한 모든 브라우저와 앱에서 로그아웃합니다. 다른 기기는
              길게는 1시간 안에 로그아웃됩니다.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isPending} />}>
              취소
            </DialogClose>
            <Button onClick={onSignOutEverywhere} disabled={isPending}>
              {isPending ? "로그아웃 중…" : "모든 기기에서 로그아웃"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
