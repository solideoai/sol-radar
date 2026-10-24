import "server-only";

// ── 모델: 사진 포인터 저장 결과. 저장·화면을 모른다 ──

// 예상한 실패는 던지지 않고 값으로 돌려준다(서버 함수가 던진 message 는 운영 브라우저로 가지 않는다).
export type PhotoSaveResult =
  { status: "saved" } | { status: "signed-out" } | { status: "invalid" } | { status: "forbidden" };

/** DB 함수(set_my_photo·set_member_photo)가 올린 오류. 무엇인지는 hint 로 가른다. */
export type PhotoDbError = { code: string; hint: string };

const RAISED = "P0001";
const BY_HINT: Record<string, PhotoSaveResult> = {
  not_active: { status: "signed-out" },
  invalid_photo_path: { status: "invalid" },
  forbidden: { status: "forbidden" },
};

/** 오류가 없으면 saved. 아는 hint 는 결과로, 모르는 오류는 그대로 던진다. */
export function toPhotoSaveResult(error: PhotoDbError | null): PhotoSaveResult {
  if (!error) return { status: "saved" };
  const known = error.code === RAISED ? BY_HINT[error.hint] : undefined;
  if (known) return known;
  throw Object.assign(new Error("사진 저장 DB 함수가 예상하지 못한 오류를 냈습니다"), {
    cause: error,
  });
}
