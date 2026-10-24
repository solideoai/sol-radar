"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveMyPhotoAction } from "@/app/account/actions";
import { PersonAvatar } from "@/components/people/person-avatar";
import { PhotoPicker } from "@/components/photo/photo-picker";
import { Button } from "@/components/ui/button";
import type { MyJoinRequest, SubmitJoinResult } from "@/server/join-request";
import { submitJoin } from "./actions";

// 조직이 없는 계정의 가입 신청(설계 5.1). 사진은 선택이고(C4) 신청 전·대기 중 언제든 바꾼다.
// 관리자가 승인하면 멤버십과 조직도 행이 생기고, 이 화면은 업무 화면으로 옮겨 간다.

const FAILURE: Record<Exclude<SubmitJoinResult["status"], "submitted">, string> = {
  "already-linked": "이미 조직도에 연결된 계정입니다.",
  "invalid-member": "찾을 수 없는 직원입니다. 부서와 이름을 다시 확인해 주세요.",
  "profile-incomplete": "이름·부서·직급을 먼저 입력해 주세요.",
  invalid: "신청 내용이 올바르지 않습니다.",
  "signed-out": "로그인이 풀렸습니다. 다시 로그인하세요.",
};

export function JoinRequestPanel({
  userId,
  name,
  employment,
  avatarUrl,
  hasOwnPhoto,
  request,
}: {
  userId: string;
  name: string;
  employment: string | null;
  avatarUrl: string | null;
  hasOwnPhoto: boolean;
  request: Exclude<MyJoinRequest, { status: "signed-out" }>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = request.status === "pending";

  const onSubmit = async () => {
    setBusy(true);
    try {
      const result = await submitJoin({ kind: "NEW_HIRE" });
      if (result.status === "submitted") toast.success("가입 신청을 보냈습니다.");
      else toast.error(FAILURE[result.status]);
    } catch {
      toast.error("가입 신청을 보내지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="join-request-title" className="flex flex-col gap-4">
      <h2 id="join-request-title" className="sr-only">
        가입 신청 내용
      </h2>
      <div className="flex items-center gap-4">
        <PersonAvatar name={name} portraitUrl={avatarUrl} className="size-16" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate type-body font-medium text-foreground">{name}</p>
          {employment ? (
            <p className="truncate type-label text-muted-foreground">{employment}</p>
          ) : null}
          <PhotoPicker
            objectPrefix={`users/${userId}`}
            hasPhoto={hasOwnPhoto}
            save={saveMyPhotoAction}
            subject="내 사진"
          />
        </div>
      </div>
      <p className="type-label text-muted-foreground">
        사진은 선택입니다. 승인되면 이 사진이 조직도에 보입니다.
      </p>
      {pending ? (
        <p role="status" className="type-body text-foreground">
          신규 입사자로 신청했습니다. 관리자가 승인하면 조직도와 업무 화면이 열립니다.
        </p>
      ) : (
        <Button onClick={onSubmit} disabled={busy} focusableWhenDisabled>
          {busy ? "보내는 중…" : request.status === "rejected" ? "다시 신청하기" : "가입 신청"}
        </Button>
      )}
    </section>
  );
}
