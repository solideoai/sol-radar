import "server-only";

export type RedisApiOperation =
  | "health"
  | "ai-status"
  | "analysis-submit"
  | "analysis-read"
  | "insight-submit"
  | "ingest-submit"
  | "ingest-read"
  | "ingest-gate-read";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ANALYSIS_SUBMIT = new RegExp(`^/api/v1/bids/${UUID}/analyses$`);
const ANALYSIS_READ = new RegExp(`^/api/v1/analyses/${UUID}$`);
const INSIGHT_SUBMIT = new RegExp(`^/api/v1/bids/${UUID}/analyses/${UUID}/insight$`);
const INGEST_READ = new RegExp(`^/api/v1/admin/ingestion/runs/${UUID}$`);

export function redisApiOperation(method: string, path: string): RedisApiOperation | null {
  if (method === "GET" && path === "/health") return "health";
  if (method === "GET" && path === "/api/v1/admin/ai/status") return "ai-status";
  if (method === "POST" && ANALYSIS_SUBMIT.test(path)) return "analysis-submit";
  if (method === "GET" && ANALYSIS_READ.test(path)) return "analysis-read";
  // 추천 분석은 요청(POST)만 회사 API 가 받는다. 결과 읽기(GET)는 frontend 가 사용자 세션(RLS)으로 직접 읽는다.
  if (method === "POST" && INSIGHT_SUBMIT.test(path)) return "insight-submit";
  if (method === "POST" && path === "/api/v1/admin/ingestion/runs") return "ingest-submit";
  if (method === "GET" && INGEST_READ.test(path)) return "ingest-read";
  // 수동 수집 gate·정기 일정 상태. 쿼리 없이 정확한 경로만 받는다.
  if (method === "GET" && path === "/api/v1/admin/ingestion/manual-gate") return "ingest-gate-read";
  return null;
}
