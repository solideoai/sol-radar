import "server-only";
import {
  parseOpportunityQuery,
  serializeOpportunityQuery,
  type OpportunityQuery,
} from "@/server/opportunities";
import type { RunMode } from "@/server/bids";

type Raw = Readonly<Record<string, string | string[] | undefined>>;

export function listQueryOf(
  raw: Raw,
  runMode: RunMode,
): { query: OpportunityQuery; search: string; notice: string | null } {
  const values: Record<string, string | string[] | undefined> = {
    ...raw,
    cursor: undefined,
    limit: undefined,
  };
  let notice: string | null = null;
  const attempts = Object.keys(values).length + 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const parsed = parseOpportunityQuery(values, runMode);
    if (parsed.ok) {
      const params = new URLSearchParams(serializeOpportunityQuery(parsed.value));
      params.delete("cursor");
      params.delete("limit");
      return { query: parsed.value, search: params.toString(), notice };
    }
    notice = "일부 검색 조건이 올바르지 않아 기본값으로 변경했습니다.";
    const keys = parsed.issues.map((issue) => issue.path.split(".")[0]);
    const early = Array.isArray(values.stage) ? values.stage : values.stage ? [values.stage] : [];
    if (
      keys.includes("includeEarly") &&
      early.some((stage) => ["PLAN", "PROCUREMENT_REQUEST", "PRE_SPEC"].includes(stage))
    )
      values.includeEarly = "true";
    else for (const key of keys) delete values[key];
  }
  const fallback = parseOpportunityQuery({}, runMode);
  if (!fallback.ok) throw new Error("기본 목록 조건을 만들지 못했습니다");
  return { query: fallback.value, search: "", notice };
}
