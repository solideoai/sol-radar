import "server-only";

// ── 구글 캘린더 연동(ADR-073) 모델: 순수 타입과 규칙. 저장·구글 API·화면을 모른다 ──
// 연결 한 행(google_calendar_links)의 화면 상태, 입찰 일정 → 구글 이벤트 본문, 밀어넣기 계획(만들기·갱신·삭제)을 정한다.
// 일정의 글자(제목·설명)는 화면과 같은 순수 함수(app/(work)/calendar/calendar-export)가 만들어 GoogleEventInput 으로 넘긴다.
// 이 도메인은 글자를 다시 만들지 않는다(화면·구글에 같은 글자가 가게).

export type GoogleLinkStatus = "CONNECTED" | "EXPIRED";
export type GoogleSyncResult = "SYNCED" | "FAILED" | "EXPIRED";

/** 연결 표에서 사용자 세션이 읽는 열. refresh_token_enc 는 서버 키로 봉인한 암호문이다(평문 아님). */
export type GoogleCalendarRow = {
  status: GoogleLinkStatus;
  google_email: string | null;
  refresh_token_enc: string;
  calendar_id: string | null;
  last_synced_at: string | null;
  last_result: GoogleSyncResult | null;
};

/** 설정 칸·캘린더 툴바가 보는 상태. 토큰은 없다. */
export type GoogleCalendarView = {
  state: "DISCONNECTED" | "CONNECTED" | "EXPIRED";
  googleEmail: string | null;
  /** 전용 보조 캘린더를 이미 만들었는지(첫 밀어넣기 뒤 true) */
  hasCalendar: boolean;
  lastSyncedAt: string | null;
  lastResult: GoogleSyncResult | null;
};

export function toGoogleCalendarView(row: GoogleCalendarRow | null): GoogleCalendarView {
  if (row === null) {
    return {
      state: "DISCONNECTED",
      googleEmail: null,
      hasCalendar: false,
      lastSyncedAt: null,
      lastResult: null,
    };
  }
  return {
    state: row.status === "EXPIRED" ? "EXPIRED" : "CONNECTED",
    googleEmail: row.google_email,
    hasCalendar: row.calendar_id !== null,
    lastSyncedAt: row.last_synced_at,
    lastResult: row.last_result,
  };
}

// ── 일정 → 구글 이벤트 ──

/** 전용 보조 캘린더 이름. 사용자의 기본 캘린더에 섞지 않는다. */
export const GOOGLE_CALENDAR_SUMMARY = "SOL RADAR 입찰 일정";
export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Seoul";
/** 구글 이벤트에 숨겨 두는 우리 일정 key 의 이름(extendedProperties.private). */
export const SOL_KEY_PROPERTY = "solKey";
/** 밀어넣기 때 동시에 보내는 구글 요청 수. */
export const SYNC_CONCURRENCY = 4;

/** 밀어넣기 한 번에 넣을 수 있는 일정 수. 넘으면 구글을 부르지 않고 400 이다(구글 쿼터·응답 시간 보호, 보안 리뷰 C). */
export const SYNC_MAX_EVENTS = 500;

/** 밀어넣을 일정 하나. 글자는 화면이 만든 그대로다(담당자 이름은 들어 있지 않다). */
export type GoogleEventInput = {
  /** 입찰 일정 key("<종류>:<id>"). 구글 이벤트의 solKey 와 매핑 표의 event_key 가 된다. */
  key: string;
  /** KST 날짜 "YYYY-MM-DD" */
  date: string;
  summary: string;
  description: string;
  location: string | null;
  /** ISO 시각 */
  startAt: string;
  endAt: string;
  /** 이 일정의 SOL RADAR 주소. 모르면 null */
  url: string | null;
};

export type GoogleEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
};

export function toGoogleEventBody(input: GoogleEventInput): GoogleEventBody {
  return {
    summary: input.summary,
    description: input.description,
    ...(input.location === null ? {} : { location: input.location }),
    start: { dateTime: input.startAt, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    end: { dateTime: input.endAt, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    extendedProperties: { private: { [SOL_KEY_PROPERTY]: input.key } },
    ...(input.url === null ? {} : { source: { title: "SOL RADAR", url: input.url } }),
  };
}

// ── 밀어넣기 계획 ──

/** 매핑 표 한 행: 우리 일정 key ↔ 구글 이벤트 id. eventDate 는 KST 날짜다. */
export type EventMapping = { eventKey: string; googleEventId: string; eventDate: string };

export type SyncPlan = {
  create: GoogleEventInput[];
  update: { input: GoogleEventInput; googleEventId: string }[];
  /** 그 달의 매핑 가운데 지금 일정에 없는 것 — 구글에서 지우고 매핑도 지운다 */
  remove: EventMapping[];
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** "YYYY-MM" → 그 달의 첫날과 다음 달 첫날("YYYY-MM-DD"). 모양이 틀리면 null. */
export function monthRange(monthPrefix: string): { from: string; to: string } | null {
  const match = MONTH_PATTERN.exec(monthPrefix);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${next.year}-${pad(next.month)}-01`,
  };
}

/** 밀어넣는 범위: 지금 보는 달("YYYY-MM")·보기·종류. kinds 는 지금 고른 일정 종류다(전부 고르면 전부, 하나도 안 고르면 빈 목록). */
export type SyncScope = {
  monthPrefix: string;
  view: "org" | "mine";
  kinds: readonly string[];
};

/** 일정 key("<종류>:<id>")의 종류. */
const kindOfKey = (key: string): string => key.split(":", 1)[0] ?? "";

/**
 * 밀어넣기는 "지금 보는 달·보기·종류"의 일정을 구글 캘린더에 넣는다.
 *   - 매핑이 없는 일정 → 만들기
 *   - 매핑이 있는 일정 → 갱신(날짜가 다른 달로 옮겨 왔어도 같은 key 면 갱신이다)
 *   - 그 달 매핑 가운데 지금 일정에 없는 것 → 삭제. 단 지금 보는 범위 안에서만 지운다:
 *       · 조직 전체 보기: key 의 종류가 지금 고른 종류에 드는 매핑만 지운다. 종류를 하나도 안 고르면 지우지 않는다.
 *       · 내 일정 보기: 지우지 않는다. 내 일정에 없다고 조직 일정이 사라진 것은 아니다.
 * 다른 달의 매핑은 건드리지 않는다. inputs 의 같은 key 는 하나로 본다(먼저 온 것).
 */
export function planSync(
  inputs: readonly GoogleEventInput[],
  mappings: readonly EventMapping[],
  scope: SyncScope,
): SyncPlan {
  const byKey = new Map(mappings.map((mapping) => [mapping.eventKey, mapping]));
  const seen = new Set<string>();
  const create: GoogleEventInput[] = [];
  const update: SyncPlan["update"] = [];
  for (const input of inputs) {
    if (seen.has(input.key)) continue;
    seen.add(input.key);
    const mapping = byKey.get(input.key);
    if (mapping === undefined) create.push(input);
    else update.push({ input, googleEventId: mapping.googleEventId });
  }
  const removableKinds = new Set(scope.view === "mine" ? [] : scope.kinds);
  const remove = mappings.filter(
    (mapping) =>
      mapping.eventDate.startsWith(`${scope.monthPrefix}-`) &&
      !seen.has(mapping.eventKey) &&
      removableKinds.has(kindOfKey(mapping.eventKey)),
  );
  return { create, update, remove };
}

export type SyncCounts = { created: number; updated: number; deleted: number; failed: number };

export const EMPTY_SYNC_COUNTS: SyncCounts = { created: 0, updated: 0, deleted: 0, failed: 0 };

/** 하나라도 실패했으면 FAILED, 아니면 SYNCED. */
export const syncResultOf = (counts: SyncCounts): Exclude<GoogleSyncResult, "EXPIRED"> =>
  counts.failed > 0 ? "FAILED" : "SYNCED";
