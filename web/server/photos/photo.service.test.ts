import "server-only";
import { describe, expect, it, vi } from "vitest";
import type { PhotoRepo } from "./photo.repo";
import { saveMemberPhoto, saveMyPhoto, signPhotoPaths } from "./photo.service";

const me = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const memberA = "5e000000-0000-4000-8000-000000000001";
const memberB = "5e000000-0000-4000-8000-000000000002";
const photo = "0a1b2c3d-0000-4000-8000-00000000abcd";

const fakeRepo = (overrides: Partial<PhotoRepo> = {}): PhotoRepo => ({
  isConfigured: () => true,
  currentUserId: vi.fn(async () => me),
  setMyPhoto: vi.fn(async () => null),
  setMemberPhoto: vi.fn(async () => null),
  signPaths: vi.fn(async () => new Map<string, string>()),
  ...overrides,
});

describe("saveMemberPhoto", () => {
  it("uuid 가 아닌 직원 id 와 다른 직원 경로는 DB 를 부르기 전에 invalid 다", async () => {
    const repo = fakeRepo();
    expect(await saveMemberPhoto("not-a-uuid", null, repo)).toEqual({ status: "invalid" });
    expect(await saveMemberPhoto(memberA, `members/${memberB}/${photo}.jpg`, repo)).toEqual({
      status: "invalid",
    });
    expect(await saveMemberPhoto(memberA, 42, repo)).toEqual({ status: "invalid" });
    expect(repo.setMemberPhoto).not.toHaveBeenCalled();
  });
  it("관리자가 아니게 된 사람의 저장은 DB 의 forbidden 을 그대로 알린다", async () => {
    const repo = fakeRepo({
      setMemberPhoto: vi.fn(async () => ({ code: "P0001", hint: "forbidden" })),
    });
    expect(await saveMemberPhoto(memberA, `members/${memberA}/${photo}.jpg`, repo)).toEqual({
      status: "forbidden",
    });
    expect(repo.setMemberPhoto).toHaveBeenCalledWith(memberA, `members/${memberA}/${photo}.jpg`);
  });
});

describe("saveMyPhoto", () => {
  it("남의 경로는 invalid, 로그인 전은 signed-out, null 은 사진 지우기다", async () => {
    const repo = fakeRepo();
    expect(await saveMyPhoto(`users/${other}/${photo}.jpg`, repo)).toEqual({ status: "invalid" });
    expect(repo.setMyPhoto).not.toHaveBeenCalled();
    expect(await saveMyPhoto(null, repo)).toEqual({ status: "saved" });
    expect(repo.setMyPhoto).toHaveBeenCalledWith(null);
    const signedOut = fakeRepo({ currentUserId: vi.fn(async () => null) });
    expect(await saveMyPhoto(`users/${me}/${photo}.jpg`, signedOut)).toEqual({
      status: "signed-out",
    });
  });
});

describe("signPhotoPaths", () => {
  it("경로가 없으면 Storage 를 부르지 않고 같은 경로는 한 번만 서명한다", async () => {
    const repo = fakeRepo();
    expect((await signPhotoPaths([], repo)).size).toBe(0);
    expect(repo.signPaths).not.toHaveBeenCalled();
    await signPhotoPaths(["a.jpg", "a.jpg", "b.jpg"], repo);
    expect(repo.signPaths).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
  });
});
