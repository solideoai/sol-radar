// 프로필 사진 규칙(20261024000200). 서버와 브라우저가 함께 쓴다 — 이 파일은 아무것도 import 하지 않는다.
// 버킷 크기·형식은 scripts/ops/ensure-storage-buckets.mjs, 경로 규칙은 migration 의 정규식과 같아야 한다.
export const PHOTO_BUCKET = "profile-photos";
/** 버킷이 받는 최대 크기. 브라우저가 512px JPEG 로 줄여 올리므로 보통 200KB 안쪽이다. */
export const PHOTO_MAX_BYTES = 2_097_152;
/** 고를 수 있는 원본 파일의 최대 크기. 줄이기 전 크기다. */
export const PHOTO_INPUT_MAX_BYTES = 10_485_760;
export const PHOTO_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_SIZE_PX = 512;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID = new RegExp(`^${UUID}$`);
const pathOf = (prefix: "users" | "members", id: string) =>
  new RegExp(`^${prefix}/${id}/${UUID}\\.(jpg|png|webp)$`);

/** users/<내 id>/<uuid>.(jpg|png|webp) 인가. 내 id 도 소문자 uuid 여야 한다. */
export const isOwnPhotoPath = (path: string, userId: string): boolean =>
  ID.test(userId) && pathOf("users", userId).test(path);

/** members/<그 직원 id>/<uuid>.(jpg|png|webp) 인가. */
export const isMemberPhotoPath = (path: string, memberId: string): boolean =>
  ID.test(memberId) && pathOf("members", memberId).test(path);
