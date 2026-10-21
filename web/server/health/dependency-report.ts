import "server-only";
import { z } from "zod";

export const DEPENDENCY_HEALTH_KEY = "sol-radar:dependency-health";
export const DEPENDENCY_HEALTH_TTL_MS = 120_000;
export type DependencyScope = {
  runMode: string;
  supabaseUrl: string;
  rawBucket: string;
  parsedBucket: string;
};
const reportSchema = z.object({
  checkedAt: z.number().finite(),
  scope: z.object({
    runMode: z.string(),
    supabaseUrl: z.string(),
    rawBucket: z.string(),
    parsedBucket: z.string(),
  }),
  storage: z.enum(["ok", "unavailable"]),
  ai: z.enum(["mock", "local", "hosted", "unavailable"]),
});
export type DependencyReport = z.infer<typeof reportSchema>;
export function parseDependencyReport(
  value: string | null,
  scope: DependencyScope,
  now = Date.now(),
): DependencyReport | null {
  if (!value) return null;
  try {
    const report = reportSchema.parse(JSON.parse(value));
    if (report.checkedAt > now + 5_000 || now - report.checkedAt > DEPENDENCY_HEALTH_TTL_MS)
      return null;
    if (
      Object.entries(scope).some(
        ([key, expected]) => report.scope[key as keyof DependencyScope] !== expected,
      )
    )
      return null;
    return report;
  } catch {
    return null;
  }
}
