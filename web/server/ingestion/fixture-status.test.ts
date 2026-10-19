import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { finalizeRevision } from "./checksum";
import { fixtureFileSchema, fixtureRecordSchema, type FixtureRecord } from "./fixture.model";
import { normalizeFixtureRecord } from "./normalize";
import { normalizedBidSchema, type NormalizedBidDraft } from "./normalized-bid.model";
import { statusForRevision } from "./revision";

// 계약 5-C(e8 판정 B-1): 레코드에 status 가 없는 fixture 공고는 revision 1 → OPEN, revision ≥ 2 → AMENDED.
// 레코드에 status 가 있으면 그 값. live(g2b) 는 영향 없음.
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CONTEXT = {
  fetchedAt: new Date("2026-10-19T03:05:00.000Z"),
  anchor: new Date("2026-10-19T03:00:00.000Z"),
};

const recordOf = (id: string, batch: "SEED" | "LIVE"): FixtureRecord => {
  const file = fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};
const draftFrom = (record: FixtureRecord): NormalizedBidDraft => {
  const outcome = normalizeFixtureRecord(record, CONTEXT);
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
// 레코드에 status 가 없는 정정 공고
const fx06r2 = () => draftFrom(recordOf("FX-06", "LIVE"));

describe("statusForRevision — 레코드 status 가 없는 fixture 공고", () => {
  it("정규화 결과는 OPEN 이고 original.status 가 없다", () => {
    const draft = fx06r2();
    expect([draft.status, "status" in draft.original]).toEqual(["OPEN", false]);
  });

  it("revision 1 이면 draft 를 그대로 돌려준다", () => {
    const draft = fx06r2();
    expect(statusForRevision(draft, 1)).toStrictEqual(draft);
  });

  it("revision 2 면 status 만 AMENDED 로 바꾼다", () => {
    const draft = fx06r2();
    expect(statusForRevision(draft, 2)).toStrictEqual({ ...draft, status: "AMENDED" });
  });

  it("revision 3 도 AMENDED 다", () => {
    expect(statusForRevision(fx06r2(), 3).status).toBe("AMENDED");
  });

  it("AMENDED 로 바꾼 draft 를 revision 2 로 확정하면 normalizedBidSchema 를 통과한다", () => {
    const bid = finalizeRevision(statusForRevision(fx06r2(), 2), 2);
    expect(normalizedBidSchema.safeParse(bid).success).toBe(true);
  });

  it("인자를 바꾸지 않는다", () => {
    const draft = fx06r2();
    const before = structuredClone(draft);
    statusForRevision(draft, 2);
    expect(draft).toStrictEqual(before);
  });
});

describe("statusForRevision — 레코드 status 가 있는 fixture 공고", () => {
  it("FX-08 r2 의 CANCELLED 는 revision 2 여도 그대로다", () => {
    const draft = draftFrom(recordOf("FX-08", "LIVE"));
    expect(statusForRevision(draft, 2)).toStrictEqual(draft);
  });

  it("레코드에 OPEN 이 적혀 있으면 revision 2 여도 OPEN 이다", () => {
    const record = fixtureRecordSchema.parse({ ...recordOf("FX-06", "LIVE"), status: "OPEN" });
    expect(statusForRevision(draftFrom(record), 2).status).toBe("OPEN");
  });
});

describe("statusForRevision — fixture 가 아닌 공고", () => {
  const g2b = (original: NormalizedBidDraft["original"]): NormalizedBidDraft => ({
    ...fx06r2(),
    source: "g2b-bid-notice",
    isDemo: false,
    original,
  });

  it("g2b 공고는 revision 2 여도 그대로다", () => {
    const draft = g2b({ noticeNo: "R26BK00000001", status: "등록공고" });
    expect(statusForRevision(draft, 2)).toStrictEqual(draft);
  });

  it("original.status 가 없어도 source 가 fixture 가 아니면 바꾸지 않는다", () => {
    const draft = g2b({ noticeNo: "R26BK00000001" });
    expect(statusForRevision(draft, 2).status).toBe("OPEN");
  });
});
