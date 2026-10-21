import "server-only";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { callableSource, loadSourceRegistry } from "@/server/ingestion";
import { getSourceSummary, type SourceServiceConfig } from "@/server/opportunities";

const SERVICE_IDS = new Set([
  "15129394",
  "15129437",
  "15129462",
  "15129467",
  "15101635",
  "15159012",
  "15102588",
  "15159011",
  "15129468",
  "15148223",
]);
export async function sourceServiceReadiness(serviceKey: string) {
  const registry = await loadSourceRegistry(
    process.env.SOURCES_REGISTRY_FILE?.trim() ||
      path.resolve(process.cwd(), "../infra/sources/registry.yaml"),
  );
  const result = callableSource(registry, serviceKey);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
export async function loadSourceSummary(
  client: SupabaseClient<Database>,
  origin: "live" | "demo" | "all",
) {
  const registry = await loadSourceRegistry(
    process.env.SOURCES_REGISTRY_FILE?.trim() ||
      path.resolve(process.cwd(), "../infra/sources/registry.yaml"),
  );
  const seen = new Set<string>();
  const configs: SourceServiceConfig[] = [];
  for (const entry of registry.sources) {
    if (!entry.serviceId || !SERVICE_IDS.has(entry.serviceId) || seen.has(entry.serviceId))
      continue;
    seen.add(entry.serviceId);
    const readiness = callableSource(registry, entry.key);
    configs.push({
      key: entry.key,
      serviceId: entry.serviceId,
      displayName: entry.displayName,
      sourceFamily: entry.sourceFamily ?? "G2B",
      enabled: readiness.ok,
      blockedReason: readiness.ok ? null : readiness.reason,
      keyIssuance:
        entry.keyIssuance ?? (entry.approvalStatus === "APPROVED" ? "ISSUED" : "UNKNOWN"),
    });
  }
  return getSourceSummary(client, origin, configs);
}
