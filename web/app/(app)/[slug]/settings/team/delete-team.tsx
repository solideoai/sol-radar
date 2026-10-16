"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { remove } from "./actions";

const CONFIRM_ID = "delete-team-confirm";
// 서버(@/server/organization)의 문구와 같다 — 서버 모듈은 브라우저로 가져올 수 없다.
const CONFIRM_EMPTY = "팀 이름을 입력하세요";
const CONFIRM_MISMATCH = "팀 이름이 맞지 않습니다. 위 이름을 그대로 입력해 주세요";
const DELETE_FAILURE = "팀을 지우지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 화면에서 먼저 견준다(서버도 DB 의 지금 이름과 다시 견준다). 앞뒤 공백만 뗀다 — 휴대폰 자동 입력이 끝에 공백을 붙인다.
const confirmErrorOf = (typed: string, teamName: string): string | null => {
  const trimmed = typed.trim();
  if (!trimmed) return CONFIRM_EMPTY;
  return trimmed === teamName ? null : CONFIRM_MISMATCH;
};

// 즉시 삭제라 되돌릴 수 없다. 팀 이름을 직접 입력해야 지운다.
// 확인 버튼은 꺼 두지 않는다("회원 탈퇴"와 같다) — 틀리게 입력하고 누르면 이유를 보이고 입력칸으로 돌아간다.
export function DeleteTeam({
  orgId,
  teamName,
  slug,
  homeHref,
}: {
  orgId: string;
  teamName: string;
  slug: string;
  homeHref: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showConfirmError = (message: string) => {
    setConfirmError(message);
    inputRef.current?.focus();
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = new FormData(event.currentTarget).get("confirm");
    const typed = typeof field === "string" ? field : "";
    const typedError = confirmErrorOf(typed, teamName);
    if (typedError) {
      showConfirmError(typedError);
      return;
    }
    setConfirmError(null);
    setError(null);
    setIsPending(true);
    try {
      const result = await remove(orgId, { confirmName: typed });
      switch (result.status) {
        case "deleted":
          // 이동할 때까지 진행 중 모양으로 둔다. 이 팀의 화면(라우터 캐시)은 버린다.
          toast.success("팀을 지웠습니다");
          router.replace(homeHref);
          router.refresh();
          return;
        case "invalid":
          // 그새 다른 소유자가 이름을 바꿨을 수 있다. 다시 그리면 상자와 비교 대상이 새 이름이 된다.
          setIsPending(false);
          showConfirmError(result.message);
          router.refresh();
          return;
        case "forbidden":
          // 다시 그리면 이 구역이 사라지거나(member) 404 라서 대화상자 안의 오류가 남지 않는다. 토스트로 알린다.
          setIsPending(false);
          setIsOpen(false);
          toast.error("소유자만 팀을 지울 수 있습니다. 화면을 새로 고칩니다.");
          router.refresh();
          return;
        case "signed-out":
          setIsPending(false);
          setError("로그인이 풀렸습니다. 다시 로그인하세요.");
          return;
        case "personal-org":
          setIsPending(false);
          setError(DELETE_FAILURE);
          return;
      }
    } catch {
      setIsPending(false);
      setError(DELETE_FAILURE);
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
        팀 삭제
      </Button>
      <Dialog
        open={isOpen}
        // 진행 중에는 닫히지 않는다. 중복 요청과 "닫았는데 지워짐"을 같이 막는다.
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          {/* 열 때마다 새로 그려져 입력이 비워진다(닫히면 내용이 사라진다). */}
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>팀을 지울까요?</DialogTitle>
              <DialogDescription>지우면 바로 사라지고 되돌릴 수 없습니다.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 type-body text-muted-foreground">
              <ul className="list-disc pl-5">
                <li>팀의 모든 작업과 활동 기록</li>
                <li>모든 멤버의 멤버십과 대기 중인 초대</li>
              </ul>
              <p>멤버 모두 이 팀을 더 볼 수 없습니다. 멤버의 계정과 개인 공간은 그대로 남습니다.</p>
            </div>
            {/* 같은 이름의 팀이 여럿이어도 주소로 가린다. 긴 이름도 줄을 바꿔 끝까지 보인다. */}
            <div className="rounded-lg bg-muted px-4 py-3 type-label wrap-anywhere">
              <p className="font-medium text-foreground">{teamName}</p>
              <p className="font-mono text-muted-foreground">/{slug}</p>
            </div>
            <Field data-invalid={Boolean(confirmError)}>
              <FieldLabel htmlFor={CONFIRM_ID}>
                확인하려면 위 팀 이름을 그대로 입력해 주세요
              </FieldLabel>
              <Input
                ref={inputRef}
                id={CONFIRM_ID}
                name="confirm"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
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
                {isPending ? "지우는 중…" : "팀 삭제"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
