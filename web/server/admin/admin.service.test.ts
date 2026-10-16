import { describe, expect, it, vi } from "vitest";
import type { UserRow } from "./admin.model";
import type { AdminRepo } from "./admin.repo";
import { getAdminAccess, getUserList, setUserStatus } from "./admin.service";

const ADMIN = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";

const userRow = (index: number): UserRow => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  email: `user${index}@example.com`,
  display_name: null,
  is_admin: false,
  status: "active",
  created_at: "2026-10-14T06:00:00.000Z",
});

// 저장 자리에 가짜를 꽂는다. 실제 Supabase 는 부르지 않는다(누가 무엇을 읽는지는 DB 정책 시험이 본다).
const fakeRepo = (overrides: Partial<AdminRepo> = {}): AdminRepo => ({
  isConfigured: () => true,
  currentUserId: vi.fn(async () => ADMIN),
  isAdmin: vi.fn(async () => true),
  setUserStatus: vi.fn(async () => "saved" as const),
  listUsers: vi.fn(async () => ({ rows: [userRow(1)], total: 1 })),
  ...overrides,
});

describe("getAdminAccess", () => {
  it("로그인한 운영자면 ready 와 그 사람의 id 다", async () => {
    const repo = fakeRepo();
    await expect(getAdminAccess(repo)).resolves.toEqual({ status: "ready", userId: ADMIN });
    expect(repo.isAdmin).toHaveBeenCalledWith(ADMIN);
  });

  it("운영자가 아니면 forbidden 이다", async () => {
    const repo = fakeRepo({ isAdmin: vi.fn(async () => false) });
    await expect(getAdminAccess(repo)).resolves.toEqual({ status: "forbidden" });
  });

  it("로그인 전이면 운영자인지 묻지 않는다", async () => {
    const repo = fakeRepo({ currentUserId: vi.fn(async () => null) });
    await expect(getAdminAccess(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.isAdmin).not.toHaveBeenCalled();
  });

  it("DB 설정이 없으면 로그인 여부를 묻지 않는다", async () => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(getAdminAccess(repo)).resolves.toEqual({ status: "no-database" });
    expect(repo.currentUserId).not.toHaveBeenCalled();
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ isAdmin: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getAdminAccess(repo)).rejects.toThrow("db down");
  });
});

describe("getUserList", () => {
  it("운영자에게 검색어와 쪽에 맞는 한 쪽을 화면 모양으로 돌려준다", async () => {
    const repo = fakeRepo({
      listUsers: vi.fn(async () => ({ rows: [userRow(21), userRow(22)], total: 42 })),
    });
    const result = await getUserList({ q: " kim ", page: "2" }, repo);
    expect(repo.listUsers).toHaveBeenCalledWith("kim", 20, 20);
    expect(result).toMatchObject({
      status: "ready",
      list: { total: 42, page: 2, pageCount: 3, pageSize: 20, q: "kim" },
    });
    expect(result.status === "ready" && result.list.rows.map((row) => row.email)).toEqual([
      "user21@example.com",
      "user22@example.com",
    ]);
  });

  it("운영자 자신의 줄에 isMe 를 붙인다", async () => {
    const repo = fakeRepo({
      listUsers: vi.fn(async () => ({
        rows: [{ ...userRow(1), id: ADMIN, is_admin: true }, userRow(2)],
        total: 2,
      })),
    });
    const result = await getUserList({}, repo);
    expect(result.status === "ready" && result.list.rows.map((row) => row.isMe)).toEqual([
      true,
      false,
    ]);
  });

  it("잘못된 쿼리는 기본값(검색 없음·1쪽)으로 읽는다", async () => {
    const repo = fakeRepo();
    await getUserList({ q: "", page: "abc" }, repo);
    expect(repo.listUsers).toHaveBeenCalledWith(null, 0, 20);
  });

  it("범위를 넘는 쪽은 1쪽을 다시 읽어 보여 준다", async () => {
    const listUsers = vi
      .fn<AdminRepo["listUsers"]>()
      .mockResolvedValueOnce("out-of-range")
      .mockResolvedValueOnce({ rows: [userRow(1)], total: 1 });
    const repo = fakeRepo({ listUsers });
    const result = await getUserList({ q: "kim", page: "9" }, repo);
    expect(listUsers.mock.calls).toEqual([
      ["kim", 160, 20],
      ["kim", 0, 20],
    ]);
    expect(result).toMatchObject({ status: "ready", list: { page: 1, pageCount: 1, q: "kim" } });
  });

  it("1쪽마저 범위를 넘으면 저장과 코드가 어긋난 것이라 던진다", async () => {
    const repo = fakeRepo({ listUsers: vi.fn(async () => "out-of-range" as const) });
    await expect(getUserList({}, repo)).rejects.toThrow("1쪽을 읽지 못했습니다");
  });

  it("사용자가 없어도 1쪽짜리 빈 목록이다", async () => {
    const repo = fakeRepo({ listUsers: vi.fn(async () => ({ rows: [], total: 0 })) });
    await expect(getUserList({ q: "없는 사람" }, repo)).resolves.toEqual({
      status: "ready",
      list: { rows: [], total: 0, page: 1, pageCount: 1, pageSize: 20, q: "없는 사람" },
    });
  });

  it.each([
    ["운영자가 아니면", { isAdmin: vi.fn(async () => false) }, "forbidden"],
    ["로그인 전이면", { currentUserId: vi.fn(async () => null) }, "signed-out"],
    ["DB 설정이 없으면", { isConfigured: () => false }, "no-database"],
  ] as const)("%s 목록을 읽지 않고 그 상태만 돌려준다", async (_, overrides, status) => {
    const repo = fakeRepo(overrides);
    await expect(getUserList({ q: "kim" }, repo)).resolves.toEqual({ status });
    expect(repo.listUsers).not.toHaveBeenCalled();
  });
});

describe("setUserStatus", () => {
  const TARGET = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

  it("운영자면 고른 회원의 상태를 DB 함수로 바꾼다", async () => {
    const repo = fakeRepo();
    await expect(setUserStatus(TARGET, "suspended", repo)).resolves.toEqual({ status: "saved" });
    expect(repo.isAdmin).toHaveBeenCalledWith(ADMIN);
    expect(repo.setUserStatus).toHaveBeenCalledWith(TARGET, "suspended");
  });

  it("대문자 id 는 소문자로 맞춰 넘긴다", async () => {
    const repo = fakeRepo();
    await setUserStatus(TARGET.toUpperCase(), "active", repo);
    expect(repo.setUserStatus).toHaveBeenCalledWith(TARGET, "active");
  });

  it.each([
    ["uuid 가 아닌 id", "abc", "suspended"],
    ["모르는 상태", TARGET, "deleted"],
    ["없는 상태", TARGET, undefined],
  ])("%s 는 운영자인지 묻기 전에 invalid 다", async (_, userId, status) => {
    const repo = fakeRepo();
    await expect(setUserStatus(userId, status, repo)).resolves.toEqual({ status: "invalid" });
    expect(repo.currentUserId).not.toHaveBeenCalled();
    expect(repo.isAdmin).not.toHaveBeenCalled();
    expect(repo.setUserStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["운영자가 아니면", { isAdmin: vi.fn(async () => false) }, "forbidden"],
    ["로그인 전이면", { currentUserId: vi.fn(async () => null) }, "signed-out"],
    ["DB 설정이 없으면", { isConfigured: () => false }, "no-database"],
  ] as const)("%s 상태를 바꾸지 않고 그 상태만 돌려준다", async (_, overrides, status) => {
    const repo = fakeRepo(overrides);
    await expect(setUserStatus(TARGET, "suspended", repo)).resolves.toEqual({ status });
    expect(repo.setUserStatus).not.toHaveBeenCalled();
  });

  it.each(["saved", "forbidden", "invalid", "self", "admin-target", "not-found"] as const)(
    "DB 함수의 결과 %s 를 그대로 돌려준다",
    async (result) => {
      const repo = fakeRepo({ setUserStatus: vi.fn(async () => result) });
      await expect(setUserStatus(TARGET, "active", repo)).resolves.toEqual({ status: result });
    },
  );

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({
      setUserStatus: vi.fn(async () => Promise.reject(new Error("db down"))),
    });
    await expect(setUserStatus(TARGET, "active", repo)).rejects.toThrow("db down");
  });
});
