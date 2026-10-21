import { describe, expect, it } from "vitest";
import { toKakaoNotifyView, type KakaoNotifyRow } from "./kakao-notify.model";

// 개인 설정 "카카오톡 알림" 칸의 상태 4개(설계 §9). 연결 표 행 하나를 화면 상태로 바꾼다.
const row = (overrides: Partial<KakaoNotifyRow> = {}): KakaoNotifyRow => ({
  enabled: true,
  status: "CONNECTED",
  last_sent_at: "2026-10-20T05:14:00.000Z",
  last_result: "SENT",
  ...overrides,
});

describe("toKakaoNotifyView", () => {
  it("행이 없으면 연결 전(DISCONNECTED)이고 마지막 발송이 없다", () => {
    expect(toKakaoNotifyView(null)).toEqual({
      state: "DISCONNECTED",
      lastSentAt: null,
      lastResult: null,
    });
  });

  it("연결되고 켜져 있으면 ON 이고 마지막 발송 시각·결과를 그대로 싣는다", () => {
    expect(toKakaoNotifyView(row())).toEqual({
      state: "ON",
      lastSentAt: "2026-10-20T05:14:00.000Z",
      lastResult: "SENT",
    });
  });

  it("연결되고 꺼져 있으면 OFF 다", () => {
    expect(toKakaoNotifyView(row({ enabled: false }))).toMatchObject({ state: "OFF" });
  });

  it("연결이 만료되면 켬·끔과 상관없이 EXPIRED 다", () => {
    expect(toKakaoNotifyView(row({ status: "EXPIRED", last_result: "EXPIRED" }))).toEqual({
      state: "EXPIRED",
      lastSentAt: "2026-10-20T05:14:00.000Z",
      lastResult: "EXPIRED",
    });
    expect(toKakaoNotifyView(row({ status: "EXPIRED", enabled: false }))).toMatchObject({
      state: "EXPIRED",
    });
  });

  it("아직 보낸 적이 없으면 마지막 발송이 null 이다", () => {
    expect(toKakaoNotifyView(row({ last_sent_at: null, last_result: null }))).toEqual({
      state: "ON",
      lastSentAt: null,
      lastResult: null,
    });
  });
});
