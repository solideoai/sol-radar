"use client";

import { MailIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ReceivedInvitationView } from "@/server/organization";
import { accept, decline } from "./actions";

const SIGNED_OUT = "로그인이 풀렸습니다. 다시 로그인하세요.";
const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

// 줄마다 같은 버튼이 되풀이되므로 남색 주요 버튼을 쓰지 않는다(주요 버튼은 화면에 하나).
// 거절에는 확인을 두지 않는다. 잃는 것이 없다.
export function InvitationList({
  invitations,
  email,
}: {
  invitations: ReceivedInvitationView[];
  email: string;
}) {
  // 만료 전 초대(기한 가까운 순) → 만료된 초대.
  const sorted = invitations.toSorted((a, b) =>
    a.isExpired === b.isExpired ? a.expiresAt.localeCompare(b.expiresAt) : a.isExpired ? 1 : -1,
  );
  // 거절한 줄은 눌렀던 버튼과 함께 사라진다. 그 자리의 다음 줄(없으면 빈 상태 문단)로 초점을 옮긴다.
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const declinedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const index = declinedAtRef.current;
    if (index === null) return;
    declinedAtRef.current = null;
    const rows = Array.from(listRef.current?.children ?? []);
    // 만료된 줄은 수락이 꺼져 있어 거절 버튼으로 간다.
    const row = rows[Math.min(index, rows.length - 1)];
    const target =
      row?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? emptyRef.current;
    target?.focus();
  }, [sorted.length]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <MailIcon className="size-5" />
        </span>
        <div>
          <p
            ref={emptyRef}
            tabIndex={-1}
            className="type-body font-semibold text-foreground outline-none"
          >
            받은 초대가 없습니다
          </p>
          <p className="mt-1 type-label wrap-anywhere text-muted-foreground">
            초대는 {email} 으로 받아야 여기에 보입니다. 다른 이메일로 초대받았다면 그 계정으로
            로그인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul ref={listRef} className="divide-y divide-border border-y border-border">
      {sorted.map((invitation, index) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          onDeclined={() => {
            declinedAtRef.current = index;
          }}
        />
      ))}
    </ul>
  );
}

function InvitationRow({
  invitation,
  onDeclined,
}: {
  invitation: ReceivedInvitationView;
  onDeclined: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hintId = `invitation-${invitation.id}-hint`;

  const onAccept = async () => {
    setPending("accept");
    setError(null);
    try {
      const result = await accept(invitation.id);
      switch (result.status) {
        case "accepted":
          toast.success(`${invitation.orgName}에 들어왔습니다`);
          router.push(`/${result.slug}/dashboard`);
          return;
        case "unavailable":
          setError("초대가 만료됐거나 취소됐습니다. 초대한 사람에게 다시 초대해 달라고 하세요.");
          break;
        case "signed-out":
          setError(SIGNED_OUT);
          break;
      }
    } catch {
      setError(UNKNOWN_FAILURE);
    }
    setPending(null);
  };

  const onDecline = async () => {
    setPending("decline");
    setError(null);
    try {
      const result = await decline(invitation.id);
      if (result.status === "signed-out") {
        setError(SIGNED_OUT);
        setPending(null);
        return;
      }
      onDeclined();
      toast.success(`${invitation.orgName} 초대를 거절했습니다`);
    } catch {
      setError(UNKNOWN_FAILURE);
      setPending(null);
    }
  };

  return (
    <li className="flex flex-col gap-1 py-4">
      {/* 조직 이름은 핵심 정보라 말줄임하지 않고 줄을 바꾼다. */}
      <h2 className="type-heading wrap-anywhere text-foreground">{invitation.orgName}</h2>
      <p className="type-label text-muted-foreground">{invitation.roleLabel}로 초대받았습니다.</p>
      {invitation.isExpired ? (
        <p id={hintId} className="type-caption text-muted-foreground">
          만료됨 · 만료된 초대는 수락할 수 없습니다. 다시 초대해 달라고 하세요.
        </p>
      ) : (
        <p className="type-caption text-muted-foreground">
          <time dateTime={invitation.expiresAt}>{invitation.expiresAtText}</time>까지
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onAccept}
          disabled={pending !== null || invitation.isExpired}
          aria-describedby={invitation.isExpired ? hintId : undefined}
        >
          {pending === "accept" ? "수락 중…" : "수락"}
          <span className="sr-only"> {invitation.orgName} 초대</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onDecline} disabled={pending !== null}>
          {pending === "decline" ? "거절 중…" : "거절"}
          <span className="sr-only"> {invitation.orgName} 초대</span>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 type-label text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
