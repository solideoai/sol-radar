"use client";

import { MoreHorizontalIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import type { InvitationView } from "@/server/organization";
import { cancel, invite } from "./actions";
import { showInviteToast, UNKNOWN_FAILURE } from "./messages";

// owner 에게만 보인다(DB 정책도 owner 에게만 연다).
// 다시 초대(기한 갱신)와 초대 취소에는 확인을 두지 않는다. 잃는 것이 없고 다시 하면 된다.
export function InvitationTable({
  orgId,
  invitations,
}: {
  orgId: string;
  invitations: InvitationView[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const run = async (invitation: InvitationView, action: () => Promise<string | null>) => {
    setPendingId(invitation.id);
    try {
      const failure = await action();
      if (failure) toast.error(failure);
    } catch {
      toast.error(UNKNOWN_FAILURE);
    } finally {
      setPendingId(null);
    }
  };

  const renew = (invitation: InvitationView) =>
    run(invitation, async () => {
      const result = await invite(orgId, { email: invitation.email, role: invitation.role });
      switch (result.status) {
        case "invited":
        case "renewed":
          showInviteToast(invitation.email, result);
          return null;
        case "invalid":
          return result.message;
        case "forbidden":
          router.refresh();
          return "소유자만 초대할 수 있습니다. 화면을 새로 고칩니다.";
        case "signed-out":
          return "로그인이 풀렸습니다. 다시 로그인하세요.";
      }
    });

  const remove = (invitation: InvitationView) =>
    run(invitation, async () => {
      const result = await cancel(invitation.id);
      if (result.status === "signed-out") return "로그인이 풀렸습니다. 다시 로그인하세요.";
      toast.success(`${invitation.email} 초대를 취소했습니다`);
      return null;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="invitations-title">대기 중인 초대</h2>
        </CardTitle>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{invitations.length}개</p>
        </CardAction>
      </CardHeader>
      {invitations.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">대기 중인 초대가 없습니다.</p>
        </CardContent>
      ) : (
        // 칸을 숨길지는 화면 폭이 아니라 카드의 폭으로 정한다.
        <CardContent className="@container -mb-4 px-0">
          <Table
            className="table-fixed"
            containerClassName="rounded-none border-0"
            aria-labelledby="invitations-title"
          >
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">이메일</TableHead>
                <TableHead className="hidden w-20 @lg:table-cell">역할</TableHead>
                <TableHead className="hidden w-32 @lg:table-cell">기한</TableHead>
                <TableHead className="w-14 pr-6">
                  <span className="sr-only">관리</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => {
                const due = invitation.isExpired ? "만료됨" : `${invitation.expiresAtText}까지`;
                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="pl-6">
                      <p className="truncate text-foreground" title={invitation.email}>
                        {invitation.email}
                      </p>
                      <p className="truncate type-caption text-muted-foreground @lg:hidden">
                        {invitation.roleLabel} · {due}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-foreground @lg:table-cell">
                      {invitation.roleLabel}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums @lg:table-cell">
                      <time dateTime={invitation.expiresAt}>{due}</time>
                    </TableCell>
                    <TableCell className="pr-6">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${invitation.email} 초대 관리`}
                              disabled={pendingId === invitation.id}
                              className="text-muted-foreground"
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => renew(invitation)}>
                            <RotateCwIcon />
                            다시 초대
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => remove(invitation)}
                          >
                            <XIcon />
                            초대 취소
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
