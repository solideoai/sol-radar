import "server-only";

// ── 배럴: profile 도메인의 공개 API. 바깥(app·components)은 @/server/profile 만 부른다 ──
export { deleteMyAccount, getMyProfile, updateMyDisplayName } from "./profile.service";
export type {
  DeleteAccountResult,
  DisplayNameResult,
  MyProfile,
  ProfileView,
} from "./profile.model";
