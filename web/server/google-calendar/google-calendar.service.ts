import "server-only";
import { timingSafeEqual } from "node:crypto";
import { TokenSealError, createOAuthStateSigner } from "@/server/token-seal";
import { GoogleApiError, createGoogleApi, type GoogleApi } from "./google-api";
import {
  GOOGLE_TOKEN_KEY_NAME,
  googleTokenSealer,
  readGoogleCalendarConfig,
  type GoogleCalendarConfig,
} from "./google-calendar.config";
import {
  EMPTY_SYNC_COUNTS,
  GOOGLE_CALENDAR_SUMMARY,
  GOOGLE_CALENDAR_TIME_ZONE,
  SYNC_CONCURRENCY,
  planSync,
  syncResultOf,
  toGoogleCalendarView,
  toGoogleEventBody,
  type EventMapping,
  type GoogleCalendarView,
  type GoogleEventInput,
  type SyncCounts,
  type SyncScope,
} from "./google-calendar.model";
import { googleCalendarRepo, type GoogleCalendarRepo } from "./google-calendar.repo";

// ── 구글 캘린더 연동 흐름(ADR-073): 연결 시작 → 콜백 저장 → 밀어넣기 → 해제 ──
// 누구의 연결인지는 Route Handler 가 로그인(requireUser)에서 읽어 userId 로 넘긴다. 저장은 같은 요청의 세션으로 RLS 가 본인 행만 연다.
// 연결: /connect 가 Supabase 구글 OAuth(캘린더 범위·offline·consent)를 시작하고 state 를 쿠키에 굽는다 → 구글 동의 →
// /auth/callback?flow=google-calendar 가 코드를 세션으로 바꾸고, 돌아온 사람이 시작한 사람인지 state 로 확인한 뒤
// 세션의 provider_refresh_token 을 봉인해 저장한다. 다른 사람으로 돌아왔으면 그 세션을 끊는다(남의 로그인으로 남지 않게).

/** 콜백 결과. 캘린더 화면이 ?google=<값> 으로 받는다. 화면은 이 목록에 있는 값만 믿는다. */
export const GOOGLE_CONNECT_OUTCOMES = [
  "connected",
  "consent_denied",
  "account_mismatch",
  "no_refresh_token",
  "state_mismatch",
  "failed",
] as const;
export type GoogleConnectOutcome = (typeof GOOGLE_CONNECT_OUTCOMES)[number];

/** 주소의 ?google= 값 → 결과. 목록에 없거나 여러 개면 null(안내하지 않는다). */
export const toGoogleConnectOutcome = (value: unknown): GoogleConnectOutcome | null =>
  GOOGLE_CONNECT_OUTCOMES.find((outcome) => outcome === value) ?? null;

/** 콜백 로그용 이유 코드. 값(토큰·코드·state)은 싣지 않는다. */
export type GoogleConnectReason =
  | "NOT_CONFIGURED"
  | "STATE_MISSING"
  | "STATE_INVALID"
  | "ACCESS_DENIED"
  | "PROVIDER_ERROR"
  | "CODE_MISSING"
  | "EXCHANGE_FAILED"
  | "REFRESH_MISSING";

export type GoogleConnectResult = {
  outcome: GoogleConnectOutcome;
  reason: GoogleConnectReason | null;
  /** 시작한 사람과 같다고 확인된 사람(connected·no_refresh_token). 그 밖에는 null. 로그의 행위자다. */
  userId: string | null;
  /** account_mismatch 에서 세션 끊기가 실패했을 때만: 오류 코드(값·토큰 없음). 콜백이 로그로 남긴다. */
  signOutError?: string;
};

export type GoogleConnectStart =
  | { kind: "REDIRECT"; redirectTo: string; state: string }
  | { kind: "NOT_CONFIGURED" }
  | { kind: "START_FAILED"; reason: string };

/** 연결 시작이 굽는 state 쿠키. 콜백 경로에만 실리고 10분 뒤 사라진다. */
export const GOOGLE_STATE_COOKIE = {
  name: "google_calendar_state",
  path: "/auth/callback",
  maxAgeSeconds: 600,
} as const;

/** 구글 캘린더 이벤트 범위. 캘린더 목록 전체(…/auth/calendar)는 받지 않는다. */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** 콜백의 flow 값. /auth/callback 이 이 값이면 구글 캘린더 연결로 처리한다. */
export const GOOGLE_CALENDAR_FLOW = "google-calendar";
/** 웹 서버의 구글 요청 하나의 시간 초과. 사람이 기다리는 요청이라 짧게 둔다. */
const WEB_GOOGLE_TIMEOUT_MS = 10_000;

export type GoogleCalendarDeps = {
  repo: GoogleCalendarRepo;
  config: () => GoogleCalendarConfig | null;
  api: (config: GoogleCalendarConfig) => GoogleApi;
  now: () => Date;
};

const defaultDeps = (): GoogleCalendarDeps => ({
  repo: googleCalendarRepo,
  config: () => readGoogleCalendarConfig(process.env),
  api: (config) =>
    createGoogleApi({
      fetch,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      timeoutMs: WEB_GOOGLE_TIMEOUT_MS,
      now: () => new Date(),
    }),
  now: () => new Date(),
});

const sealer = googleTokenSealer;
const stateSigner = createOAuthStateSigner({
  keyName: GOOGLE_TOKEN_KEY_NAME,
  info: "google-calendar-oauth-state",
  label: "google-calendar-state:v1",
});

const result = (
  outcome: GoogleConnectOutcome,
  reason: GoogleConnectReason | null,
  userId: string | null = null,
): GoogleConnectResult => ({ outcome, reason, userId });

/** 길이가 다른 문자열도 시간이 새지 않게 비교한다. */
const sameText = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

// ── 상태 읽기 ──

export async function getMyGoogleCalendar(
  userId: string,
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<GoogleCalendarView> {
  return toGoogleCalendarView(await deps.repo.readMine(userId));
}

/** 서버 화면(설정·캘린더)용: 로그인한 사람의 화면 상태. 로그인 전이거나 DB 설정이 없으면 null. */
export async function loadMyGoogleCalendar(
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<GoogleCalendarView | null> {
  if (!deps.repo.isConfigured()) return null;
  const userId = await deps.repo.currentUserId();
  return userId === null ? null : getMyGoogleCalendar(userId, deps);
}

// ── 연결 ──

/**
 * 구글 동의 화면 주소와 state. 설정이 빠졌으면 NOT_CONFIGURED(이동하지 않는다).
 * callbackOrigin 은 이 사이트의 출처(https://…), next 는 돌아갈 사이트 안 경로다(부르는 쪽이 safeNextPath 를 거친다).
 * 구글이 아직 로그인 수단이 아니면 로그인 연결(linkIdentity)과 캘린더 동의를 한 화면에서 받는다.
 * 이미 연결돼 있으면 같은 계정(login_hint)으로 다시 동의받는다 — prompt=consent 여야 refresh token 이 다시 온다.
 */
export async function startGoogleCalendarConnect(
  input: { userId: string; callbackOrigin: string; next: string },
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<GoogleConnectStart> {
  const config = deps.config();
  if (config === null) return { kind: "NOT_CONFIGURED" };
  const identity = await deps.repo.googleIdentity();
  const callback = new URL("/auth/callback", input.callbackOrigin);
  callback.searchParams.set("flow", GOOGLE_CALENDAR_FLOW);
  callback.searchParams.set("next", input.next);
  const authorized = await deps.repo.authorizeUrl({
    mode: identity.linked ? "signin" : "link",
    redirectTo: callback.toString(),
    scopes: GOOGLE_CALENDAR_SCOPE,
    queryParams: {
      access_type: "offline",
      prompt: "consent",
      ...(identity.email === null ? {} : { login_hint: identity.email }),
    },
  });
  if ("failed" in authorized) return { kind: "START_FAILED", reason: authorized.failed };
  const state = stateSigner.create({
    userId: input.userId,
    secret: config.tokenKey,
    now: deps.now(),
  });
  return { kind: "REDIRECT", redirectTo: authorized.url, state };
}

/**
 * 구글 콜백(/auth/callback?flow=google-calendar). 순서:
 *   1. 구글·Supabase 가 오류로 돌려보냈으면 코드 교환 없이 끝낸다(동의 거부는 consent_denied).
 *   2. 코드를 세션으로 바꾼다 — 이때 로그인 쿠키가 돌아온 계정으로 바뀐다.
 *   3. state 쿠키가 "돌아온 사람"이 시작한 것인지 본다. 아니면(다른 구글 계정으로 로그인됐거나 만료) 그 세션을 끊고 account_mismatch.
 *   4. refresh token 이 없으면 no_refresh_token(구글이 이전 동의를 재사용했을 때. 계정 설정에서 앱 접근을 지우고 다시 연결).
 *   5. 봉인해 저장. 연결한 구글 계정이 바뀌었으면 전용 캘린더 id·매핑을 비운다.
 */
export async function completeGoogleCalendarConnect(
  input: { params: URLSearchParams; stateCookie: string | undefined },
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<GoogleConnectResult> {
  const config = deps.config();
  if (config === null) return result("failed", "NOT_CONFIGURED");

  const providerError = input.params.get("error");
  if (providerError === "access_denied") return result("consent_denied", "ACCESS_DENIED");
  if (providerError !== null) return result("failed", "PROVIDER_ERROR");
  const code = input.params.get("code");
  if (code === null || code === "") return result("failed", "CODE_MISSING");
  if (input.stateCookie === undefined || input.stateCookie === "") {
    return result("state_mismatch", "STATE_MISSING");
  }

  const exchanged = await deps.repo.exchangeCode(code);
  if (exchanged === null) return result("failed", "EXCHANGE_FAILED");

  const isValidState = stateSigner.verify({
    state: input.stateCookie,
    userId: exchanged.userId,
    secret: config.tokenKey,
    now: deps.now(),
  });
  if (!isValidState) {
    // 시작한 사람과 다른 계정으로 로그인됐을 수 있다. 그 세션을 남기지 않는다.
    const signedOut = await deps.repo.signOut();
    const mismatch = result("account_mismatch", "STATE_INVALID");
    return signedOut.errorCode === null
      ? mismatch
      : { ...mismatch, signOutError: signedOut.errorCode };
  }
  if (exchanged.providerRefreshToken === null || exchanged.providerRefreshToken === "") {
    return result("no_refresh_token", "REFRESH_MISSING", exchanged.userId);
  }

  const existing = await deps.repo.readMine(exchanged.userId);
  const resetCalendar =
    existing !== null &&
    existing.google_email !== null &&
    exchanged.googleEmail !== null &&
    !sameText(existing.google_email, exchanged.googleEmail);
  await deps.repo.saveLink(exchanged.userId, {
    refreshTokenEnc: sealer.encrypt(exchanged.providerRefreshToken, config.tokenKey, {
      userId: exchanged.userId,
      kind: "refresh",
    }),
    googleEmail: exchanged.googleEmail,
    resetCalendar,
  });
  return result("connected", null, exchanged.userId);
}

export async function disconnectMyGoogleCalendar(
  userId: string,
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<void> {
  await deps.repo.disconnect(userId);
}

// ── 밀어넣기 ──

/** 지금 보는 범위(달·보기·종류)와 그 범위의 일정. 삭제는 이 범위 안에서만 한다(planSync). */
export type GoogleSyncInput = SyncScope & { events: readonly GoogleEventInput[] };

export type GoogleSyncOutcome =
  | { kind: "SYNCED"; counts: SyncCounts; calendarId: string }
  | { kind: "NOT_CONFIGURED" }
  | { kind: "NOT_CONNECTED" }
  | { kind: "EXPIRED" }
  | { kind: "UPSTREAM_FAILED"; code: string };

/** 작은 동시 실행기. 순서는 지키지 않고 결과만 모은다. 작업 하나가 던지면 그대로 올린다. */
async function runConcurrently<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      if (task !== undefined) results.push(await task());
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

type StepResult =
  | { kind: "created" | "updated"; mapping: EventMapping }
  | { kind: "deleted"; eventKey: string }
  | { kind: "failed" };

/** 구글 호출 실패는 건수로 센다. 그 밖의 오류(저장·프로그램 오류)는 올린다. */
const guard = async (run: () => Promise<StepResult>): Promise<StepResult> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleApiError) return { kind: "failed" };
    throw error;
  }
};

/**
 * 지금 보는 달·보기·종류의 일정을 전용 캘린더에 넣는다(만들기·갱신, 범위 안의 사라진 일정은 삭제, 멱등). 순서:
 *   1. 연결 행을 읽고 refresh token 을 푼다. 변조됐으면 만료로 바꾼다. 키 불일치는 설정 오류라 던진다.
 *   2. 액세스 토큰을 받는다. INVALID_GRANT 면 만료(EXPIRED)로 바꾸고 끝낸다.
 *   3. 전용 캘린더가 없거나 구글에서 사라졌으면 새로 만들고(그때 매핑은 비운다) id 를 저장한다.
 *   4. 그 달 매핑과 계획을 세워 동시 SYNC_CONCURRENCY 건으로 보낸다. 갱신 대상이 구글에 없으면 다시 만든다.
 *   5. 매핑을 갱신하고 결과(SYNCED·FAILED)와 시각을 적는다.
 */
export async function syncMyGoogleCalendar(
  userId: string,
  input: GoogleSyncInput,
  deps: GoogleCalendarDeps = defaultDeps(),
): Promise<GoogleSyncOutcome> {
  const config = deps.config();
  if (config === null) return { kind: "NOT_CONFIGURED" };
  const link = await deps.repo.readMine(userId);
  if (link === null) return { kind: "NOT_CONNECTED" };
  if (link.status === "EXPIRED") return { kind: "EXPIRED" };

  let refreshToken: string;
  try {
    refreshToken = sealer.decrypt(link.refresh_token_enc, config.tokenKey, {
      userId,
      kind: "refresh",
    });
  } catch (error) {
    if (error instanceof TokenSealError && error.code === "DECRYPT_FAILED") {
      await deps.repo.markExpired(userId);
      return { kind: "EXPIRED" };
    }
    throw error;
  }

  const api = deps.api(config);
  let accessToken: string;
  try {
    accessToken = (await api.refresh(refreshToken)).accessToken;
  } catch (error) {
    if (error instanceof GoogleApiError) {
      if (error.code === "INVALID_GRANT") {
        await deps.repo.markExpired(userId);
        return { kind: "EXPIRED" };
      }
      return { kind: "UPSTREAM_FAILED", code: error.code };
    }
    throw error;
  }

  let calendarId: string;
  try {
    const existing =
      link.calendar_id !== null && (await api.getCalendar(accessToken, link.calendar_id)) === "OK"
        ? link.calendar_id
        : null;
    if (existing === null) {
      if (link.calendar_id !== null) await deps.repo.clearMappings(userId);
      calendarId = (
        await api.createCalendar(accessToken, GOOGLE_CALENDAR_SUMMARY, GOOGLE_CALENDAR_TIME_ZONE)
      ).id;
      await deps.repo.setCalendarId(userId, calendarId);
    } else {
      calendarId = existing;
    }
  } catch (error) {
    if (error instanceof GoogleApiError) {
      await deps.repo.markSync(userId, "FAILED", deps.now());
      return { kind: "UPSTREAM_FAILED", code: error.code };
    }
    throw error;
  }

  const mappings = await deps.repo.listMappings(userId, {
    monthPrefix: input.monthPrefix,
    keys: input.events.map((event) => event.key),
  });
  const plan = planSync(input.events, mappings, input);

  const insert = async (event: GoogleEventInput): Promise<StepResult> => {
    const { id } = await api.insertEvent(accessToken, calendarId, toGoogleEventBody(event));
    return {
      kind: "created",
      mapping: { eventKey: event.key, googleEventId: id, eventDate: event.date },
    };
  };
  const tasks: (() => Promise<StepResult>)[] = [
    ...plan.create.map((event) => () => guard(() => insert(event))),
    ...plan.update.map(
      ({ input: event, googleEventId }) =>
        () =>
          guard(async () => {
            const updated = await api.updateEvent(
              accessToken,
              calendarId,
              googleEventId,
              toGoogleEventBody(event),
            );
            // 사용자가 구글에서 지운 일정은 다시 만든다.
            if (updated === "EVENT_MISSING") return insert(event);
            return {
              kind: "updated",
              mapping: { eventKey: event.key, googleEventId, eventDate: event.date },
            };
          }),
    ),
    ...plan.remove.map(
      (mapping) => () =>
        guard(async () => {
          await api.deleteEvent(accessToken, calendarId, mapping.googleEventId);
          return { kind: "deleted", eventKey: mapping.eventKey };
        }),
    ),
  ];
  const steps = await runConcurrently(tasks, SYNC_CONCURRENCY);

  const counts: SyncCounts = { ...EMPTY_SYNC_COUNTS };
  const upserts: EventMapping[] = [];
  const deletions: string[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "created":
        counts.created += 1;
        upserts.push(step.mapping);
        break;
      case "updated":
        counts.updated += 1;
        upserts.push(step.mapping);
        break;
      case "deleted":
        counts.deleted += 1;
        deletions.push(step.eventKey);
        break;
      case "failed":
        counts.failed += 1;
        break;
    }
  }
  await deps.repo.upsertMappings(userId, upserts);
  await deps.repo.deleteMappings(userId, deletions);
  await deps.repo.markSync(userId, syncResultOf(counts), deps.now());
  return { kind: "SYNCED", counts, calendarId };
}
