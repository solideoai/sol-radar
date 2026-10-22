import { describe, expect, it } from "vitest";
import { projectEntryOf, projectPatchSchema, warningsOf } from "./project.model";

describe("project lifecycle rules", () => {
  it("non-BID warns without closing and a closed project needs a later BID to reopen", () => {
    expect(
      warningsOf({
        status: "PREPARING",
        latestDecision: "WATCH",
        openedRevision: 1,
        latestRevision: 2,
        bidStatus: "AMENDED",
      }),
    ).toEqual({ latestDecision: "WATCH", bidAmended: true, bidCancelled: false });
    const input = {
      project: {
        id: "project",
        status: "CLOSED" as const,
        closedAt: "2026-10-22T00:00:00Z",
        result: "WON" as const,
      },
      bidStatus: "OPEN" as const,
      canManage: true,
    };
    expect(
      projectEntryOf({
        ...input,
        latestDecision: { id: "review", decision: "BID", decidedAt: "2026-10-21T00:00:00Z" },
      }).state,
    ).toBe("closed");
    expect(
      projectEntryOf({
        ...input,
        latestDecision: { id: "review", decision: "BID", decidedAt: "2026-10-23T00:00:00Z" },
      }).state,
    ).toBe("reopen");
  });
  it("KST deadline normalizes while unknown fields and empty patches are rejected", () => {
    expect(projectPatchSchema.parse({ submissionDueOverride: "2026-12-01T18:00:00" })).toEqual({
      submissionDueOverride: "2026-12-01T09:00:00.000Z",
    });
    expect(projectPatchSchema.safeParse({ orgId: "other", status: "SUBMITTED" }).success).toBe(
      false,
    );
    expect(projectPatchSchema.safeParse({}).success).toBe(false);
  });
});
