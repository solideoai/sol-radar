"use client";

import { useRef } from "react";
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
import type { SolRole } from "@/server/organization";
import { ErrorParagraph, type ShownError } from "./error-paragraph";
import { SELF_DEMOTE_COPY } from "./org-settings-copy";

// 자기 강등 확인(디자인 스펙 §4.8, D4·D5). 잃는 것이 있고 되돌리려면 다른 ADMIN 이 바꿔 줘야 해서 확인을 받는다.
// 상태(열림·진행·오류)는 구성원 표가 갖는다. 이 부품은 그리기만 한다.
export function SelfDemoteDialog({
  open,
  role,
  isPending,
  error,
  onOpenChange,
  onConfirm,
  finalFocus,
}: {
  open: boolean;
  // 닫힌 뒤에도 마지막 역할을 받는다 — 닫히는 동안 글이 사라지지 않게 한다.
  role: SolRole | null;
  isPending: boolean;
  error: ShownError | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  finalFocus: React.RefObject<HTMLElement | null>;
}) {
  // 처음 초점은 [취소]다. 되돌리기 어려운 쪽이 기본이 아니게 한다.
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      // 진행 중에는 닫히지 않는다. 중복 요청과 "닫았는데 바뀜"을 같이 막는다.
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} initialFocus={cancelRef} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{role ? SELF_DEMOTE_COPY.title(role) : null}</DialogTitle>
          <DialogDescription>{SELF_DEMOTE_COPY.description}</DialogDescription>
        </DialogHeader>
        {error ? <ErrorParagraph error={error} /> : null}
        <DialogFooter>
          <DialogClose
            render={
              <Button
                ref={cancelRef}
                variant="outline"
                disabled={isPending}
                focusableWhenDisabled
              />
            }
          >
            {SELF_DEMOTE_COPY.cancel}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            focusableWhenDisabled
          >
            {isPending ? SELF_DEMOTE_COPY.pending : role ? SELF_DEMOTE_COPY.confirm(role) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
