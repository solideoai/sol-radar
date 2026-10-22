import "server-only";

export type RedisApiOperation =
  "health" | "ai-status" | "analysis-submit" | "analysis-read" | "ingest-submit" | "ingest-read";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ANALYSIS_SUBMIT = new RegExp(`^/api/v1/bids/${UUID}/analyses$`);
const ANALYSIS_READ = new RegExp(`^/api/v1/analyses/${UUID}$`);
const INGEST_READ = new RegExp(`^/api/v1/admin/ingestion/runs/${UUID}$`);

export function redisApiOperation(method: string, path: string): RedisApiOperation | null {
  if (method === "GET" && path === "/health") return "health";
  if (method === "GET" && path === "/api/v1/admin/ai/status") return "ai-status";
  if (method === "POST" && ANALYSIS_SUBMIT.test(path)) return "analysis-submit";
  if (method === "GET" && ANALYSIS_READ.test(path)) return "analysis-read";
  if (method === "POST" && path === "/api/v1/admin/ingestion/runs") return "ingest-submit";
  if (method === "GET" && INGEST_READ.test(path)) return "ingest-read";
  return null;
}
