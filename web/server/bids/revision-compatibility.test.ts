import "server-only";
import { expect, it } from "vitest";
import { compareBidRevision } from "./revision.service";
import { toRevisionChanges } from "./revision-diff";
import { revisionSnapshotSchema } from "./revision.model";

it("compares nullable agencies and structured qualification JSON without losing values", () => {
  const before = revisionSnapshotSchema.parse({ agency: null, structuredQualifications: [] });
  const after = revisionSnapshotSchema.parse({
    agency: "기관",
    structuredQualifications: [{ name: null, code: "1468", value: { minimum: 3 } }],
  });
  expect(toRevisionChanges(["agency", "structuredQualifications"], before, after)).toEqual([
    {
      field: "structuredQualifications",
      kind: "list",
      added: ['1468 {"minimum":3}'],
      removed: [],
      kept: [],
    },
    { field: "agency", kind: "scalar", before: null, after: "기관" },
  ]);
});

it("compares the requested revision with its immediate predecessor using persisted changed fields", async () => {
  const summary = (revision: number) => ({
    id: `r${revision}`,
    checksum: `sum${revision}`,
    revision,
    amendmentNo: null,
    fetchedAt: "2026-10-22T00:00:00Z",
    changedFields: ["budgetKrw", "content", "sourceMetadata"],
  });
  const result = await compareBidRevision("org", "bid", 2, {
    repo: {
      getRevisionHistory: async () => ({
        title: "공고",
        revisions: [summary(3), summary(2), summary(1)],
      }),
      getRevisionSnapshots: async (_bidId, revisions) =>
        revisions.map((revision) => ({
          revision,
          normalized: {
            budgetKrw: revision === 1 ? "100" : "200",
            content: revision === 1 ? "Spark 3.0 지원" : "Spark 4.0 지원",
          },
        })),
    },
  });
  expect(result.ok && result.data.current.revision).toBe(2);
  expect(result.ok && result.data.previous?.revision).toBe(1);
  expect(result.ok && result.data.changes).toMatchObject([
    { field: "budgetKrw", kind: "scalar", before: "100", after: "200" },
    {
      field: "content",
      kind: "text",
      segments: [
        { op: "same", text: "Spark " },
        { op: "removed", text: "3.0" },
        { op: "added", text: "4.0" },
        { op: "same", text: " 지원" },
      ],
    },
  ]);
});
