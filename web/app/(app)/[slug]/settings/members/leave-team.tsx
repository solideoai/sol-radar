"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { leave } from "./actions";
import { membershipFailure, UNKNOWN_FAILURE } from "./messages";

const LEAVE_DESCRIPTION =
  "나가면 이 팀의 작업을 볼 수 없습니다. 내가 맡은 작업은 담당자가 비워지고, 만든 작업과 활동 기록은 팀에 남습니다. 다시 들어오려면 초대를 받아야 합니다.";

// 마지막 소유자는 나가지 못한다(DB 트리거도 막는다).
// 비활성 버튼은 초점을 받지 못하니 이유를 툴팁이 아니라 보이는 글자로 둔다.
export function LeaveTeam({
  orgId,
  orgName,
  homeHref,
  isLastOwner,
  isAlone,
  teamSettingsHref,
}: {
  orgId: string;
  orgName: string;
  homeHref: string;
  isLastOwner: boolean;
  isAlone: boolean;
  teamSettingsHref: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLeave = async () => {
    setIsPending(true);
    setError(null);
    try {
      const result = await leave(orgId);
      if (result.status !== "saved") {
        setError(membershipFailure(result.status));
        setIsPending(false);
        return;
      }
      toast.success(`${orgName}에서 나갔습니다`);
      // 이 팀의 화면은 더 볼 수 없다. 남은 화면(라우터 캐시)을 버린다.
      router.replace(homeHref);
      router.refresh();
    } catch {
      setError(UNKNOWN_FAILURE);
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>팀 나가기</h2>
        </CardTitle>
        <CardDescription>{LEAVE_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLastOwner ? (
          <p id="leave-blocked" className="type-label text-muted-foreground">
            {isAlone ? (
              <>
                팀에 나 혼자라 나갈 수 없습니다. 팀이 더 필요 없으면{" "}
                <Link
                  href={teamSettingsHref}
                  className="rounded-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  팀 설정
                </Link>
                에서 지우세요.
              </>
            ) : (
              "마지막 소유자라 나갈 수 없습니다. 다른 멤버를 소유자로 바꾼 뒤 나가세요."
            )}
          </p>
        ) : null}
        <Button
          variant="destructive"
          disabled={isLastOwner}
          aria-describedby={isLastOwner ? "leave-blocked" : undefined}
          className="w-full sm:w-auto sm:self-start"
          onClick={() => {
            setError(null);
            setIsOpen(true);
          }}
        >
          팀 나가기
        </Button>
      </CardContent>
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">{orgName}에서 나갈까요?</DialogTitle>
            <DialogDescription>{LEAVE_DESCRIPTION}</DialogDescription>
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
            <Button variant="destructive" onClick={onLeave} disabled={isPending}>
              {isPending ? "나가는 중…" : "나가기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
