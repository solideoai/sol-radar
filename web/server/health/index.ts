import "server-only";

// ── 배럴: health 도메인의 공개 API. 바깥(app)은 @/server/health 만 부른다 ──
export { getAiState, getReadiness } from "./health.service";
export type { Probes } from "./health.service";
export type { AiState, CheckState, Readiness } from "./health.model";

// 05 §2 GET /admin/ai/status(ADMIN). 응답 계약은 aiStatusSchema 다.
export { getAiStatus } from "./ai-status.service";
export type { AiStatusDeps, AiStatusResult } from "./ai-status.service";
export { aiStatusSchema } from "./ai-status.model";
export type { AiStatus } from "./ai-status.model";
