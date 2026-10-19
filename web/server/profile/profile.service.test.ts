import { describe, expect, it, vi } from "vitest";
import type { ProfileRepo } from "./profile.repo";
import { deleteMyAccount, getMyProfile, updateMyDisplayName } from "./profile.service";

// 저장 자리에 가짜를 꽂는다. 실제 Supabase 는 부르지 않는다(누가 무엇을 읽는지는 DB 정책 시험이 본다).
const fakeRepo = (overrides: Partial<ProfileRepo> = {}): ProfileRepo => ({
  isConfigured: () => true,
  currentUserId: vi.fn(async () => "user-1"),
  findById: vi.fn(async () => ({
    email: "me@example.com",
    is_admin: false,
    display_name: null,
    avatar_url: null,
    status: "active",
    created_at: "2026-10-14T06:00:00.000Z",
    employment: null,
  })),
  updateDisplayName: vi.fn(async () => true),
  updateEmployment: vi.fn(async () => true),
  deleteAccount: vi.fn(async () => "deleted" as const),
  ...overrides,
});

describe("getMyProfile", () => {
  it("로그인한 사람의 id 로 프로필을 읽어 화면 모양으로 돌려준다", async () => {
    const repo = fakeRepo();
    await expect(getMyProfile(repo)).resolves.toEqual({
      status: "ready",
      profile: {
        email: "me@example.com",
        displayName: null,
        avatarUrl: null,
        role: "회원",
        isAdmin: false,
        joinedAt: "2026-10-14T06:00:00.000Z",
        employment: null,
        profileComplete: false,
      },
    });
    expect(repo.findById).toHaveBeenCalledWith("user-1");
  });

  it("DB 설정이 없으면 로그인 여부를 묻지 않는다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(getMyProfile(repo)).resolves.toEqual({ status: "no-database" });
    expect(repo.currentUserId).not.toHaveBeenCalled();
  });

  it("로그인 전이면 프로필을 읽지 않는다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(getMyProfile(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("로그인했는데 행이 없으면 missing 이다", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => null) });
    await expect(getMyProfile(repo)).resolves.toEqual({ status: "missing" });
  });

  it("정지된 회원이면 프로필 대신 suspended 다", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () => ({
        email: "me@example.com",
        is_admin: false,
        display_name: "나",
        avatar_url: null,
        status: "suspended",
        created_at: "2026-10-14T06:00:00.000Z",
        employment: null,
      })),
    });
    await expect(getMyProfile(repo)).resolves.toEqual({ status: "suspended" });
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getMyProfile(repo)).rejects.toThrow("db down");
  });
});

describe("updateMyDisplayName", () => {
  it("다듬은 이름을 로그인한 사람의 id 로 저장한다", async () => {
    const repo = fakeRepo();
    await expect(updateMyDisplayName(" 홍길동 ", repo)).resolves.toEqual({ status: "saved" });
    expect(repo.updateDisplayName).toHaveBeenCalledWith("user-1", "홍길동");
  });

  it("틀린 입력은 로그인도 묻지 않고 저장도 하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(updateMyDisplayName("", repo)).resolves.toEqual({
      status: "invalid",
      message: "표시 이름을 입력하세요",
    });
    expect(repo.currentUserId).not.toHaveBeenCalled();
    expect(repo.updateDisplayName).not.toHaveBeenCalled();
  });

  it("로그인 전이거나 DB 설정이 없으면 저장하지 않는다", async () => {
    const signedOut = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(updateMyDisplayName("홍길동", signedOut)).resolves.toEqual({
      status: "signed-out",
    });
    expect(signedOut.updateDisplayName).not.toHaveBeenCalled();

    const noDatabase = fakeRepo({ isConfigured: () => false });
    await expect(updateMyDisplayName("홍길동", noDatabase)).resolves.toEqual({
      status: "signed-out",
    });
    expect(noDatabase.currentUserId).not.toHaveBeenCalled();
  });

  it("고친 행이 없으면 저장됐다고 하지 않고 오류를 올린다", async () => {
    const repo = fakeRepo({ updateDisplayName: vi.fn(async () => false) });
    await expect(updateMyDisplayName("홍길동", repo)).rejects.toThrow("profiles 행이 없거나");
  });
});

describe("deleteMyAccount", () => {
  it("로그인한 사람이면 탈퇴를 부르고 결과를 그대로 돌려준다", async () => {
    const repo = fakeRepo();
    await expect(deleteMyAccount(repo)).resolves.toEqual({ status: "deleted" });
    expect(repo.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it.each(["sole-owner", "sole-admin", "suspended"] as const)(
    "DB 가 %s 로 거절하면 그 이유를 그대로 돌려준다",
    async (refusal) => {
      const repo = fakeRepo({ deleteAccount: vi.fn(async () => refusal) });
      await expect(deleteMyAccount(repo)).resolves.toEqual({ status: refusal });
    },
  );

  it("로그인 전이면 탈퇴를 부르지 않는다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(deleteMyAccount(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.deleteAccount).not.toHaveBeenCalled();
  });

  it("DB 설정이 없으면 로그인 여부도 묻지 않고 탈퇴를 부르지 않는다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(deleteMyAccount(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.currentUserId).not.toHaveBeenCalled();
    expect(repo.deleteAccount).not.toHaveBeenCalled();
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({
      deleteAccount: vi.fn(async () => Promise.reject(new Error("db down"))),
    });
    await expect(deleteMyAccount(repo)).rejects.toThrow("db down");
  });
});
