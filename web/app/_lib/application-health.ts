import "server-only";
import { getAiState, getReadiness, type AiState } from "@/server/health";
import { deploymentRole } from "./deployment-role";
import { readRedisApiReadiness } from "./redis-api-client";

export async function getApplicationReadiness() {
  if (deploymentRole() === "frontend") return readRedisApiReadiness();
  return getReadiness();
}

export async function getApplicationAiState(): Promise<AiState> {
  if (deploymentRole() === "frontend") return (await readRedisApiReadiness()).body.checks.ai;
  return getAiState();
}
