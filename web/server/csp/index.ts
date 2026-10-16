import "server-only";

// ── 배럴: CSP 정책의 공개 API. proxy.ts 가 부른다 ──
export { buildContentSecurityPolicy } from "./csp.model";
export type { ContentSecurityPolicyOptions } from "./csp.model";
