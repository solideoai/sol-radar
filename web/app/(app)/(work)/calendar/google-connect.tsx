"use client";

import { cn } from "cn";
import {
  CalendarPlusIcon,
  CalendarSyncIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CalendarView } from "@/server/calendar";
import type { GoogleCalendarView, GoogleConnectOutcome } from "@/server/google-calendar";
import {
  GOOGLE_CALENDAR_HOME,
  GOOGLE_CONNECT,
  GOOGLE_CONNECT_HINT,
  GOOGLE_CONNECT_NOTICES,
  GOOGLE_OPEN,
  GOOGLE_RECONNECT,
  GOOGLE_SYNC,
  GOOGLE_SYNC_ERRORS,
  GOOGLE_SYNC_HINT,
  GOOGLE_SYNCING,
  googleSynced,
  googleSyncedEmpty,
} from "./calendar-copy";

// ── /calendar 툴바의 구글 캘린더 연동(ADR-073): 버튼 하나와 그 아래 결과 띠 ──
// 연결·다시 동의는 페이지 이동이다(GET /api/v1/me/google-calendar/connect). 그 라우트가 서버에서 구글 로그인 연결(linkIdentity)이나
// 같은 계정 재동의(signInWithOAuth + login_hint)를 고르고, 시작한 사용자 id 를 서명한 state 쿠키를 굽는다.
// 콜백(/auth/callback?flow=google-calendar)은 돌아온 세션의 사용자 id 를 그 state 로 비교한다. 화면은 사용자 id 를 다루지 않는다.
// 밀어넣기는 POST /api/v1/calendar/google/sync 다. 버튼과 띠는 툴바의 다른 자리에 있어 GoogleCalendarSync(문맥)가 상태를 나눠 준다.

const CONNECT_PATH = "/api/v1/me/google-calendar/connect";
const SYNC_PATH = "/api/v1/calendar/google/sync";

/** 툴바가 서버에서 받는 값. */
export type GoogleCalendarToolbar = {
  state: GoogleCalendarView["state"];
  // 연결하러 갔다 돌아온 결과(?google=…). 띠에 한 번 알리고 주소에서 지운다.
  outcome: GoogleConnectOutcome | null;
  // 지금 보는 달·보기·종류의 화면 주소(google 결과 없이). 연결이 끝나면 여기에 ?google=<결과>가 붙어 돌아온다.
  returnPath: string;
  // 밀어넣을 범위. kinds 는 ?kinds= 값(전부면 null, 하나도 안 고르면 빈 글자)이다.
  sync: { month: string; view: CalendarView; kinds: string | null };
};

type SyncCounts = { created: number; updated: number; deleted: number };

/** 결과 띠 한 줄. 진행 중은 busy, 성공은 ok(구글 캘린더 열기 링크), 실패·안내는 error 다. */
export type GoogleBand =
  | { tone: "busy"; message: string }
  | { tone: "ok"; message: string; showOpen: boolean }
  | { tone: "error"; message: string };

/** 연결 상태가 바뀌는 응답(만료·연결 없음)이면 바뀐 상태. */
type SyncResult = { band: GoogleBand; state: GoogleCalendarToolbar["state"] | null };

/** 연결 시작 주소. 돌아올 곳(next)은 사이트 안 경로이고 서버가 다시 검사한다. */
export const googleConnectHref = (next: string): string =>
  `${CONNECT_PATH}?next=${encodeURIComponent(next)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const countOf = (body: Record<string, unknown>, key: string): number | null => {
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
};

function countsOf(body: unknown): SyncCounts | null {
  if (!isRecord(body)) return null;
  const created = countOf(body, "created");
  const updated = countOf(body, "updated");
  const deleted = countOf(body, "deleted");
  return created === null || updated === null || deleted === null
    ? null
    : { created, updated, deleted };
}

function errorOf(body: unknown): { code: string | null; component: string | null } {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = error !== null && isRecord(error.details) ? error.details : null;
  return {
    code: typeof error?.code === "string" ? error.code : null,
    component: typeof details?.component === "string" ? details.component : null,
  };
}

const failure = (message: string, state: SyncResult["state"] = null): SyncResult => ({
  band: { tone: "error", message },
  state,
});

/**
 * 밀어넣기 응답 → 띠와 바뀐 연결 상태(순수 함수). 오류 문구는 오류 코드(05 API)로 고른다.
 * 그 달 일정이 0건이면 만들기·갱신이 0이다(일정 하나는 만들기나 갱신 하나가 된다).
 */
export function syncResultOf(status: number, body: unknown): SyncResult {
  if (status === 200) {
    const counts = countsOf(body);
    if (counts === null) return failure(GOOGLE_SYNC_ERRORS.unknown);
    const isEmpty = counts.created + counts.updated === 0;
    return {
      band: {
        tone: "ok",
        message: isEmpty ? googleSyncedEmpty(counts.deleted) : googleSynced(counts),
        showOpen: !isEmpty,
      },
      state: null,
    };
  }
  const { code, component } = errorOf(body);
  if (status === 401) return failure(GOOGLE_SYNC_ERRORS.signedOut);
  if (code === "GOOGLE_EXPIRED") return failure(GOOGLE_SYNC_ERRORS.expired, "EXPIRED");
  if (code === "GOOGLE_NOT_CONNECTED") {
    return failure(GOOGLE_SYNC_ERRORS.notConnected, "DISCONNECTED");
  }
  if (code === "UPSTREAM_ERROR") return failure(GOOGLE_SYNC_ERRORS.upstream);
  if (code === "VALIDATION_ERROR" && component === "google-calendar-limit") {
    return failure(GOOGLE_SYNC_ERRORS.tooMany);
  }
  if (code === "SERVICE_UNAVAILABLE") {
    return failure(
      component === "calendar-relevant" ? GOOGLE_SYNC_ERRORS.relevant : GOOGLE_SYNC_ERRORS.notReady,
    );
  }
  return failure(GOOGLE_SYNC_ERRORS.unknown);
}

/** 돌아온 연결 결과의 띠. 결과가 없으면 null. */
const bandOfOutcome = (outcome: GoogleConnectOutcome | null): GoogleBand | null => {
  if (outcome === null) return null;
  const message = GOOGLE_CONNECT_NOTICES[outcome];
  return outcome === "connected"
    ? { tone: "ok", message, showOpen: false }
    : { tone: "error", message };
};

type GoogleCalendarContextValue = {
  toolbar: GoogleCalendarToolbar;
  state: GoogleCalendarToolbar["state"];
  band: GoogleBand | null;
  isBusy: boolean;
  startSync: () => void;
};

const GoogleCalendarContext = createContext<GoogleCalendarContextValue | null>(null);

function useGoogleCalendar(): GoogleCalendarContextValue {
  const value = use(GoogleCalendarContext);
  if (value === null) throw new Error("GoogleCalendarSync 안에서만 쓴다");
  return value;
}

/** 툴바 버튼과 결과 띠가 같이 보는 상태. 버튼과 띠를 이 부품 안에 둔다. */
export function GoogleCalendarSync({
  toolbar,
  children,
}: {
  toolbar: GoogleCalendarToolbar;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState(toolbar.state);
  // 돌아온 결과는 처음 그릴 때의 값으로만 정한다. 주소에서 google 을 지워도 띠는 남는다.
  const [band, setBand] = useState<GoogleBand | null>(() => bandOfOutcome(toolbar.outcome));
  const [isBusy, setIsBusy] = useState(false);
  // 개발 모드(StrictMode)는 효과를 두 번 돌린다. 주소 정리는 한 번만 한다.
  const cleanedRef = useRef(false);

  useEffect(() => {
    if (toolbar.outcome === null || cleanedRef.current) return;
    cleanedRef.current = true;
    // 새로 고침·뒤로 가기에 같은 안내가 다시 뜨지 않게 주소에서 결과를 지운다.
    router.replace(toolbar.returnPath, { scroll: false });
  }, [toolbar.outcome, toolbar.returnPath, router]);

  const startSync = () => {
    if (isBusy) return;
    setIsBusy(true);
    setBand({ tone: "busy", message: GOOGLE_SYNCING });
    const { month, view, kinds } = toolbar.sync;
    void fetch(SYNC_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "sol-radar" },
      body: JSON.stringify({ month, view, ...(kinds === null ? {} : { kinds }) }),
    })
      .then(async (response) =>
        syncResultOf(response.status, await response.json().catch(() => null)),
      )
      .catch(() => failure(GOOGLE_SYNC_ERRORS.unknown))
      .then((result) => {
        setBand(result.band);
        if (result.state !== null) setState(result.state);
        setIsBusy(false);
      });
  };

  return (
    <GoogleCalendarContext value={{ toolbar, state, band, isBusy, startSync }}>
      {children}
    </GoogleCalendarContext>
  );
}

// 모바일(ADR-072)에서 툴바 버튼은 44px 영역이다.
const toolbarButton = cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:min-h-11");

/** 툴바 버튼 하나. 연결 전 [구글 캘린더 연동], 연결 뒤 [구글 캘린더에 넣기], 만료면 [다시 연결]. */
export function GoogleCalendarButton() {
  const { toolbar, state, isBusy, startSync } = useGoogleCalendar();
  if (state === "CONNECTED") {
    return (
      <Button
        variant="outline"
        size="sm"
        title={GOOGLE_SYNC_HINT}
        disabled={isBusy}
        aria-busy={isBusy}
        onClick={startSync}
        className="max-md:min-h-11"
      >
        {isBusy ? (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        ) : (
          <CalendarSyncIcon aria-hidden />
        )}
        {GOOGLE_SYNC}
      </Button>
    );
  }
  // 연결·다시 동의는 구글 화면으로 가는 이동이라 <a> 다(Link 는 미리 읽기로 라우트를 부를 수 있다).
  const isExpired = state === "EXPIRED";
  return (
    <a
      href={googleConnectHref(toolbar.returnPath)}
      title={isExpired ? undefined : GOOGLE_CONNECT_HINT}
      className={toolbarButton}
    >
      {isExpired ? <RefreshCwIcon aria-hidden /> : <CalendarPlusIcon aria-hidden />}
      {isExpired ? GOOGLE_RECONNECT : GOOGLE_CONNECT}
    </a>
  );
}

/** 버튼 아래 결과 띠. 읽기 영역(role="status")은 늘 있고, 글자가 생기면 화면 읽기가 읊는다. */
export function GoogleCalendarBand() {
  const { band } = useGoogleCalendar();
  return (
    <div role="status" aria-busy={band?.tone === "busy"}>
      {band === null ? null : (
        <p
          className={cn(
            "mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 type-label wrap-anywhere",
            band.tone === "error" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {band.tone === "busy" ? (
            <LoaderCircleIcon aria-hidden className="size-3.5 shrink-0 animate-spin" />
          ) : band.tone === "ok" ? (
            <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
          ) : (
            <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-warning" />
          )}
          <span className="min-w-0">{band.message}</span>
          {band.tone === "ok" && band.showOpen ? (
            <a
              href={GOOGLE_CALENDAR_HOME}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${GOOGLE_OPEN}(새 창)`}
              className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-4 outline-hidden hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              {GOOGLE_OPEN}
            </a>
          ) : null}
        </p>
      )}
    </div>
  );
}
