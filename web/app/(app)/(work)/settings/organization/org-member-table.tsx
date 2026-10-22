"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOrgDate } from "./org-settings-copy";
import type { OrgMemberView, SolRole } from "@/server/organization";
import { changeSolRole, demoteMySolRole } from "./actions";
import { ErrorParagraph, type ShownError } from "./error-paragraph";
import {
  MEMBERS_COPY,
  roleChangedToast,
  roleChangeFailure,
  selfDemotedToast,
  selfDemoteFailure,
  SOL_ROLE_GUIDE,
  SOL_ROLE_ITEMS,
  SOL_ROLE_ORDER,
  UNKNOWN_FAILURE,
} from "./org-settings-copy";
import { SelfDemoteDialog } from "./self-demote-dialog";

const LAST_ADMIN_HINT_ID = "org-last-admin-hint";

// 다른 사람의 역할은 확인 없이 바로 저장한다(디자인 스펙 D4). 내 행에서 ADMIN 아래로 내릴 때만 확인한다.
// 저장 중에는 고른 값을 보이고(useOptimistic), 실패하면 저장된 값으로 돌아간다(D15).
export function OrgMemberTable({
  members,
  adminCount,
}: {
  members: OrgMemberView[];
  adminCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [savingRoles, setSavingRole] = useOptimistic<
    Readonly<Record<string, SolRole>>,
    { userId: string; role: SolRole }
  >({}, (state, { userId, role }) => ({ ...state, [userId]: role }));
  const [error, setError] = useState<ShownError | null>(null);
  // demoteTo 는 닫힌 뒤에도 남겨 둔다 — 닫히는 애니메이션 동안 글이 사라지지 않게 한다.
  const [demoteTo, setDemoteTo] = useState<SolRole | null>(null);
  const [isDemoteOpen, setIsDemoteOpen] = useState(false);
  const [isDemoting, setIsDemoting] = useState(false);
  const [demoteError, setDemoteError] = useState<ShownError | null>(null);
  const myTriggerRef = useRef<HTMLButtonElement>(null);
  const isLastAdmin = adminCount <= 1;

  const save = (member: OrgMemberView, role: SolRole) => {
    setError(null);
    startTransition(async () => {
      setSavingRole({ userId: member.userId, role });
      try {
        const result = await changeSolRole(member.userId, role);
        if (result.status === "saved") {
          toast.success(roleChangedToast(member.name, member.solRole, role));
          return;
        }
        setError({
          message: roleChangeFailure(member.name, result.status),
          isSignedOut: result.status === "signed-out",
        });
      } catch {
        setError({ message: UNKNOWN_FAILURE, isSignedOut: false });
      }
    });
  };

  const onRoleChange = (member: OrgMemberView, role: SolRole) => {
    if (role === member.solRole) return;
    if (member.isMe && member.solRole === "ADMIN") {
      setError(null);
      setDemoteTo(role);
      setDemoteError(null);
      setIsDemoteOpen(true);
      return;
    }
    save(member, role);
  };

  const onDemote = async () => {
    if (demoteTo === null) return;
    setIsDemoting(true);
    setDemoteError(null);
    try {
      const result = await demoteMySolRole(demoteTo);
      if (result.status === "saved") {
        // 스스로 한 동작 뒤에 403 안내를 보이지 않고 대시보드로 옮긴다(D5).
        toast.success(selfDemotedToast(demoteTo));
        router.replace("/dashboard");
        // 업무 틀(사이드바)은 이동만으로 다시 그려지지 않는다. ADMIN 메뉴를 거두려고 새로 읽는다.
        router.refresh();
        return;
      }
      setDemoteError({
        message: selfDemoteFailure(result.status),
        isSignedOut: result.status === "signed-out",
      });
    } catch {
      setDemoteError({ message: UNKNOWN_FAILURE, isSignedOut: false });
    } finally {
      setIsDemoting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="org-members-title">{MEMBERS_COPY.title}</h2>
        </CardTitle>
        <CardDescription>
          <p>{MEMBERS_COPY.description}</p>
          {isLastAdmin ? (
            <p id={LAST_ADMIN_HINT_ID} className="mt-1 type-label text-muted-foreground">
              {MEMBERS_COPY.lastAdmin}
            </p>
          ) : null}
        </CardDescription>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{members.length}명</p>
        </CardAction>
      </CardHeader>
      {/* 표는 카드 끝까지 닿고 첫·끝 칸 여백을 카드 여백(24px)에 맞춘다. */}
      <CardContent className="px-0">
        {error ? <ErrorParagraph error={error} className="mb-3 px-6" /> : null}
        {/* table-fixed 가 없으면 긴 이름·이메일이 표를 넓혀 말줄임되지 않는다. */}
        <Table className="table-fixed">
          <caption className="sr-only">{MEMBERS_COPY.caption(members.length)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="pl-6">
                이름
              </TableHead>
              <TableHead scope="col">이메일</TableHead>
              <TableHead scope="col" className="w-50">
                업무 역할
              </TableHead>
              <TableHead scope="col" className="w-34 pr-6">
                합류일
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const savingRole = savingRoles[member.userId];
              const isSaving = savingRole !== undefined;
              const isMyLastAdmin = member.isMe && isLastAdmin && member.solRole === "ADMIN";
              return (
                <TableRow key={member.userId} className="h-13">
                  <TableCell className="pl-6">
                    <p className="flex min-w-0 items-baseline gap-1" title={member.name}>
                      <span className="truncate font-medium text-foreground">{member.name}</span>
                      {member.isMe ? (
                        <span className="shrink-0 text-muted-foreground">{MEMBERS_COPY.me}</span>
                      ) : null}
                      {member.isSuspended ? (
                        <span className="shrink-0 type-caption text-muted-foreground">
                          {MEMBERS_COPY.suspended}
                        </span>
                      ) : null}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="truncate text-muted-foreground" title={member.email}>
                      {member.email}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Select
                        items={SOL_ROLE_ITEMS}
                        value={savingRole ?? member.solRole}
                        onValueChange={(value: SolRole | null) => {
                          if (value) onRoleChange(member, value);
                        }}
                        // 비활성(disabled)은 초점을 잃게 해서 저장 중에는 읽기 전용으로 잠근다.
                        readOnly={isSaving}
                      >
                        <SelectTrigger
                          ref={member.isMe ? myTriggerRef : undefined}
                          size="sm"
                          className="w-36"
                          aria-label={`${member.name} 업무 역할`}
                          aria-describedby={isMyLastAdmin ? LAST_ADMIN_HINT_ID : undefined}
                          aria-busy={isSaving || undefined}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SOL_ROLE_ORDER.map((role) => (
                            <SelectItem
                              key={role}
                              value={role}
                              // 마지막 ADMIN 은 자기를 낮출 수 없다(DB 트리거도 막는다, D6).
                              disabled={isMyLastAdmin && role !== "ADMIN"}
                            >
                              {SOL_ROLE_ITEMS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSaving ? (
                        <LoaderCircleIcon
                          aria-hidden
                          className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="pr-6">
                    <time
                      dateTime={member.joinedAt}
                      title={member.joinedAt}
                      className="text-muted-foreground tabular-nums"
                    >
                      {formatOrgDate(member.joinedAt)}
                    </time>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="mt-4 border-t border-border px-6 pt-4">
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-1">
            {SOL_ROLE_GUIDE.map(({ role, text }) => (
              <div key={role} className="contents">
                <dt className="type-label font-medium text-foreground">{role}</dt>
                <dd className="type-label text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CardContent>
      <SelfDemoteDialog
        open={isDemoteOpen}
        role={demoteTo}
        isPending={isDemoting}
        error={demoteError}
        onOpenChange={setIsDemoteOpen}
        onConfirm={onDemote}
        finalFocus={myTriggerRef}
      />
    </Card>
  );
}
