import "server-only";

// ── google-calendar 도메인 배럴. 바깥(app)은 이 파일만 부른다 ──
// 입찰 일정(/calendar)의 구글 캘린더 연동(ADR-073): Supabase 구글 로그인 연결에 캘린더 범위를 얹어 받은 refresh token 을
// 봉인해 저장하고, 지금 보는 달·보기·종류의 일정을 사용자의 전용 보조 캘린더에 넣는다(만들기·갱신, 보는 범위 안의 없어진 일정은 삭제, 멱등).

export {
  GOOGLE_CALENDAR_SUMMARY,
  SYNC_CONCURRENCY,
  SYNC_MAX_EVENTS,
  monthRange,
  planSync,
  toGoogleCalendarView,
  toGoogleEventBody,
} from "./google-calendar.model";
export type {
  EventMapping,
  GoogleCalendarView,
  GoogleEventInput,
  GoogleSyncResult,
  SyncCounts,
  SyncScope,
} from "./google-calendar.model";

export { missingGoogleCalendarSettings, readGoogleCalendarConfig } from "./google-calendar.config";
export type { GoogleCalendarConfig } from "./google-calendar.config";

export { GoogleApiError, createGoogleApi } from "./google-api";
export type { GoogleApi, GoogleApiDeps } from "./google-api";

export { GoogleCalendarStoreError, googleCalendarRepo } from "./google-calendar.repo";
export type { GoogleCalendarRepo } from "./google-calendar.repo";

export {
  GOOGLE_CALENDAR_FLOW,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CONNECT_OUTCOMES,
  GOOGLE_STATE_COOKIE,
  completeGoogleCalendarConnect,
  disconnectMyGoogleCalendar,
  getMyGoogleCalendar,
  loadMyGoogleCalendar,
  startGoogleCalendarConnect,
  syncMyGoogleCalendar,
  toGoogleConnectOutcome,
} from "./google-calendar.service";
export type {
  GoogleCalendarDeps,
  GoogleConnectOutcome,
  GoogleConnectResult,
  GoogleConnectStart,
  GoogleSyncInput,
  GoogleSyncOutcome,
} from "./google-calendar.service";
