import { describe, expect, it } from "vitest";
import {
  monthRange,
  planSync,
  syncResultOf,
  toGoogleCalendarView,
  toGoogleEventBody,
  type EventMapping,
  type GoogleEventInput,
  type SyncScope,
} from "./google-calendar.model";

// 구글 캘린더 연동 모델: 일정 → 구글 이벤트 본문, 밀어넣기 계획(만들기·갱신·삭제), 화면 상태.
const event = (
  key: string,
  date: string,
  extra: Partial<GoogleEventInput> = {},
): GoogleEventInput => ({
  key,
  date,
  summary: `[공고 마감] ${key}`,
  description: "기관: 세종특별자치시",
  location: null,
  startAt: `${date}T09:00:00.000Z`,
  endAt: `${date}T09:30:00.000Z`,
  url: null,
  ...extra,
});
const mapping = (eventKey: string, eventDate: string): EventMapping => ({
  eventKey,
  googleEventId: `g-${eventKey}`,
  eventDate,
});
// 기본 범위: 2026-11, 조직 전체 보기, 종류 전부(시험에 나오는 종류).
const ALL_KINDS = ["BID_DEADLINE", "OPENING", "SITE_BRIEFING"] as const;
const scope = (extra: Partial<SyncScope> = {}): SyncScope => ({
  monthPrefix: "2026-11",
  view: "org",
  kinds: ALL_KINDS,
  ...extra,
});

describe("toGoogleEventBody", () => {
  it("일정 key 를 숨은 속성으로 싣고 장소·주소는 있을 때만 넣는다", () => {
    const body = toGoogleEventBody(
      event("SITE_BRIEFING:b1", "2026-11-05", {
        location: "세종시청 3층",
        url: "https://www.solideos-radar.com/bids/b1?origin=live",
      }),
    );
    expect(body.extendedProperties.private).toEqual({ solKey: "SITE_BRIEFING:b1" });
    expect(body.start).toEqual({ dateTime: "2026-11-05T09:00:00.000Z", timeZone: "Asia/Seoul" });
    expect(body.location).toBe("세종시청 3층");
    expect(body.source).toEqual({
      title: "SOL RADAR",
      url: "https://www.solideos-radar.com/bids/b1?origin=live",
    });
    const bare = toGoogleEventBody(event("BID_DEADLINE:b2", "2026-11-06"));
    expect("location" in bare).toBe(false);
    expect("source" in bare).toBe(false);
  });
});

describe("planSync", () => {
  it("매핑이 없으면 만들고, 있으면 갱신하고, 그 달의 남은 매핑은 지운다", () => {
    const plan = planSync(
      [event("BID_DEADLINE:b1", "2026-11-03"), event("OPENING:b1", "2026-11-10")],
      [mapping("BID_DEADLINE:b1", "2026-11-03"), mapping("BID_DEADLINE:gone", "2026-11-20")],
      scope(),
    );
    expect(plan.create.map((input) => input.key)).toEqual(["OPENING:b1"]);
    expect(plan.update).toEqual([
      { input: event("BID_DEADLINE:b1", "2026-11-03"), googleEventId: "g-BID_DEADLINE:b1" },
    ]);
    expect(plan.remove).toEqual([mapping("BID_DEADLINE:gone", "2026-11-20")]);
  });

  it("다른 달의 매핑은 지우지 않고, 다른 달에서 옮겨 온 일정은 갱신한다", () => {
    const plan = planSync(
      [event("BID_DEADLINE:moved", "2026-11-02")],
      [mapping("BID_DEADLINE:moved", "2026-10-30"), mapping("BID_DEADLINE:other", "2026-12-01")],
      scope(),
    );
    expect(plan.create).toEqual([]);
    expect(plan.update.map((entry) => entry.googleEventId)).toEqual(["g-BID_DEADLINE:moved"]);
    expect(plan.remove).toEqual([]);
  });

  it("같은 key 가 두 번 와도 한 번만 다룬다", () => {
    const plan = planSync(
      [event("OPENING:b1", "2026-11-10"), event("OPENING:b1", "2026-11-10")],
      [],
      scope(),
    );
    expect(plan.create).toHaveLength(1);
  });

  // 삭제는 지금 보는 범위 안에서만 한다. 다른 종류·다른 보기의 일정이 지워지지 않게 한다.
  const november = [
    mapping("BID_DEADLINE:gone", "2026-11-20"),
    mapping("OPENING:gone", "2026-11-21"),
    mapping("SITE_BRIEFING:gone", "2026-11-22"),
  ];

  it("종류 하나만 고르고 넣으면 그 종류의 없어진 매핑만 지우고 다른 종류의 매핑은 남긴다", () => {
    const plan = planSync([], november, scope({ kinds: ["OPENING"] }));
    expect(plan.remove).toEqual([mapping("OPENING:gone", "2026-11-21")]);
  });

  it("내 일정 보기에서는 아무것도 지우지 않는다(만들기·갱신만)", () => {
    const plan = planSync(
      [event("BID_DEADLINE:mine", "2026-11-05")],
      [...november, mapping("BID_DEADLINE:mine", "2026-11-05")],
      scope({ view: "mine" }),
    );
    expect(plan.update.map((entry) => entry.googleEventId)).toEqual(["g-BID_DEADLINE:mine"]);
    expect(plan.remove).toEqual([]);
  });

  it("종류를 하나도 고르지 않으면 아무것도 지우지 않는다", () => {
    expect(planSync([], november, scope({ kinds: [] })).remove).toEqual([]);
  });
});

describe("monthRange·syncResultOf·toGoogleCalendarView", () => {
  it("달의 범위는 첫날부터 다음 달 첫날 전까지다", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-1")).toBeNull();
  });

  it("하나라도 실패하면 FAILED 다", () => {
    expect(syncResultOf({ created: 1, updated: 0, deleted: 0, failed: 0 })).toBe("SYNCED");
    expect(syncResultOf({ created: 1, updated: 0, deleted: 0, failed: 1 })).toBe("FAILED");
  });

  it("행이 없으면 연결 전, EXPIRED 면 만료, 토큰은 화면 상태에 없다", () => {
    expect(toGoogleCalendarView(null).state).toBe("DISCONNECTED");
    const view = toGoogleCalendarView({
      status: "EXPIRED",
      google_email: "me@gmail.invalid",
      refresh_token_enc: "v1.x.x.x.x",
      calendar_id: "cal-1",
      last_synced_at: "2026-10-30T00:00:00.000Z",
      last_result: "EXPIRED",
    });
    expect(view).toEqual({
      state: "EXPIRED",
      googleEmail: "me@gmail.invalid",
      hasCalendar: true,
      lastSyncedAt: "2026-10-30T00:00:00.000Z",
      lastResult: "EXPIRED",
    });
    expect(JSON.stringify(view)).not.toContain("v1.x");
  });
});
