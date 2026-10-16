import { describe, expect, it } from "vitest";
import { parseDisplayName, type ProfileRow, toMyProfile, toProfileView } from "./profile.model";

const row = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  email: "a@example.com",
  is_admin: false,
  display_name: "가",
  avatar_url: null,
  status: "active",
  created_at: "2026-10-14T06:00:00.000Z",
  employment: null,
  ...overrides,
});

describe("toProfileView", () => {
  it("운영자 여부를 화면의 역할 이름으로 바꾼다", () => {
    expect(toProfileView(row())).toEqual({
      email: "a@example.com",
      displayName: "가",
      avatarUrl: null,
      role: "회원",
      isAdmin: false,
      joinedAt: "2026-10-14T06:00:00.000Z",
      employment: null,
      profileComplete: false,
    });
    expect(toProfileView(row({ is_admin: true, display_name: null }))).toMatchObject({
      role: "운영자",
      isAdmin: true,
    });
  });

  it("이메일을 주지 않는 제공자로 가입한 행은 이메일이 비어 있다 — 채우는 말은 화면이 정한다", () => {
    expect(toProfileView(row({ email: null })).email).toBeNull();
  });
});

describe("parseDisplayName", () => {
  it("앞뒤 공백을 걷어 낸 이름을 돌려준다", () => {
    expect(parseDisplayName("  홍길동 ")).toEqual({ ok: true, displayName: "홍길동" });
  });

  it("40자까지 받고 41자는 거절한다", () => {
    expect(parseDisplayName("가".repeat(40)).ok).toBe(true);
    expect(parseDisplayName("가".repeat(41))).toEqual({
      ok: false,
      message: "표시 이름은 40자 이하입니다",
    });
  });

  it("빈 값·공백뿐인 값은 거절한다", () => {
    expect(parseDisplayName("")).toEqual({ ok: false, message: "표시 이름을 입력하세요" });
    expect(parseDisplayName("   ").ok).toBe(false);
  });

  it("글자가 아닌 입력(직접 POST 로 온 값)은 거절한다", () => {
    expect(parseDisplayName(undefined).ok).toBe(false);
    expect(parseDisplayName({ displayName: "홍길동" }).ok).toBe(false);
  });
});

describe("toMyProfile", () => {
  it("활동 중인 회원은 화면 모양의 프로필이다", () => {
    expect(toMyProfile(row({ avatar_url: "https://img.example/a.png" }))).toEqual({
      status: "ready",
      profile: {
        email: "a@example.com",
        displayName: "가",
        avatarUrl: "https://img.example/a.png",
        role: "회원",
        isAdmin: false,
        joinedAt: "2026-10-14T06:00:00.000Z",
        employment: null,
        profileComplete: false,
      },
    });
  });

  it("정지된 회원은 프로필을 내보내지 않고 suspended 만 돌려준다", () => {
    expect(toMyProfile(row({ status: "suspended" }))).toEqual({ status: "suspended" });
    expect(toMyProfile(row({ status: "suspended", is_admin: true }))).toEqual({
      status: "suspended",
    });
  });

  it("active 가 아닌 모르는 상태도 열지 않는다(정지로 본다)", () => {
    expect(toMyProfile(row({ status: "deleted" }))).toEqual({ status: "suspended" });
  });

  it("행이 없으면(탈퇴 직후의 토큰 등) missing 이다", () => {
    expect(toMyProfile(null)).toEqual({ status: "missing" });
  });
});
