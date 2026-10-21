import "server-only";
import { z } from "zod";
import { whatIf, type WhatIfSummary } from "@/server/scoring";
import type { BidsRepo } from "./bids.repo";
import { fail, issuesOf, type ServiceResult } from "./bids.service";

// 가정 재계산(BOOST-2). 저장된 입력 스냅샷에 "이 자격이 있다면"을 얹어 규칙 엔진을 다시 돌린다.
// 읽기 계산이라 역할 제한이 없고, 저장소에는 스냅샷 읽기 한 번만 한다(쓰기 0).
const whatIfBodySchema = z.strictObject({
  assumptions: z
    .array(z.strictObject({ kind: z.literal("QUALIFICATION"), code: z.string().min(1).max(64) }))
    .max(10),
});

export type WhatIfData = { assumable: string[]; before: WhatIfSummary; after: WhatIfSummary };

const noAnalysis = () =>
  fail(404, "NOT_FOUND", "분석을 찾을 수 없습니다", { resource: "analysis" });
const noSnapshot = () =>
  fail(404, "NOT_FOUND", "가정 재계산에 쓸 입력 스냅샷이 없습니다", {
    resource: "analysis",
    reason: "NO_SNAPSHOT",
  });

export async function computeWhatIf(
  orgId: string,
  id: string,
  body: unknown,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<WhatIfData>> {
  const parsed = whatIfBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
      issues: issuesOf(parsed.error),
    });
  }

  const run = await deps.repo.getAnalysisSnapshot(orgId, id);
  if (run === null) return noAnalysis();
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return fail(409, "ANALYSIS_IN_PROGRESS", "분석이 아직 진행 중입니다");
  }
  if (run.status === "FAILED") return noSnapshot();

  const outcome = whatIf(run.inputSnapshot, parsed.data.assumptions);
  if (outcome === null) return noSnapshot();
  if (!outcome.ok) {
    return fail(400, "VALIDATION_ERROR", "가정할 수 없는 자격이 있습니다", {
      issues: [{ path: "assumptions", message: "가정할 수 없는 자격이 포함되어 있습니다" }],
      rejected: outcome.rejected,
    });
  }
  const { assumable, before, after } = outcome;
  return { ok: true, status: 200, data: { assumable, before, after } };
}
