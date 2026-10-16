import "server-only";

// ── 배럴: auth 도메인의 공개 API. 바깥(app·components)은 @/server/auth 만 부른다 ──
export {
  authenticate,
  completeOAuthSignIn,
  confirmEmailLink,
  getMyLoginMethods,
  signOutEverywhere,
  unlinkMyLoginMethod,
} from "./auth.service";
export { safeNextPath } from "./auth.model";
export type {
  Authentication,
  AuthUser,
  LinkFailure,
  LinkOutcome,
  LoginMethod,
  MyLoginMethods,
  UnlinkResult,
} from "./auth.model";
