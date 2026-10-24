import "server-only";

// ── 배럴: photos 도메인의 공개 API. 바깥은 @/server/photos 만 부른다 ──
export { saveMemberPhoto, saveMyPhoto, signPhotoPaths } from "./photo.service";
export type { PhotoSaveResult } from "./photo.model";
