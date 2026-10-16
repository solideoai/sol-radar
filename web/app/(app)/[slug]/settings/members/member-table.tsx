"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { initialOf } from "@/lib/utils";
import type { MemberView, OrgRole } from "@/server/organization";
import { changeRole, remove } from "./actions";
import { membershipFailure, ROLE_LABELS, UNKNOWN_FAILURE } from "./messages";

// 확인 대화상자를 두는 동작: 잃는 것이 있고, 되돌리려면 다른 사람이 다시 해 줘야 하는 것(자기 강등·내보내기).
// 다른 사람의 역할 바꾸기는 바로 저장한다(다시 바꾸면 된다).
type Confirm = { kind: "demote-self" | "remove"; member: MemberView };

export function MemberTable({
  orgId,
  members,
  canManage,
  ownerCount,
}: {
  orgId: string;
  members: MemberView[];
  canManage: boolean;
  ownerCount: number;
}) {
  const router = useRouter();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  // confirm 은 닫힌 뒤에도 남겨 둔다 — 닫히는 애니메이션 동안 글이 사라지지 않게 한다.
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 내보낸 줄은 사라져 눌렀던 버튼으로 돌아갈 수 없다. 성공으로 닫힐 때만 초점을 카드 제목으로 보낸다.
  const isDoneRef = useRef(false);
  const isLastOwner = ownerCount === 1;

  const openConfirm = (next: Confirm) => {
    setConfirm(next);
    setError(null);
    isDoneRef.current = false;
    setIsOpen(true);
  };

  const onRoleChange = async (member: MemberView, role: OrgRole) => {
    if (role === member.role) return;
    if (member.isMe) {
      openConfirm({ kind: "demote-self", member });
      return;
    }
    setSavingUserId(member.userId);
    try {
      const result = await changeRole(orgId, member.userId, role);
      if (result.status === "saved") {
        toast.success(`${member.name} 님의 역할을 ${ROLE_LABELS[role]}로 바꿨습니다`);
        return;
      }
      toast.error(membershipFailure(result.status));
    } catch {
      toast.error(UNKNOWN_FAILURE);
    } finally {
      setSavingUserId(null);
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    setIsPending(true);
    setError(null);
    try {
      const result =
        confirm.kind === "remove"
          ? await remove(orgId, confirm.member.userId)
          : await changeRole(orgId, confirm.member.userId, "member");
      if (result.status !== "saved") {
        setError(membershipFailure(result.status));
        if (result.status === "forbidden") router.refresh();
        return;
      }
      toast.success(
        confirm.kind === "remove"
          ? `${confirm.member.name} 님을 내보냈습니다`
          : "내 역할을 멤버로 바꿨습니다",
      );
      isDoneRef.current = true;
      setIsOpen(false);
    } catch {
      setError(UNKNOWN_FAILURE);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="members-title" ref={headingRef} tabIndex={-1} className="outline-none">
            멤버
          </h2>
        </CardTitle>
        <CardDescription>
          {canManage ? "역할을 바꾸거나 팀에서 내보냅니다." : "초대와 역할 변경은 소유자만 합니다."}
        </CardDescription>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{members.length}명</p>
        </CardAction>
      </CardHeader>
      {/* 표는 카드 끝까지 닿고 첫·끝 칸 여백을 카드 여백(24px)에 맞춘다. */}
      <CardContent className="-mb-4 px-0">
        {/* table-fixed 가 없으면 긴 이름·이메일이 표를 넓혀 말줄임되지 않는다. */}
        <Table className="table-fixed" aria-labelledby="members-title">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">멤버</TableHead>
              <TableHead className={canManage ? "w-20" : "w-20 pr-6"}>역할</TableHead>
              {canManage ? (
                <TableHead className="w-14 pr-6">
                  <span className="sr-only">관리</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="pl-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{initialOf(member.name)}</AvatarFallback>
                    </Avatar>
                    <div className="grid min-w-0">
                      <p className="flex min-w-0 gap-1">
                        <span className="truncate font-medium text-foreground">{member.name}</span>
                        {member.isMe ? (
                          <span className="shrink-0 text-muted-foreground">(나)</span>
                        ) : null}
                      </p>
                      <p
                        className="truncate type-caption text-muted-foreground"
                        title={member.email}
                      >
                        {member.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={canManage ? "text-foreground" : "pr-6 text-foreground"}>
                  {member.roleLabel}
                </TableCell>
                {canManage ? (
                  <TableCell className="pr-6">
                    <MemberMenu
                      member={member}
                      isSaving={savingUserId === member.userId}
                      // 마지막 소유자는 자기를 멤버로 내리지 못한다(DB 트리거도 막는다).
                      canDemoteSelf={!isLastOwner}
                      onRoleChange={(role) => onRoleChange(member, role)}
                      onRemove={() => openConfirm({ kind: "remove", member })}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog
        open={isOpen}
        // 진행 중에는 닫히지 않는다. 중복 요청과 "닫았는데 바뀜"을 같이 막는다.
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => (isDoneRef.current ? headingRef.current : true)}
        >
          {confirm?.kind === "remove" ? (
            <>
              <DialogHeader>
                <DialogTitle>{confirm.member.name} 님을 내보낼까요?</DialogTitle>
                <DialogDescription>
                  이 팀의 작업을 더 볼 수 없습니다. 맡은 작업은 담당자가 비워지고, 만든 작업과 활동
                  기록은 팀에 남습니다. 다시 들어오려면 새로 초대받아야 합니다.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted px-4 py-3 type-label wrap-anywhere">
                <p className="font-medium text-foreground">{confirm.member.name}</p>
                <p className="text-muted-foreground">{confirm.member.email}</p>
              </div>
            </>
          ) : (
            <DialogHeader>
              <DialogTitle>내 역할을 멤버로 바꿀까요?</DialogTitle>
              <DialogDescription>
                멤버가 되면 초대·역할 변경·내보내기를 할 수 없습니다. 다시 소유자가 되려면 다른
                소유자가 바꿔 줘야 합니다.
              </DialogDescription>
            </DialogHeader>
          )}
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isPending} />}>
              취소
            </DialogClose>
            <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
              {confirm?.kind === "remove"
                ? isPending
                  ? "내보내는 중…"
                  : "내보내기"
                : isPending
                  ? "바꾸는 중…"
                  : "멤버로 바꾸기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// 내 줄에는 내보내기가 없다(나가기는 아래 카드에서 한다).
function MemberMenu({
  member,
  isSaving,
  canDemoteSelf,
  onRoleChange,
  onRemove,
}: {
  member: MemberView;
  isSaving: boolean;
  canDemoteSelf: boolean;
  onRoleChange: (role: OrgRole) => void;
  onRemove: () => void;
}) {
  const isDemoteBlocked = member.isMe && member.role === "owner" && !canDemoteSelf;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${member.name} 관리`}
            disabled={isSaving}
            className="text-muted-foreground"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>역할</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={member.role}
            onValueChange={(value: OrgRole) => onRoleChange(value)}
          >
            <DropdownMenuRadioItem value="owner">{ROLE_LABELS.owner}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="member" disabled={isDemoteBlocked}>
              {ROLE_LABELS.member}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {isDemoteBlocked ? (
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              마지막 소유자는 멤버로 바꿀 수 없습니다
            </DropdownMenuLabel>
          ) : null}
        </DropdownMenuGroup>
        {member.isMe ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              내보내기
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
