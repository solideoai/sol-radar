"use client";

import { cn } from "cn";
import { CalendarPlusIcon, ExternalLinkIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  GOOGLE_CALENDAR_HOME,
  GOOGLE_CONNECT_NOTICES,
} from "@/app/(app)/(work)/calendar/calendar-copy";
import { googleConnectHref } from "@/app/(app)/(work)/calendar/google-connect";
import type { GoogleCalendarView, GoogleConnectOutcome } from "@/server/google-calendar";

// 개인 설정 "구글 캘린더" 칸(ADR-073). 상태 셋: 연결 전·연결됨·연결 만료.
// 연결은 페이지 이동(GET /api/v1/me/google-calendar/connect?next=<설정 경로>)이고, 해제는 같은 경로의 DELETE 다.
// 일정을 넣는 버튼은 입찰 일정 화면(/calendar)에 있다. 여기서는 연결만 다룬다.
// 바꾼 뒤에는 서버 화면을 다시 읽어(router.refresh) 상태를 서버 값으로만 보인다 — 화면이 상태를 지어내지 않는다.

const API = "/api/v1/me/google-calendar";
const REQUEST_HEADERS = { "X-Requested-With": "sol-radar" };

export const GOOGLE_CALENDAR_HEADING_ID = "settings-google-calendar";

const NOT_CONNECTED_HINT =
  "구글 계정을 연결하면 입찰 일정 화면에서 이 달 일정을 내 구글 캘린더의 보조 캘린더 'SOL RADAR 입찰 일정'에 넣을 수 있습니다. 연결할 때 구글 화면에서 '캘린더 일정 보기·수정' 동의를 한 번 묻습니다.";
const EXPIRED_WARNING = "구글 연결이 만료되어 일정을 넣을 수 없습니다. 다시 연결해 주세요.";
const UNKNOWN_FAILURE = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
// 해제는 저장한 토큰·매핑만 지운다. 구글 캘린더에 넣은 일정은 그대로 남는다(스펙 상태 표 "해제").
const DISCONNECTED_NOTICE = "구글 캘린더 연결을 해제했습니다. 구글 캘린더에 넣은 일정은 남습니다.";

const RESULT_LABELS: Record<NonNullable<GoogleCalendarView["lastResult"]>, string> = {
  SYNCED: "넣음",
  FAILED: "일부 넣지 못함",
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

export function lastSyncedLine(view: GoogleCalendarView): string {
  const at = view.lastSyncedAt === null ? null : formatSeoul(view.lastSyncedAt);
  if (at === null) return "마지막 반영: 아직 없음";
  return view.lastResult === null
    ? `마지막 반영: ${at}`
    : `마지막 반영: ${at} · ${RESULT_LABELS[view.lastResult]}`;
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

export function GoogleCalendarSection({
  view,
  outcome,
  settingsPath,
}: {
  view: GoogleCalendarView;
  // 연결하러 갔다 돌아온 결과(?google=…). 화면이 한 번 알리고 주소에서 지운다.
  outcome: GoogleConnectOutcome | null;
  settingsPath: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // 개발 모드(StrictMode)는 효과를 두 번 돌린다. 알림은 한 번만 한다.
  const announcedRef = useRef(false);
  // 돌아온 결과는 처음 그릴 때의 값으로만 정한다. 주소에서 google 을 지워도 안내 글자는 남는다.
  const [returnedNotice] = useState(() =>
    outcome && outcome !== "connected" ? GOOGLE_CONNECT_NOTICES[outcome] : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!outcome || announcedRef.current) return;
    announcedRef.current = true;
    if (outcome === "connected") {
      toast.success("구글 캘린더를 연결했습니다. 입찰 일정 화면에서 이 달 일정을 넣어 보세요.");
    } else {
      noticeRef.current?.focus();
    }
    router.replace(pathname, { scroll: false });
  }, [outcome, pathname, router]);

  const onDisconnect = async () => {
    setIsPending(true);
    setError(null);
    try {
      const response = await fetch(API, { method: "DELETE", headers: REQUEST_HEADERS });
      if (response.ok) toast.success(DISCONNECTED_NOTICE);
      else setError(await errorMessageOf(response));
    } catch {
      setError(UNKNOWN_FAILURE);
    } finally {
      setIsPending(false);
      // 실패해도 다시 읽는다 — 화면이 서버 값으로 돌아간다.
      router.refresh();
    }
  };

  const notice = error ?? returnedNotice;
  const connectLink = (label: string) => (
    <a
      href={googleConnectHref(settingsPath)}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
    >
      <CalendarPlusIcon aria-hidden />
      {label}
    </a>
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
      {view.state === "DISCONNECTED" ? (
        <div className="flex flex-col gap-3">
          <p className="type-body text-muted-foreground">{NOT_CONNECTED_HINT}</p>
          {connectLink("구글 캘린더 연동")}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 type-body">
            <dt className="text-muted-foreground">구글 계정</dt>
            <dd className="truncate text-foreground" title={view.googleEmail ?? undefined}>
              {view.googleEmail ?? "이메일 없음"}
            </dd>
            <dt className="text-muted-foreground">상태</dt>
            <dd className="text-foreground">{view.state === "EXPIRED" ? "연결 만료" : "연결됨"}</dd>
          </dl>
          <p className="type-caption text-muted-foreground">{lastSyncedLine(view)}</p>
          {view.state === "EXPIRED" ? (
            <p role="status" className="type-label text-warning">
              {EXPIRED_WARNING}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {view.state === "EXPIRED" ? connectLink("다시 연결") : null}
            {view.hasCalendar ? (
              <a
                href={GOOGLE_CALENDAR_HOME}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="구글 캘린더 열기(새 창)"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <ExternalLinkIcon aria-hidden />
                구글 캘린더 열기
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => void onDisconnect()}
            >
              {isPending ? "해제하는 중…" : "연결 해제"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
