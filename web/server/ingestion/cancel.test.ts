import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { finalizeRevision } from "./checksum";
import { fixtureFileSchema, type FixtureRecord } from "./fixture.model";
import { normalizeFixtureRecord } from "./normalize";
import type { NormalizedBidDraft } from "./normalized-bid.model";
import { decideRevision, type ChangeDecision, type StoredRevision } from "./revision";

// 07 §5 취소 행, 11 §3.1 FX-08: 취소는 revision +1·status CANCELLED·BID_CHANGED 1건·재분석 없음.
// 계약 5-C: 레코드에 status 가 있으면(FX-08 r2) revision 이 올라도 그 값을 쓴다. 없으면 revision ≥ 2 는 AMENDED.
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CONTEXT = {
  fetchedAt: new Date("2026-10-19T03:05:00.000Z"),
  anchor: new Date("2026-10-19T03:00:00.000Z"),
};

const recordOf = (batch: "SEED" | "LIVE"): FixtureRecord => {
  const file = fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", "FX-08.json"), "utf8")),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`FX-08 에 ${batch} 레코드가 없다`);
  return record;
};
const draftOf = (batch: "SEED" | "LIVE"): NormalizedBidDraft => {
  const outcome = normalizeFixtureRecord(recordOf(batch), CONTEXT);
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
const storedAt = (draft: NormalizedBidDraft, revision: number): StoredRevision => {
  const bid = finalizeRevision(draft, revision);
  return { bidId: "bid-fx08", revision, checksum: bid.checksum, normalized: bid };
};
const saved = (decision: ChangeDecision) => {
  if (!("bid" in decision)) throw new Error(`변경이 ${decision.kind} 로 판정됐다`);
  return decision;
};
const cancelFx08 = () => decideRevision(storedAt(draftOf("SEED"), 1), draftOf("LIVE"));
const afterCancel = (patch: Partial<NormalizedBidDraft>) =>
  decideRevision(storedAt(draftOf("LIVE"), 2), { ...draftOf("LIVE"), ...patch });

describe("FX-08 r2 — 취소", () => {
  it("OPEN 이던 공고가 CANCELLED 로 오면 CANCELLED 로 판정한다", () => {
    expect(cancelFx08().kind).toBe("CANCELLED");
  });

  it("취소는 revision 2 로 쌓고 bid.status 는 CANCELLED 다", () => {
    const decision = saved(cancelFx08());
    expect([decision.bid.revision, decision.bid.status]).toEqual([2, "CANCELLED"]);
  });

  it("취소는 재분석하지 않는다", () => {
    expect(saved(cancelFx08()).reanalyze).toBe(false);
  });

  it("취소는 BID_CHANGED 이벤트 1건을 만든다", () => {
    expect(saved(cancelFx08()).event).toStrictEqual({
      type: "BID_CHANGED",
      idempotencyKey: "fixture:DEMO-2026-0008:2:BID_CHANGED",
    });
  });

  it("diff 에 status OPEN → CANCELLED 가 있다", () => {
    expect(saved(cancelFx08()).changes.find(({ field }) => field === "status")).toStrictEqual({
      field: "status",
      before: "OPEN",
      after: "CANCELLED",
    });
  });

  it("diff 필드는 amendmentNo·status·content 다", () => {
    expect(saved(cancelFx08()).changes.map(({ field }) => field)).toEqual([
      "amendmentNo",
      "status",
      "content",
    ]);
  });

  it("같은 취소 공고를 다시 받으면 DUPLICATE·revision 2 다", () => {
    expect(decideRevision(storedAt(draftOf("LIVE"), 2), draftOf("LIVE"))).toStrictEqual({
      kind: "DUPLICATE",
      revision: 2,
    });
  });
});

describe("이미 CANCELLED 인 공고의 재변경", () => {
  it("CANCELLED 인 채로 내용만 바뀌면 CHANGED 다", () => {
    expect(afterCancel({ content: `${draftOf("LIVE").content} 추가 안내.` }).kind).toBe("CHANGED");
  });

  it("CANCELLED 인 채로 바뀌면 재분석하지 않는다", () => {
    expect(saved(afterCancel({ content: `${draftOf("LIVE").content} 추가 안내.` })).reanalyze).toBe(
      false,
    );
  });

  it("CANCELLED 인 채로 바뀌면 revision 3 의 BID_CHANGED 를 만든다", () => {
    expect(
      saved(afterCancel({ content: `${draftOf("LIVE").content} 추가 안내.` })).event,
    ).toStrictEqual({
      type: "BID_CHANGED",
      idempotencyKey: "fixture:DEMO-2026-0008:3:BID_CHANGED",
    });
  });

  it("레코드 status 가 OPEN 으로 돌아오면 CHANGED 이고 재분석한다", () => {
    const live = draftOf("LIVE");
    const decision = saved(
      afterCancel({ status: "OPEN", original: { ...live.original, status: "OPEN" } }),
    );
    expect([decision.kind, decision.bid.status, decision.reanalyze]).toEqual([
      "CHANGED",
      "OPEN",
      true,
    ]);
  });

  it("취소 뒤 status 없는 레코드가 오면 CHANGED 이고 재분석한다", () => {
    const decision = saved(afterCancel({ ...draftOf("SEED"), amendmentNo: "03" }));
    expect([decision.kind, decision.bid.revision, decision.reanalyze]).toEqual([
      "CHANGED",
      3,
      true,
    ]);
  });

  it("취소 뒤 status 없는 레코드의 revision 3 은 AMENDED 다", () => {
    expect(saved(afterCancel({ ...draftOf("SEED"), amendmentNo: "03" })).bid.status).toBe(
      "AMENDED",
    );
  });
});

describe("처음부터 취소된 공고", () => {
  it("previous 가 없으면 CANCELLED 여도 CREATED·BID_CREATED 이고 재분석하지 않는다", () => {
    const decision = saved(decideRevision(null, draftOf("LIVE")));
    expect([decision.kind, decision.event.type, decision.reanalyze]).toEqual([
      "CREATED",
      "BID_CREATED",
      false,
    ]);
  });
});
