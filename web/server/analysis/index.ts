import "server-only";

// ── analysis 도메인 배럴. 바깥(worker·화면)은 이 파일만 부른다 ──
export { createGatewayClient } from "./gateway.client";
export type { GatewayClient, GatewayClientDeps } from "./gateway.client";
export { extractRequestSchema, readGatewayConfig } from "./gateway.model";
export type {
  ExplainResponse,
  ExtractRequest,
  ExtractResponse,
  GatewayConfig,
  GatewayFailure,
  GatewayHealth,
  GatewayRequestBody,
  GatewayResult,
  KevResponse,
} from "./gateway.model";
export type { BreakerState } from "./circuit-breaker.model";
export {
  pickAiUnavailableReason,
  toExplainOutcome,
  toExtractionOutcome,
  toKevOutcome,
} from "./fallback.model";
export type {
  AiUnavailableReason,
  ExplainOutcome,
  ExtractionOutcome,
  KevOutcome,
} from "./fallback.model";
