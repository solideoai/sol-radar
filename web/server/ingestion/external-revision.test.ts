import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, finalizeRevision } from "./checksum";
import { normalizeExternalNotice } from "./external-normalize";
import { toSaveRevisionParams, toStoredRevision } from "./ingestion.store";
import { normalizeG2bBidNotice } from "./normalize-g2b";
import type { NormalizedBid, NormalizedBidDraft } from "./normalized-bid.model";
import { decideRevision, diffRevisions, type StoredRevision } from "./revision";

// Synthetic provider values, not a recorded API response.
const item = {
  companyId: "COM01",
  no: "00017",
  name: "AI 분석 용역",
  progressState: "PreAttendProgress",
  noticeDate: "2026-10-20",
  bidAttendReqBeginDatetime: "2026-10-22 09:00:00",
  bidAttendReqCloseDatetime: "2026-10-22 18:00:00",
  beginDatetime: "2026-10-23 09:00:00",
  endDatetime: "2026-10-23 18:00:00",
  presumedPrice: "9007199254740993",
  placeName: "서울",
};
const beforeOpen = "2026-10-22T08:59:00+09:00";
const afterOpen = "2026-10-22T09:01:00+09:00";

function draftAt(at: string, patch: Partial<typeof item> = {}): NormalizedBidDraft {
  const outcome = normalizeExternalNotice(
    "kepco-ebid-contract",
    { ...item, ...patch },
    { fetchedAt: new Date(at) },
  );
  if (!outcome.ok) throw new Error(outcome.issue.detail);
  return outcome.draft;
}

function stored(normalized: NormalizedBid): StoredRevision {
  return toStoredRevision({
    bid_id: "bid-17",
    revision: normalized.revision,
    checksum: normalized.checksum,
    normalized,
  });
}

// Reproduce the pre-F09 storage policy to exercise historical rows, independent of the new hash.
function legacyRevision(draft: NormalizedBidDraft, revision: number): NormalizedBid {
  const unsigned = { ...draft, revision };
  const hashed = Object.fromEntries(
    Object.entries(unsigned).filter(([key]) => key !== "fetchedAt"),
  );
  return {
    ...unsigned,
    checksum: createHash("sha256").update(canonicalJson(hashed)).digest("hex"),
  };
}

describe("F09 external revision identity", () => {
  it("preserves the pre-F09 G2B v0.2 checksum and stored-row duplicate comparison", () => {
    const outcome = normalizeG2bBidNotice(
      {
        bidNtceNo: "2026000017",
        bidNtceNm: "AI 분석 용역",
        ntceKindNm: "등록공고",
        bidNtceDtlUrl: "https://www.g2b.go.kr/pn/notices/17",
        bidNtceDt: "2026-10-19 09:00:00",
        bidClseDt: "2026-10-22 18:00:00",
      },
      { fetchedAt: new Date("2026-10-19T03:05:00.000Z") },
    );
    if (!outcome.ok) throw new Error(outcome.issue.detail);
    const previous = finalizeRevision(outcome.draft, 1);
    expect(previous.checksum).toBe(
      "12a368fde252240c5022eeb1e7450429f32897f0582e82abc93178974b0ee416",
    );
    expect(
      decideRevision(stored(previous), { ...outcome.draft, fetchedAt: "2026-10-22T00:01:00.000Z" }),
    ).toEqual({ kind: "DUPLICATE", revision: 1 });
  });

  it("keeps an identical provider notice DUPLICATE across the KST application opening", () => {
    const before = draftAt(beforeOpen);
    const after = draftAt(afterOpen);
    const snapshots = structuredClone({ before, after });
    expect(before.sourceMetadata?.participationStatus).toBe("NOT_STARTED");
    expect(after.sourceMetadata?.participationStatus).toBe("APPLICATION_OPEN");
    expect(decideRevision(stored(finalizeRevision(before, 3)), after)).toEqual({
      kind: "DUPLICATE",
      revision: 3,
    });
    expect(finalizeRevision(before, 3).checksum).toBe(finalizeRevision(after, 3).checksum);
    expect(diffRevisions(before, after)).toEqual([]);
    expect({ before, after }).toEqual(snapshots);
  });

  it.each([
    {
      name: "official status within OPEN",
      patch: { progressState: "AttendProgress" },
      key: "providerStatus",
      before: "PreAttendProgress",
      after: "AttendProgress",
    },
    {
      name: "official application deadline",
      patch: { bidAttendReqCloseDatetime: "2026-10-22 19:00:00" },
      key: "applicationDeadlineAt",
      before: "2026-10-22T09:00:00.000Z",
      after: "2026-10-22T10:00:00.000Z",
    },
    {
      name: "raw amount with unverified units",
      patch: { presumedPrice: "9007199254740994" },
      key: "amounts",
      before: [
        {
          kind: "presumedPrice",
          raw: "9007199254740993",
          amountKrw: null,
          currency: null,
          unit: "UNVERIFIED",
          vat: "UNVERIFIED",
        },
      ],
      after: [
        {
          kind: "presumedPrice",
          raw: "9007199254740994",
          amountKrw: null,
          currency: null,
          unit: "UNVERIFIED",
          vat: "UNVERIFIED",
        },
      ],
    },
    {
      name: "verified place field",
      patch: { placeName: "부산" },
      key: "attributes",
      before: { placeName: "서울" },
      after: { placeName: "부산" },
    },
  ])("records a real $name change with its supplier evidence", ({ patch, key, before, after }) => {
    const previous = finalizeRevision(draftAt(beforeOpen), 3);
    const decision = decideRevision(stored(previous), draftAt(beforeOpen, patch));
    expect(decision.kind).toBe("CHANGED");
    if (decision.kind !== "CHANGED") throw new Error("expected a provider change");
    expect(decision.bid.revision).toBe(4);
    expect(decision.bid.budgetKrw).toBeNull();
    expect(decision.changes).toContainEqual({
      field: "sourceMetadata",
      before: expect.objectContaining({ [key]: before }),
      after: expect.objectContaining({ [key]: after }),
    });
    const metadataChange = decision.changes.find(({ field }) => field === "sourceMetadata");
    expect(metadataChange?.before).not.toHaveProperty("participationStatus");
    expect(metadataChange?.after).not.toHaveProperty("participationStatus");
  });

  it.each([beforeOpen, afterOpen])(
    "reads a legacy v0.3 revision without rewriting it or creating a revision at %s",
    (at) => {
      const previous = stored(legacyRevision(draftAt(beforeOpen), 7));
      const snapshot = structuredClone(previous);
      expect(decideRevision(previous, draftAt(at))).toEqual({ kind: "DUPLICATE", revision: 7 });
      expect(previous).toEqual(snapshot);
    },
  );

  it("detects a provider change against a legacy hash and deduplicates the newly stored revision", () => {
    const previous = stored(legacyRevision(draftAt(beforeOpen), 7));
    const changed = draftAt(afterOpen, { placeName: "부산" });
    const decision = decideRevision(previous, changed);
    expect(decision.kind).toBe("CHANGED");
    if (decision.kind !== "CHANGED") throw new Error("expected a provider change");
    expect(decision.bid.revision).toBe(8);
    expect(decision.changes.map(({ field }) => field)).toContain("sourceMetadata");
    expect(
      toSaveRevisionParams({ decision, rawPayload: { ...item, placeName: "부산" } }),
    ).toMatchObject({
      revision: {
        revision: 8,
        checksum: decision.bid.checksum,
        changed_fields: ["sourceMetadata"],
        raw_payload: { ...item, placeName: "부산" },
        normalized: { sourceMetadata: { attributes: { placeName: "부산" } } },
      },
      event: { payload: { changedFields: ["sourceMetadata"] } },
    });
    expect(decideRevision(stored(decision.bid), changed)).toEqual({
      kind: "DUPLICATE",
      revision: 8,
    });
  });
});
