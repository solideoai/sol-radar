import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { finalizeRevision } from "./checksum";
import { fixtureFileSchema, type FixtureRecord } from "./fixture.model";
import { normalizeFixtureRecord, type NormalizeContext } from "./normalize";
import type { NormalizedBidDraft } from "./normalized-bid.model";
import {
  TRACKED_FIELDS,
  decideRevision,
  diffRevisions,
  type ChangeDecision,
  type StoredRevision,
} from "./revision";

// G2 의 수집 쪽(07 §4·§5): revision diff·이벤트 멱등키·동일 payload 재수신.
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
// KST 2026-10-19 12:00
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const SEED_AT = new Date("2026-10-19T03:05:00.000Z");
const LIVE_AT = new Date("2026-10-19T06:00:00.000Z");

const recordOf = (id: string, batch: "SEED" | "LIVE"): FixtureRecord => {
  const file = fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  return record;
};
const draftOf = (
  id: string,
  batch: "SEED" | "LIVE",
  fetchedAt = batch === "SEED" ? SEED_AT : LIVE_AT,
) => {
  const context: NormalizeContext = { fetchedAt, anchor: ANCHOR };
  const outcome = normalizeFixtureRecord(recordOf(id, batch), context);
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
const store = (bidId: string, decision: ChangeDecision): StoredRevision => {
  if (decision.kind === "DUPLICATE") throw new Error("저장할 revision 이 없다");
  return {
    bidId,
    revision: decision.bid.revision,
    checksum: decision.bid.checksum,
    normalized: decision.bid,
  };
};
const storedAt = (bidId: string, draft: NormalizedBidDraft, revision: number): StoredRevision => {
  const bid = finalizeRevision(draft, revision);
  return { bidId, revision, checksum: bid.checksum, normalized: bid };
};
const changed = (decision: ChangeDecision) => {
  if (decision.kind === "DUPLICATE") throw new Error("변경이 DUPLICATE 로 판정됐다");
  return decision;
};
const fields = (decision: ChangeDecision) => changed(decision).changes.map(({ field }) => field);
// FX-06 r1 을 저장한 뒤 r2 를 받는다
const fx06 = () => {
  const r1 = draftOf("FX-06", "SEED");
  const r2 = draftOf("FX-06", "LIVE");
  const created = decideRevision(null, r1);
  const stored1 = store("bid-fx06", created);
  const next = decideRevision(stored1, r2);
  return { r1, r2, created, stored1, next };
};

describe("G2 — FX-06 마감 변경", () => {
  it("처음 받은 r1 은 CREATED·revision 1·BID_CREATED 다", () => {
    const { created } = fx06();
    const decision = changed(created);
    expect([
      decision.kind,
      decision.bid.revision,
      decision.changes,
      decision.event,
      decision.reanalyze,
    ]).toStrictEqual([
      "CREATED",
      1,
      [],
      { type: "BID_CREATED", idempotencyKey: "fixture:DEMO-2026-0006:1:BID_CREATED" },
      true,
    ]);
  });

  it("CREATED 의 bid 는 finalizeRevision(draft, 1) 과 같다", () => {
    const { r1, created } = fx06();
    expect(changed(created).bid).toStrictEqual(finalizeRevision(r1, 1));
  });

  it("r2 는 CHANGED 이고 revision 2 다", () => {
    const decision = changed(fx06().next);
    expect([decision.kind, decision.bid.revision]).toEqual(["CHANGED", 2]);
  });

  it("r2 의 diff 에 deadlineAt 전/후가 있다", () => {
    expect(changed(fx06().next).changes.find(({ field }) => field === "deadlineAt")).toStrictEqual({
      field: "deadlineAt",
      before: "2026-11-02T09:00:00.000Z",
      after: "2026-11-16T09:00:00.000Z",
    });
  });

  it("r2 의 diff 는 바뀐 추적 필드만 TRACKED_FIELDS 순서로 담는다", () => {
    expect(fields(fx06().next)).toEqual(["amendmentNo", "deadlineAt", "content"]);
  });

  it("r2 는 BID_CHANGED 이벤트 1건을 source:noticeId:revision:type 멱등키로 만든다", () => {
    expect(changed(fx06().next).event).toStrictEqual({
      type: "BID_CHANGED",
      idempotencyKey: "fixture:DEMO-2026-0006:2:BID_CHANGED",
    });
  });

  it("마감이 바뀐 r2 는 재분석한다", () => {
    expect(changed(fx06().next).reanalyze).toBe(true);
  });

  it("r2 의 bid 는 finalizeRevision(r2, 2) 와 같다", () => {
    const { r2, next } = fx06();
    expect(changed(next).bid).toStrictEqual(finalizeRevision(r2, 2));
  });

  it("같은 r2 를 다시 받으면 fetchedAt 이 달라도 DUPLICATE·revision 2 이고 이벤트가 없다", () => {
    const { next } = fx06();
    const stored2 = store("bid-fx06", next);
    const again = draftOf("FX-06", "LIVE", new Date("2026-10-19T12:00:00.000Z"));
    expect(decideRevision(stored2, again)).toStrictEqual({ kind: "DUPLICATE", revision: 2 });
  });

  it("같은 r1 을 다시 받으면 DUPLICATE·revision 1 이다", () => {
    const { stored1 } = fx06();
    const again = draftOf("FX-06", "SEED", new Date("2026-10-20T00:00:00.000Z"));
    expect(decideRevision(stored1, again)).toStrictEqual({ kind: "DUPLICATE", revision: 1 });
  });
});

describe("G2 — FX-07 예산·요구사항 변경", () => {
  const fx07 = () => {
    const r1 = draftOf("FX-07", "SEED");
    const r2 = draftOf("FX-07", "LIVE");
    return { r1, r2, next: decideRevision(storedAt("bid-fx07", r1, 1), r2) };
  };

  it("diff 에 budgetKrw 전/후가 있다", () => {
    expect(changed(fx07().next).changes.find(({ field }) => field === "budgetKrw")).toStrictEqual({
      field: "budgetKrw",
      before: "1800000000",
      after: "2160000000",
    });
  });

  it("diff 에 요구사항이 바뀐 content 전/후가 있다", () => {
    const { r1, r2, next } = fx07();
    expect(changed(next).changes.find(({ field }) => field === "content")).toStrictEqual({
      field: "content",
      before: r1.content,
      after: r2.content,
    });
  });

  it("diff 필드는 amendmentNo·budgetKrw·content 다", () => {
    expect(fields(fx07().next)).toEqual(["amendmentNo", "budgetKrw", "content"]);
  });

  it("CHANGED·revision 2·BID_CHANGED·재분석이다", () => {
    const decision = changed(fx07().next);
    expect([
      decision.kind,
      decision.bid.revision,
      decision.event.idempotencyKey,
      decision.reanalyze,
    ]).toEqual(["CHANGED", 2, "fixture:DEMO-2026-0007:2:BID_CHANGED", true]);
  });
});

describe("G1 — FX-09 SEED→LIVE 중복 전달", () => {
  it("SEED 를 저장한 뒤 같은 payload 의 LIVE 를 받으면 DUPLICATE·revision 1 이다", () => {
    const stored = store("bid-fx09", decideRevision(null, draftOf("FX-09", "SEED")));
    expect(decideRevision(stored, draftOf("FX-09", "LIVE"))).toStrictEqual({
      kind: "DUPLICATE",
      revision: 1,
    });
  });
});

describe("G1 — FX-10 차수 01→02", () => {
  const fx10 = () =>
    decideRevision(storedAt("bid-fx10", draftOf("FX-10", "SEED"), 1), draftOf("FX-10", "LIVE"));

  it("amendmentNo 가 달라도 같은 bid 의 revision 2 다", () => {
    const decision = changed(fx10());
    expect([decision.kind, decision.bid.noticeId, decision.bid.revision]).toEqual([
      "CHANGED",
      "DEMO-2026-0010",
      2,
    ]);
  });

  it("diff 에 amendmentNo 01 → 02 가 있다", () => {
    expect(changed(fx10()).changes.find(({ field }) => field === "amendmentNo")).toStrictEqual({
      field: "amendmentNo",
      before: "01",
      after: "02",
    });
  });

  it("이벤트 멱등키는 같은 noticeId 의 revision 2 다", () => {
    expect(changed(fx10()).event.idempotencyKey).toBe("fixture:DEMO-2026-0010:2:BID_CHANGED");
  });
});

describe("decideRevision", () => {
  it("다음 revision 은 previous.revision + 1 이다", () => {
    const previous = storedAt("bid-fx06", draftOf("FX-06", "SEED"), 3);
    const decision = changed(decideRevision(previous, draftOf("FX-06", "LIVE")));
    expect([decision.bid.revision, decision.event.idempotencyKey]).toEqual([
      4,
      "fixture:DEMO-2026-0006:4:BID_CHANGED",
    ]);
  });

  it("중복 판정은 previous.revision 으로 확정한 checksum 과 비교한다", () => {
    const draft = draftOf("FX-06", "SEED");
    expect(decideRevision(storedAt("bid-fx06", draft, 3), draft)).toStrictEqual({
      kind: "DUPLICATE",
      revision: 3,
    });
  });

  it("previous 와 draft 를 바꾸지 않는다", () => {
    const previous = storedAt("bid-fx06", draftOf("FX-06", "SEED"), 1);
    const draft = draftOf("FX-06", "LIVE");
    const before = structuredClone({ previous, draft });
    decideRevision(previous, draft);
    expect({ previous, draft }).toStrictEqual(before);
  });
});

describe("diffRevisions", () => {
  const base = () => draftOf("FX-06", "SEED");

  it("추적 필드 목록은 계약 순서 그대로다", () => {
    expect(TRACKED_FIELDS).toEqual([
      "amendmentNo",
      "planRef",
      "preSpecRef",
      "stage",
      "status",
      "title",
      "agency",
      "budgetKrw",
      "noticeDate",
      "deadlineAt",
      "sourceUrl",
      "content",
      "attachments",
      "structuredQualifications",
    ]);
  });

  it("같은 draft 끼리는 변화가 없다", () => {
    expect(diffRevisions(base(), base())).toEqual([]);
  });

  it("fetchedAt 만 다르면 변화가 없다", () => {
    expect(diffRevisions(base(), { ...base(), fetchedAt: "2026-10-20T00:00:00.000Z" })).toEqual([]);
  });

  it("추적하지 않는 original·normalizationNotes 가 달라도 변화가 없다", () => {
    const after = { ...base(), original: { noticeNo: "X" }, normalizationNotes: ["다른 메모"] };
    expect(diffRevisions(base(), after)).toEqual([]);
  });

  it("객체 키 순서와 무관하게 TRACKED_FIELDS 순서로 낸다", () => {
    const reordered = Object.fromEntries(
      Object.entries({ ...base(), budgetKrw: "1", title: "바뀐 제목" }).reverse(),
    ) as NormalizedBidDraft;
    expect(diffRevisions(base(), reordered).map(({ field }) => field)).toEqual([
      "title",
      "budgetKrw",
    ]);
  });

  it("before 에 없던 planRef 가 생기면 before 를 null 로 적는다", () => {
    expect(diffRevisions(base(), { ...base(), planRef: "DEMO-PLAN-0042" })).toStrictEqual([
      { field: "planRef", before: null, after: "DEMO-PLAN-0042" },
    ]);
  });

  it("after 에서 planRef 키가 없어지면 after 를 null 로 적는다", () => {
    expect(diffRevisions({ ...base(), planRef: "DEMO-PLAN-0042" }, base())).toStrictEqual([
      { field: "planRef", before: "DEMO-PLAN-0042", after: null },
    ]);
  });

  it("agency 가 null 에서 값으로 바뀌면 전/후를 그대로 적는다", () => {
    expect(diffRevisions({ ...base(), agency: null }, base())).toStrictEqual([
      { field: "agency", before: null, after: "대전광역시" },
    ]);
  });

  it("첨부 객체의 키 순서만 다르면 변화가 없다", () => {
    const before = { ...base(), attachments: [{ name: "a.pdf", url: "fixtures/docs/a.pdf" }] };
    const after = { ...base(), attachments: [{ url: "fixtures/docs/a.pdf", name: "a.pdf" }] };
    expect(diffRevisions(before, after)).toEqual([]);
  });

  it("첨부 순서가 바뀌면 attachments 변화로 적는다", () => {
    const one = { name: "a.pdf", url: "fixtures/docs/a.pdf" };
    const two = { name: "b.hwp", url: "fixtures/docs/b.hwp" };
    expect(
      diffRevisions({ ...base(), attachments: [one, two] }, { ...base(), attachments: [two, one] }),
    ).toStrictEqual([{ field: "attachments", before: [one, two], after: [two, one] }]);
  });

  it("인자를 바꾸지 않는다", () => {
    const before = base();
    const after = { ...base(), title: "바뀐 제목" };
    const snapshot = structuredClone({ before, after });
    diffRevisions(before, after);
    expect({ before, after }).toStrictEqual(snapshot);
  });
});
