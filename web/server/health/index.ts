import "server-only";

// ── 배럴: health 도메인의 공개 API. 바깥(app)은 @/server/health 만 부른다 ──
export { getReadiness } from "./health.service";
export type { Probes } from "./health.service";
export type { AiState, CheckState, Readiness } from "./health.model";
