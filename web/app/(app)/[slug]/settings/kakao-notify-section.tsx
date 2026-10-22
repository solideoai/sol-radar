"use client";

import { cn } from "cn";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import type { KakaoConnectOutcome, KakaoNotifyView } from "@/server/kakao-notify";

// 개인 설정 "카카오톡 알림" 칸(설계 §9, 계획 Task 7). 상태 넷: 연결 전·연결됨 꺼짐·켜짐·연결 만료.
// 연결은 페이지 이동(GET /api/v1/me/kakao-notify/connect)이고, 켬·끔·해제·시험은 같은 경로의 PATCH·DELETE·POST 다.
// 바꾼 뒤에는 서버 화면을 다시 읽어(router.refresh) 상태를 서버 값으로만 보인다 — 화면이 상태를 지어내지 않는다.

const API = "/api/v1/me/kakao-notify";
const CONNECT_HREF = `${API}/connect`;
const REQUEST_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "sol-radar" };
/** 시험 메시지는 worker 가 보낸다. 그 결과(마지막 발송)를 한 번 다시 읽을 때까지 기다리는 시간. */
const TEST_RESULT_REFRESH_MS = 5000;

export const KAKAO_NOTIFY_HEADING_ID = "settings-kakao-notify";
const TOGGLE_ID = "kakao-notify-enabled";

const NOT_CONNECTED_HINT =
  "카카오 계정을 먼저 연결해야 켤 수 있습니다. 연결할 때 카카오 화면에서 '카카오톡 메시지 전송' 동의를 한 번 묻습니다.";
const EXPIRED_WARNING =
  "카카오 연결이 만료되어 보내지 못하고 있습니다. 앱 안 알림으로도 알려 드립니다.";
const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

const OUTCOME_NOTICES: Record<Exclude<KakaoConnectOutcome, "connected">, string> = {
  consent_denied: "메시지 전송에 동의해야 켤 수 있습니다.",
  state_mismatch: "연결 요청이 만료되었거나 올바르지 않습니다. 다시 연결해 주세요.",
  failed: "카카오톡 알림을 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
};

const RESULT_LABELS: Record<NonNullable<KakaoNotifyView["lastResult"]>, string> = {
  SENT: "보냄",
  FAILED: "보내지 못함",
  EXPIRED: "연결 만료",
};

const seoulDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 서울 시각 MM-DD HH:mm. 읽을 수 없는 값이면 null. */
function formatSeoul(iso: string): string | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = seoulDateTime.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("month")}-${read("day")} ${read("hour")}:${read("minute")}`;
}

function lastSentLine(view: KakaoNotifyView): string {
  const at = view.lastSentAt === null ? null : formatSeoul(view.lastSentAt);
  if (at === null) return "마지막 발송: 아직 없음";
  return view.lastResult === null
    ? `마지막 발송: ${at}`
    : `마지막 발송: ${at} · ${RESULT_LABELS[view.lastResult]}`;
}

/** 응답의 오류 문구. 봉투({ error: { message } })가 아니면 기본 문구. */
async function errorMessageOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null && "message" in error) {
      return typeof error.message === "string" ? error.message : UNKNOWN_FAILURE;
    }
  }
  return UNKNOWN_FAILURE;
}

// 카카오 버튼 색은 로그인 버튼과 같은 가이드 지정 노랑이다(design/tokens.json kakao). 이동이라 <a> 다.
const kakaoLinkClass = cn(
  buttonVariants({ size: "sm" }),
  "self-start bg-kakao text-kakao-foreground/85 hover:bg-kakao/90",
);

export function KakaoNotifySection({
  view,
  outcome,
}: {
  view: KakaoNotifyView;
  // 연결하러 갔다 돌아온 결과(?kakao=…). 화면이 한 번 알리고 주소에서 지운다.
  outcome: KakaoConnectOutcome | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // 개발 모드(StrictMode)는 효과를 두 번 돌린다. 알림은 한 번만 한다.
  const announcedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 돌아온 결과는 처음 그릴 때의 값으로만 정한다. 주소에서 kakao 를 지워도 안내 글자는 남는다.
  const [returnedNotice] = useState(() =>
    outcome && outcome !== "connected" ? OUTCOME_NOTICES[outcome] : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"toggle" | "disconnect" | "test" | null>(null);

  useEffect(() => {
    if (!outcome || announcedRef.current) return;
    announcedRef.current = true;
    if (outcome === "connected") {
      toast.success("카카오톡 알림을 연결했습니다. 시험 메시지로 받아 보세요.");
    } else {
      noticeRef.current?.focus();
    }
    router.replace(pathname, { scroll: false });
  }, [outcome, pathname, router]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const send = async (
    kind: "toggle" | "disconnect" | "test",
    init: RequestInit,
    path = API,
  ): Promise<Response | null> => {
    setPending(kind);
    setError(null);
    try {
      const response = await fetch(path, { ...init, headers: REQUEST_HEADERS });
      if (!response.ok) setError(await errorMessageOf(response));
      return response;
    } catch {
      setError(UNKNOWN_FAILURE);
      return null;
    } finally {
      setPending(null);
    }
  };

  const onToggle = async (enabled: boolean) => {
    const response = await send("toggle", { method: "PATCH", body: JSON.stringify({ enabled }) });
    if (response?.ok) {
      toast.success(enabled ? "카카오톡 알림을 켰습니다" : "카카오톡 알림을 껐습니다");
    }
    // 실패해도 다시 읽는다 — 스위치가 서버 값으로 돌아간다.
    router.refresh();
  };

  const onDisconnect = async () => {
    const response = await send("disconnect", { method: "DELETE" });
    if (response?.ok) toast.success("카카오톡 알림 연결을 해제했습니다");
    router.refresh();
  };

  const onTest = async () => {
    const response = await send("test", { method: "POST" }, `${API}/test`);
    if (!response?.ok) return;
    toast.success("시험 메시지를 보냈습니다. 잠시 뒤 카카오톡을 확인하세요.");
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => router.refresh(), TEST_RESULT_REFRESH_MS);
  };

  const isConnected = view.state !== "DISCONNECTED";
  const isChecked = view.state === "ON" || view.state === "EXPIRED";
  const notice = error ?? returnedNotice;
  // 연결됨·꺼짐과 연결 만료에서 보인다. 만료에서 다시 연결하지 않을 사람도 저장된 토큰을 지울 수 있게 한다.
  const disconnectButton = (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      disabled={pending !== null}
      onClick={() => void onDisconnect()}
    >
      {pending === "disconnect" ? "해제하는 중…" : "연결 해제"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          ref={noticeRef}
          tabIndex={-1}
          // 화면 안에서 생긴 오류만 바로 읽힌다. 돌아온 안내는 초점을 받아 읽힌다(두 번 읽지 않게).
          role={error ? "alert" : undefined}
          className="type-label wrap-anywhere text-destructive outline-none"
        >
          {notice}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            id={TOGGLE_ID}
            type="checkbox"
            role="switch"
            className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
            checked={isChecked}
            disabled={!isConnected || pending !== null}
            aria-describedby={`${TOGGLE_ID}-state`}
            onChange={(event) => void onToggle(event.target.checked)}
          />
          <label htmlFor={TOGGLE_ID} className="type-body font-medium text-foreground">
            카카오톡 알림 받기
          </label>
        </div>
        <p id={`${TOGGLE_ID}-state`} className="type-label text-muted-foreground">
          {view.state === "DISCONNECTED" ? NOT_CONNECTED_HINT : null}
          {view.state === "OFF" ? "연결되어 있고 꺼져 있습니다. 켜면 바로 받습니다." : null}
          {view.state === "ON" ? lastSentLine(view) : null}
          {view.state === "EXPIRED" ? (
            <span className="text-warning">{EXPIRED_WARNING}</span>
          ) : null}
        </p>
        {view.state === "DISCONNECTED" ? (
          <a href={CONNECT_HREF} className={kakaoLinkClass}>
            카카오톡 알림 연결
          </a>
        ) : null}
        {view.state === "OFF" ? disconnectButton : null}
        {view.state === "ON" ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={pending !== null}
            onClick={() => void onTest()}
          >
            {pending === "test" ? "보내는 중…" : "시험 메시지 보내기"}
          </Button>
        ) : null}
        {view.state === "EXPIRED" ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={CONNECT_HREF} className={kakaoLinkClass}>
              다시 연결
            </a>
            {disconnectButton}
          </div>
        ) : null}
      </div>
    </div>
  );
}
