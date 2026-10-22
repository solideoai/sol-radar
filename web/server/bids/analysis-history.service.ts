import "server-only";
import { cursorScope } from "./bid-query";
import type { Page } from "./bid.model";
import { paginate, type ServiceResult } from "./bids.service";
import type {
  AnalysisHistoryItem,
  AnalysisHistoryQuery,
  AnalysisHistoryRepo,
} from "./analysis-history.model";

export function listAnalysisHistory(
  orgId: string,
  query: AnalysisHistoryQuery,
  deps: { repo: AnalysisHistoryRepo; cursorSecret: string | null },
): Promise<ServiceResult<Page<AnalysisHistoryItem>>> {
  const scope = cursorScope("analyses", [
    "organization-history",
    orgId,
    query.bidId,
    query.status,
    query.recommendation,
    query.runMode,
  ]);
  return paginate(scope, query, deps.cursorSecret, (after) => deps.repo.list(orgId, query, after));
}
