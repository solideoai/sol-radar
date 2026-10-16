"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { deleteAccount } from "@/app/account/actions";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { DeleteAccountResult } from "@/server/profile";

const CONFIRM_WORD = "탈퇴";
const CONFIRM_ID = "delete-account-confirm";
const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

const deleteFailure = (status: Exclude<DeleteAccountResult["status"], "deleted">): string => {
  switch (status) {
    case "sole-owner":
      return "다른 멤버가 있는 팀의 유일한 소유자라 탈퇴할 수 없습니다. 그 팀 설정의 멤버 화면에서 다른 멤버를 소유자로 바꾸거나 팀을 나간 뒤 다시 시도해 주세요.";
    case "suspended":
      return "정지된 계정이라 탈퇴할 수 없습니다.";
    case "signed-out":
      return "로그인이 풀렸습니다. 다시 로그인하세요.";
  }
};

// 즉시 삭제라 되돌릴 수 없다. 확인 낱말을 직접 입력해야 지운다(이메일은 없는 계정이 있어 고정 낱말이다).
// 확인 버튼은 꺼 두지 않는다 — 틀리게 입력하고 누르면 이유를 보이고 입력칸으로 돌아간다.
export function DeleteAccount() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get("confirm");
    if (typeof typed !== "string" || typed.trim() !== CONFIRM_WORD) {
      setConfirmError(`‘${CONFIRM_WORD}’를 그대로 입력해 주세요`);
      inputRef.current?.focus();
      return;
    }
    setConfirmError(null);
    setError(null);
    setIsPending(true);
    try {
      const result = await deleteAccount();
      if (result.status !== "deleted") {
        setError(deleteFailure(result.status));
        setIsPending(false);
        if (result.status === "suspended") router.refresh();
        return;
      }
      // 계정은 지워졌다. 이 브라우저에 남은 로그인 쿠키를 지운다(Auth 가 401·404 를 돌려줘도 쿠키는 지운다).
      await getSupabaseBrowser().auth.signOut({ scope: "local" });
      toast.success("탈퇴했습니다. 그동안 이용해 주셔서 감사합니다");
      router.replace("/");
      router.refresh();
    } catch {
      setError(UNKNOWN_FAILURE);
      setIsPending(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        className="w-full sm:w-auto sm:self-start"
        onClick={() => {
          setConfirmError(null);
          setError(null);
          setIsOpen(true);
        }}
      >
        회원 탈퇴
      </Button>
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          {/* 열 때마다 새로 그려져 입력이 비워진다(닫히면 내용이 사라진다). */}
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>회원 탈퇴할까요?</DialogTitle>
              <DialogDescription>탈퇴하면 바로 지워지고 되돌릴 수 없습니다.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 type-body text-muted-foreground">
              <ul className="list-disc pl-5">
                <li>프로필과 연결한 로그인 수단, 모든 기기의 로그인</li>
                <li>개인 공간과 나 혼자인 팀, 그 안의 작업</li>
              </ul>
              <p>
                다른 멤버가 있는 팀에서 만든 작업은 팀에 남고 만든 사람만 비워집니다. 같은 로그인
                수단으로 다시 가입하면 새 계정이 됩니다.
              </p>
            </div>
            <Field data-invalid={Boolean(confirmError)}>
              <FieldLabel htmlFor={CONFIRM_ID}>
                확인하려면 ‘{CONFIRM_WORD}’를 입력해 주세요
              </FieldLabel>
              <Input
                ref={inputRef}
                id={CONFIRM_ID}
                name="confirm"
                autoComplete="off"
                spellCheck={false}
                readOnly={isPending}
                aria-invalid={Boolean(confirmError)}
              />
              <FieldError>{confirmError}</FieldError>
            </Field>
            {error ? (
              <p role="alert" className="type-label text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={isPending} />}>
                취소
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={isPending}>
                {isPending ? "탈퇴하는 중…" : "탈퇴"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
