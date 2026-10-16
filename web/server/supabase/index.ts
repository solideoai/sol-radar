import "server-only";

// ── 배럴: 인프라(데이터베이스 접속)의 공개 API ──
export {
  getAuthClaims,
  getAuthContext,
  getSupabase,
  getSupabaseAdmin,
  isSupabaseConfigured,
  unlinkAuthIdentity,
} from "./client";
export type { AuthContext } from "./client";
export type { AuthClaims } from "./claims";
export { refreshSession } from "./session";
