import { describe, expect, it } from "vitest";
import { centerSquare, checkPhotoFile, newPhotoPath, ownPhotoCleanupPaths } from "./photo-file";

describe("checkPhotoFile", () => {
  it("JPG·PNG·WEBP 이고 0바이트 초과 10MB 이하일 때만 받는다", () => {
    expect(checkPhotoFile({ type: "image/heic", size: 1 })).toBe(
      "JPG·PNG·WEBP 사진만 올릴 수 있습니다",
    );
    expect(checkPhotoFile({ type: "image/gif", size: 1 })).toBe(
      "JPG·PNG·WEBP 사진만 올릴 수 있습니다",
    );
    expect(checkPhotoFile({ type: "image/png", size: 0 })).toBe("빈 파일입니다");
    expect(checkPhotoFile({ type: "image/jpeg", size: 10_485_761 })).toBe(
      "10MB 이하 사진을 골라 주세요",
    );
    expect(checkPhotoFile({ type: "image/jpeg", size: 10_485_760 })).toBeNull();
    expect(checkPhotoFile({ type: "image/webp", size: 1000 })).toBeNull();
  });
});

describe("centerSquare", () => {
  it("긴 쪽의 가운데를 짧은 쪽 길이의 정사각형으로 자른다", () => {
    expect(centerSquare(4000, 1000)).toEqual({ sx: 1500, sy: 0, size: 1000 });
    expect(centerSquare(800, 1200)).toEqual({ sx: 0, sy: 200, size: 800 });
    expect(centerSquare(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
    expect(centerSquare(1001, 1000)).toEqual({ sx: 0, sy: 0, size: 1000 });
  });
});

describe("newPhotoPath", () => {
  it("접두사 아래에 id.jpg 로 만든다", () => {
    expect(newPhotoPath("users/u", "i")).toBe("users/u/i.jpg");
  });
});

describe("ownPhotoCleanupPaths", () => {
  it("본인 폴더만 전체 경로로 돌려주고 members/ 는 정리하지 않는다", () => {
    const me = "users/00000000-0000-4000-8000-000000000001";
    expect(ownPhotoCleanupPaths(me, ["a.jpg", "b.jpg"])).toEqual([`${me}/a.jpg`, `${me}/b.jpg`]);
    expect(ownPhotoCleanupPaths("members/00000000-0000-4000-8000-000000000002", ["a.jpg"])).toEqual(
      [],
    );
  });
});
