"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOrgDate } from "./org-settings-copy";
import type { OrgInvitationView } from "@/server/organization";
import { cancelOrgInvite } from "./actions";
import { ErrorParagraph, type ShownError } from "./error-paragraph";
import {
  CANCEL_FAILURE,
  cancelFailure,
  cancelledToast,
  INVITATIONS_COPY,
} from "./org-settings-copy";

// 취소한 행은 사라져 눌렀던 단추로 돌아갈 수 없다. 다음 행 → 이전 행 → 카드 제목 순서로 초점을 옮긴다(§4.5).
type FocusAfter = { kind: "row"; id: string } | { kind: "heading" };

const focusAfterRemoving = (invitations: OrgInvitationView[], id: string): FocusAfter => {
  const index = invitations.findIndex((invitation) => invitation.id === id);
  const next = invitations[index + 1] ?? invitations[index - 1];
  return next ? { kind: "row", id: next.id } : { kind: "heading" };
};

// 초대 취소는 확인 없이 바로 한다(D9). 잃는 것이 없고 다시 초대하면 된다.
export function OrgInvitationTable({ invitations }: { invitations: OrgInvitationView[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [focusAfter, setFocusAfter] = useState<FocusAfter | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  // 서버 함수의 refresh() 로 새 목록이 온 뒤에 초점을 옮긴다(그 전에는 지운 행이 아직 있다).
  useEffect(() => {
    if (focusAfter === null) return;
    const target =
      focusAfter.kind === "row" ? buttonRefs.current.get(focusAfter.id) : headingRef.current;
    target?.focus();
  }, [focusAfter, invitations]);

  const onCancel = async (invitation: OrgInvitationView) => {
    setPendingId(invitation.id);
    setError(null);
    setFocusAfter(null);
    try {
      const result = await cancelOrgInvite(invitation.id);
      if (result.status === "done") {
        toast.success(cancelledToast(invitation.email));
        setFocusAfter(focusAfterRemoving(invitations, invitation.id));
        return;
      }
      setError({
        message: cancelFailure(result.status),
        isSignedOut: result.status === "signed-out",
      });
    } catch {
      setError({ message: CANCEL_FAILURE, isSignedOut: false });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2
            id="org-invitations-title"
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {INVITATIONS_COPY.title}
          </h2>
        </CardTitle>
        <CardDescription>{INVITATIONS_COPY.description}</CardDescription>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{invitations.length}건</p>
        </CardAction>
      </CardHeader>
      {invitations.length === 0 ? (
        <CardContent>
          {error ? <ErrorParagraph error={error} className="mb-3" /> : null}
          <p className="type-label text-muted-foreground">{INVITATIONS_COPY.empty}</p>
        </CardContent>
      ) : (
        <CardContent className="-mb-4 px-0">
          {error ? <ErrorParagraph error={error} className="mb-3 px-6" /> : null}
          <Table className="table-fixed">
            <caption className="sr-only">{INVITATIONS_COPY.caption(invitations.length)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-6">
                  이메일
                </TableHead>
                <TableHead scope="col" className="w-30">
                  업무 역할
                </TableHead>
                <TableHead scope="col" className="w-40">
                  만료일
                </TableHead>
                <TableHead scope="col" className="w-34 pr-6">
                  <span className="sr-only">동작</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => {
                const isPending = pendingId === invitation.id;
                return (
                  <TableRow key={invitation.id} className="h-13">
                    <TableCell className="pl-6">
                      <p className="truncate text-foreground" title={invitation.email}>
                        {invitation.email}
                      </p>
                    </TableCell>
                    <TableCell className="text-foreground">{invitation.solRole}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      <time dateTime={invitation.expiresAt} title={invitation.expiresAt}>
                        {invitation.isExpired
                          ? INVITATIONS_COPY.expired
                          : `${formatOrgDate(invitation.expiresAt)}까지`}
                      </time>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button
                        ref={(element) => {
                          if (element) buttonRefs.current.set(invitation.id, element);
                          else buttonRefs.current.delete(invitation.id);
                        }}
                        variant="outline"
                        size="sm"
                        aria-label={`${invitation.email} ${INVITATIONS_COPY.cancel}`}
                        disabled={isPending}
                        focusableWhenDisabled
                        onClick={() => onCancel(invitation)}
                      >
                        {isPending ? INVITATIONS_COPY.cancelling : INVITATIONS_COPY.cancel}
                      </Button>
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
