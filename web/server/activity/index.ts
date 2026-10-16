import "server-only";

// ── 배럴: activity 도메인의 공개 API. 바깥(app·components)은 @/server/activity 만 부른다 ──
export { getRecentActivities } from "./activity.service";
export { ACTIVITY_KINDS, RECENT_ACTIVITY_COUNT } from "./activity.model";
export type { ActivityKind, ActivityScope, ActivityView } from "./activity.model";
