import "server-only";
import { describe, expect, it } from "vitest";
import { isMemberPhotoPath, isOwnPhotoPath } from "@/server/shared";
import { toPhotoSaveResult } from "./photo.model";

const user = "00000000-0000-4000-8000-000000000001";
const member = "5e000000-0000-4000-8000-000000000001";
const photo = "0a1b2c3d-0000-4000-8000-00000000abcd";

describe("사진 경로 규칙", () => {
  it("본인 경로는 users/<내 id>/<uuid>.jpg|png|webp 만 맞다", () => {
    expect(isOwnPhotoPath(`users/${user}/${photo}.jpg`, user)).toBe(true);
    expect(isOwnPhotoPath(`users/${user}/${photo}.webp`, user)).toBe(true);
    for (const path of [
      `users/${member}/${photo}.jpg`,
      `users/${user}/../${photo}.jpg`,
      `users/${user}/${photo.toUpperCase()}.jpg`,
      `users/${user}/${photo}.gif`,
      `members/${user}/${photo}.jpg`,
      `/users/${user}/${photo}.jpg`,
    ])
      expect(isOwnPhotoPath(path, user)).toBe(false);
  });
  it("직원 경로는 members/<그 직원 id>/<uuid>.jpg|png|webp 만 맞다", () => {
    expect(isMemberPhotoPath(`members/${member}/${photo}.png`, member)).toBe(true);
    expect(isMemberPhotoPath(`members/${user}/${photo}.png`, member)).toBe(false);
    expect(isMemberPhotoPath(`users/${member}/${photo}.png`, member)).toBe(false);
  });
});

describe("사진 저장 결과", () => {
  it("DB 함수 hint 를 화면 결과로 바꾸고 모르는 오류는 던진다", () => {
    expect(toPhotoSaveResult(null)).toEqual({ status: "saved" });
    expect(toPhotoSaveResult({ code: "P0001", hint: "not_active" })).toEqual({
      status: "signed-out",
    });
    expect(toPhotoSaveResult({ code: "P0001", hint: "invalid_photo_path" })).toEqual({
      status: "invalid",
    });
    expect(toPhotoSaveResult({ code: "P0001", hint: "forbidden" })).toEqual({
      status: "forbidden",
    });
    expect(() => toPhotoSaveResult({ code: "42501", hint: "" })).toThrow();
  });
});
