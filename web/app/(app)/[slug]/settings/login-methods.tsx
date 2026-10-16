"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { unlinkLoginMethod } from "@/app/account/actions";
import { ProviderMark } from "@/components/provider-mark";
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
import { SUPABASE_PROVIDER_ID, type SocialProvider } from "@/lib/auth-providers";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { LinkOutcome, UnlinkResult } from "@/server/auth";

// 한 줄 = 연결된 로그인 수단 하나, 또는 켜 둔 제공자 가운데 아직 연결하지 않은 것 하나. 순서는 화면(page.tsx)이 정한다.
export type LoginMethodRow = {
  key: string;
  provider: string;
  label: string;
  // 연결된 줄은 그 계정의 이메일이나 연결한 날, 아닌 줄은 "연결되지 않음".
  detail: string;
  email: string | null;
  // 연결되지 않은 줄이면 null 이고 linkProvider 가 있다.
  identityId: string | null;
  linkProvider: SocialProvider | null;
};

// 구역 제목(page.tsx 의 h2)의 id. 해제·연결 뒤 초점을 그리로 돌린다(누른 줄의 버튼이 사라질 수 있다).
export const LOGIN_METHODS_HEADING_ID = "settings-login-methods";
const focusHeading = () => document.getElementById(LOGIN_METHODS_HEADING_ID);

const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

const OUTCOME_NOTICES: Record<Exclude<LinkOutcome, "linked">, string> = {
  identity_already_exists:
    "연결하려는 계정은 이미 다른 회원의 로그인 수단이라 연결하지 못했습니다. 그 회원 계정에서 연결을 해제하거나 탈퇴한 뒤 다시 시도해 주세요.",
  manual_linking_disabled:
    "지금은 로그인 수단을 연결할 수 없습니다. 운영자가 Supabase 대시보드의 Authentication → Sign In / Providers 에서 “Allow manual linking”을 켜야 합니다.",
  failed: "로그인 수단을 연결하지 못했습니다. 다시 시도해 주세요.",
};

const unlinkFailure = (status: Exclude<UnlinkResult["status"], "unlinked">): string => {
  switch (status) {
    case "last-method":
      return "로그인 수단이 하나만 남아 해제할 수 없습니다. 화면을 새로 고칩니다.";
    case "not-found":
      return "이미 해제된 로그인 수단입니다. 화면을 새로 고칩니다.";
    case "signed-out":
      return "로그인이 풀렸습니다. 다시 로그인하세요.";
    case "invalid":
      return UNKNOWN_FAILURE;
  }
};

export function LoginMethods({
  rows,
  canUnlink,
  settingsPath,
  outcome,
}: {
  rows: LoginMethodRow[];
  canUnlink: boolean;
  settingsPath: string;
  // 연결하러 갔다 돌아온 결과(?link=…). 화면이 한 번 알리고 주소에서 지운다.
  outcome: LinkOutcome | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const isDoneRef = useRef(false);
  // 개발 모드(StrictMode)는 효과를 두 번 돌린다. 알림은 한 번만 한다.
  const announcedRef = useRef(false);
  // 돌아온 결과는 처음 그릴 때의 값으로만 정한다. 주소에서 link 를 지워도 안내 글자는 남는다.
  const [returnedNotice] = useState(() =>
    outcome && outcome !== "linked" ? OUTCOME_NOTICES[outcome] : null,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [linking, setLinking] = useState<SocialProvider | null>(null);
  const [confirm, setConfirm] = useState<LoginMethodRow | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 새로 고쳐도 다시 나오지 않게 주소에서 link 를 지운다. 지우고 다시 그려지면 outcome 이 null 이라 돌지 않는다.
  useEffect(() => {
    if (!outcome || announcedRef.current) return;
    announcedRef.current = true;
    if (outcome === "linked") {
      toast.success("로그인 수단을 연결했습니다");
      focusHeading()?.focus();
    } else {
      noticeRef.current?.focus();
    }
    router.replace(pathname, { scroll: false });
  }, [outcome, pathname, router]);

  const linkedRows = rows.filter((row) => row.identityId !== null);
  const canLinkMore = rows.some((row) => row.linkProvider !== null);

  const onLink = async (provider: SocialProvider, label: string) => {
    setLinking(provider);
    setStartError(null);
    const next = encodeURIComponent(settingsPath);
    const { error: linkError } = await getSupabaseBrowser().auth.linkIdentity({
      provider: SUPABASE_PROVIDER_ID[provider],
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}&flow=link` },
    });
    // 성공하면 브라우저가 그 회사로 넘어가 이 화면에 돌아오지 않는다. 버튼은 꺼진 채로 둔다.
    if (linkError) {
      setStartError(
        linkError.code === "manual_linking_disabled"
          ? OUTCOME_NOTICES.manual_linking_disabled
          : `${label} 연결을 시작하지 못했습니다: ${linkError.message}`,
      );
      setLinking(null);
    }
  };

  const openConfirm = (row: LoginMethodRow) => {
    setConfirm(row);
    setError(null);
    isDoneRef.current = false;
    setIsOpen(true);
  };

  const onUnlink = async () => {
    if (!confirm?.identityId) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await unlinkLoginMethod(confirm.identityId);
      setIsPending(false);
      if (result.status !== "unlinked") {
        setError(unlinkFailure(result.status));
        return;
      }
      toast.success(`${confirm.label} 연결을 해제했습니다`);
      // 누른 줄의 버튼이 사라질 수 있으니 구역 제목으로 초점을 돌린다.
      isDoneRef.current = true;
      setIsOpen(false);
    } catch {
      setError(UNKNOWN_FAILURE);
      setIsPending(false);
    }
  };

  const remaining = confirm
    ? linkedRows.filter((row) => row.key !== confirm.key).map((row) => row.label)
    : [];
  const notice = startError ?? returnedNotice;

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          ref={noticeRef}
          id="login-methods-notice"
          tabIndex={-1}
          // 화면 안에서 생긴 오류만 바로 읽힌다. 돌아온 안내는 초점을 받아 읽힌다(두 번 읽지 않게).
          role={startError ? "alert" : undefined}
          className="type-label wrap-anywhere text-destructive outline-none"
        >
          {notice}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-4 py-3">
            <ProviderMark provider={row.provider} />
            <div className="grid min-w-0 flex-1">
              <span className="type-body font-medium text-foreground">{row.label}</span>
              <span className="truncate type-caption text-muted-foreground" title={row.detail}>
                {row.detail}
              </span>
            </div>
            {row.linkProvider ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={`${row.label} 연결`}
                disabled={linking !== null}
                onClick={() => {
                  if (row.linkProvider) void onLink(row.linkProvider, row.label);
                }}
              >
                {linking === row.linkProvider ? "연결 중…" : "연결"}
              </Button>
            ) : canUnlink ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={`${row.label} 연결 해제`}
                onClick={() => openConfirm(row)}
              >
                해제
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {/* 비활성 버튼은 초점을 받지 못하니 버튼을 두지 않고 이유를 글자로 둔다. 서버도 마지막 하나는 거절한다. */}
      {canUnlink ? null : (
        <p className="type-label text-muted-foreground">
          로그인 수단이 하나뿐이라 해제할 수 없습니다.
          {canLinkMore ? " 다른 수단을 연결하면 해제할 수 있습니다." : ""}
        </p>
      )}
      <Dialog
        open={isOpen}
        // 진행 중에는 닫히지 않는다. 중복 요청과 "닫았는데 바뀜"을 같이 막는다.
        onOpenChange={(next) => {
          if (!isPending) setIsOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => (isDoneRef.current ? focusHeading() : true)}
        >
          {confirm ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.provider === "email"
                    ? "이메일 로그인을 해제할까요?"
                    : `${confirm.label} 연결을 해제할까요?`}
                </DialogTitle>
                <DialogDescription className="wrap-anywhere">
                  {confirm.provider === "email"
                    ? "해제하면 이메일과 비밀번호로 로그인할 수 없고, 이 화면에서 다시 더할 수 없습니다."
                    : `해제하면 이 ${confirm.label} 계정${confirm.email ? `(${confirm.email})` : ""}으로 로그인할 수 없습니다. 다시 연결하면 되돌릴 수 있습니다.`}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted px-4 py-3 type-label wrap-anywhere">
                <p className="text-muted-foreground">남은 로그인 수단</p>
                <p className="font-medium text-foreground">{remaining.join(" · ")}</p>
              </div>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isPending} />}>
              취소
            </DialogClose>
            <Button variant="destructive" onClick={onUnlink} disabled={isPending}>
              {isPending ? "해제하는 중…" : "해제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
