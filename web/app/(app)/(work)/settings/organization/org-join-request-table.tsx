"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/people/person-avatar";
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
import type { DecideJoinResult, JoinRequestView } from "@/server/join-request";
import type { SolRole } from "@/server/organization";
import { decideJoin } from "./actions";
import { SOL_ROLE_ITEMS, SOL_ROLE_ORDER } from "./org-settings-copy";

// 가입 신청 승인 표(설계 5.1 관리자 승인). 승인할 때 업무 역할을 고르고 기본값은 VIEWER 다(C7).
// 이미 멤버인 계정(U10)은 역할이 바뀌지 않는다 — DB 함수가 멤버십을 그대로 둔다.

const KIND_LABEL = { NEW_HIRE: "신규 입사자", EXISTING: "기존 직원" } as const;

const FAILURE: Record<Exclude<DecideJoinResult["status"], "approved" | "rejected">, string> = {
  forbidden: "권한이 없습니다.",
  "member-taken": "이미 다른 계정과 연결된 직원입니다.",
  "member-left": "퇴사 처리된 직원이라 연결할 수 없습니다.",
  "already-linked": "이미 조직도에 연결된 계정입니다.",
  "already-decided": "이미 처리된 신청입니다.",
  invalid: "요청이 올바르지 않습니다.",
  "signed-out": "로그인이 풀렸습니다. 다시 로그인하세요.",
};

export function OrgJoinRequestTable({ requests }: { requests: JoinRequestView[] }) {
  const [roles, setRoles] = useState<Record<string, SolRole>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onDecide = async (request: JoinRequestView, approve: boolean) => {
    setPendingId(request.id);
    try {
      const result = await decideJoin({
        requestId: request.id,
        approve,
        solRole: roles[request.id] ?? "VIEWER",
      });
      if (result.status === "approved")
        toast.success(`${request.applicantName} 님을 승인했습니다.`);
      else if (result.status === "rejected")
        toast.success(`${request.applicantName} 님의 신청을 반려했습니다.`);
      else toast.error(FAILURE[result.status]);
    } catch {
      toast.error("처리하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="org-join-requests-title">가입 신청</h2>
        </CardTitle>
        <CardDescription>
          승인하면 조직 멤버가 되고 조직도에 나옵니다. 이미 멤버인 계정은 업무 역할이 바뀌지
          않습니다.
        </CardDescription>
        <CardAction>
          <p className="type-label text-muted-foreground tabular-nums">{requests.length}건</p>
        </CardAction>
      </CardHeader>
      {requests.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">대기 중인 가입 신청이 없습니다.</p>
        </CardContent>
      ) : (
        <CardContent className="-mb-4 px-0">
          <Table className="table-fixed">
            <caption className="sr-only">대기 중인 가입 신청 {requests.length}건</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-6">
                  신청자
                </TableHead>
                <TableHead scope="col" className="w-28">
                  종류
                </TableHead>
                <TableHead scope="col" className="w-48">
                  부서·직급
                </TableHead>
                <TableHead scope="col" className="w-36">
                  연결 대상
                </TableHead>
                <TableHead scope="col" className="w-40">
                  업무 역할
                </TableHead>
                <TableHead scope="col" className="w-44 pr-6">
                  <span className="sr-only">동작</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const isPending = pendingId === request.id;
                return (
                  <TableRow key={request.id} className="h-16">
                    <TableCell className="pl-6">
                      <div className="flex min-w-0 items-center gap-3">
                        <PersonAvatar
                          name={request.applicantName}
                          portraitUrl={request.photoUrl}
                          className="size-9"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-foreground" title={request.applicantName}>
                            {request.applicantName}
                          </p>
                          <p
                            className="truncate type-label text-muted-foreground"
                            title={request.applicantEmail}
                          >
                            {request.applicantEmail || "이메일 없음"}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">{KIND_LABEL[request.kind]}</TableCell>
                    <TableCell>
                      <p className="truncate text-foreground">
                        {request.departmentName} · {request.jobTitleLabel}
                      </p>
                    </TableCell>
                    <TableCell>
                      {request.memberName ? (
                        <p className="truncate text-foreground">
                          {request.memberName}{" "}
                          <span className="type-label text-muted-foreground tabular-nums">
                            {request.memberPersonCode}
                          </span>
                        </p>
                      ) : request.memberUnavailable ? (
                        <p className="type-label text-destructive">연결할 수 없는 직원</p>
                      ) : (
                        <p className="type-label text-muted-foreground">새 직원</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        items={SOL_ROLE_ITEMS}
                        value={roles[request.id] ?? "VIEWER"}
                        onValueChange={(value: SolRole | null) => {
                          if (value) setRoles((current) => ({ ...current, [request.id]: value }));
                        }}
                        readOnly={isPending}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-32"
                          aria-label={`${request.applicantName} 승인 업무 역할`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SOL_ROLE_ORDER.map((role) => (
                            <SelectItem key={role} value={role}>
                              {SOL_ROLE_ITEMS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={isPending}
                          focusableWhenDisabled
                          aria-label={`${request.applicantName} 승인`}
                          onClick={() => onDecide(request, true)}
                        >
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          focusableWhenDisabled
                          aria-label={`${request.applicantName} 거절`}
                          onClick={() => onDecide(request, false)}
                        >
                          거절
                        </Button>
                      </div>
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
