import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { finalizeRevision } from "./checksum";
import { fixtureFileSchema } from "./fixture.model";
import { normalizeFixtureRecord } from "./normalize";
import type { NormalizedBidDraft } from "./normalized-bid.model";
import {
  decideRevision,
  isOlderAmendment,
  type ChangeDecision,
  type StoredRevision,
} from "./revision";

// 계약 5-E: 같은 bidNtceNo 의 000·001 이 한 창에 함께 오면 이전 차수는 STALE(이벤트·저장 없음).
// 이전 차수가 먼저 오고 새 차수가 뒤에 오면 지금처럼 CHANGED(07 §4).
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

// 실측 목록과 같은 모양의 작은 g2b draft. 000 = 등록공고(OPEN), 001 = 변경공고(AMENDED)
const g2bDraft = (
  amendmentNo: string | undefined,
  patch: Partial<NormalizedBidDraft> = {},
): NormalizedBidDraft => ({
  schemaVersion: "normalized-bid/v0.2",
  source: "g2b-bid-notice",
  noticeId: "R26BK00000001",
  ...(amendmentNo === undefined ? {} : { amendmentNo }),
  stage: "NOTICE",
  status: amendmentNo === "000" ? "OPEN" : "AMENDED",
  title: "가상 정보시스템 고도화 사업",
  agency: "가상기관",
  budgetKrw: "100000000",
  noticeDate: "2026-10-14T00:00:00.000Z",
  deadlineAt: amendmentNo === "000" ? "2026-11-02T09:00:00.000Z" : "2026-11-09T09:00:00.000Z",
  sourceUrl: "https://www.g2b.go.kr/link/R26BK00000001",
  content: "",
  attachments: [],
  structuredQualifications: [],
  original: { noticeNo: "R26BK00000001", status: amendmentNo === "000" ? "등록공고" : "변경공고" },
  isDemo: false,
  fetchedAt: "2026-10-19T03:05:00.000Z",
  ...patch,
});
const fixtureDraft = (id: string, batch: "SEED" | "LIVE"): NormalizedBidDraft => {
  const file = fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === batch);
  if (!record) throw new Error(`${id} 에 ${batch} 레코드가 없다`);
  const outcome = normalizeFixtureRecord(record, {
    fetchedAt: new Date("2026-10-19T03:05:00.000Z"),
    anchor: new Date("2026-10-19T03:00:00.000Z"),
  });
  if (!outcome.ok) throw new Error(`정규화 실패: ${outcome.issue.code}`);
  return outcome.draft;
};
// 저장된 결정만 다음 previous 가 된다(STALE·DUPLICATE 는 저장하지 않는다)
const toStored = (bidId: string, decision: ChangeDecision): StoredRevision => {
  if (!("bid" in decision)) throw new Error(`저장할 revision 이 없다: ${decision.kind}`);
  return {
    bidId,
    revision: decision.bid.revision,
    checksum: decision.bid.checksum,
    normalized: decision.bid,
  };
};
const storedAt = (draft: NormalizedBidDraft, revision: number): StoredRevision => {
  const bid = finalizeRevision(draft, revision);
  return { bidId: "bid-g2b", revision, checksum: bid.checksum, normalized: bid };
};
const deliver = (drafts: readonly NormalizedBidDraft[]) =>
  drafts.reduce<{ latest: StoredRevision | null; decisions: ChangeDecision[] }>(
    (state, draft) => {
      const decision = decideRevision(state.latest, draft);
      return {
        latest: "bid" in decision ? toStored("bid-g2b", decision) : state.latest,
        decisions: [...state.decisions, decision],
      };
    },
    { latest: null, decisions: [] },
  );

describe("isOlderAmendment", () => {
  it("'000' 은 '001' 보다 이전 차수다", () => {
    expect(isOlderAmendment("000", "001")).toBe(true);
  });

  it("'01' 은 '02' 보다 이전 차수다", () => {
    expect(isOlderAmendment("01", "02")).toBe(true);
  });

  it("문자열이 아니라 숫자로 비교해 '9' 는 '10' 보다 이전 차수다", () => {
    expect(isOlderAmendment("9", "10")).toBe(true);
  });

  it("'10' 은 '9' 보다 이전 차수가 아니다", () => {
    expect(isOlderAmendment("10", "9")).toBe(false);
  });

  it("같은 차수는 이전 차수가 아니다", () => {
    expect(isOlderAmendment("001", "001")).toBe(false);
  });

  it("자릿수만 다르고 값이 같으면('01'·'1') 이전 차수가 아니다", () => {
    expect(isOlderAmendment("01", "1")).toBe(false);
  });

  it("더 큰 차수는 이전 차수가 아니다", () => {
    expect(isOlderAmendment("002", "001")).toBe(false);
  });

  it.each([
    ["draft 가 undefined", undefined, "001"],
    ["latest 가 undefined", "000", undefined],
    ["둘 다 undefined", undefined, undefined],
  ])("%s 면 false 다", (_label, draft, latest) => {
    expect(isOlderAmendment(draft, latest)).toBe(false);
  });

  it.each([
    ["빈 문자열", "", "001"],
    ["한글", "가", "001"],
    ["영문 섞임", "000", "A1"],
    ["소수", "1.5", "2"],
    ["음수", "-1", "0"],
    ["앞 공백", " 1", "2"],
  ])("숫자 문자열이 아닌 값(%s)이 있으면 false 다", (_label, draft, latest) => {
    expect(isOlderAmendment(draft, latest)).toBe(false);
  });
});

describe("decideRevision — 늦게 온 이전 차수", () => {
  it("001 을 저장한 뒤 000 을 받으면 STALE 이고 이벤트가 없다", () => {
    const stored = toStored("bid-g2b", decideRevision(null, g2bDraft("001")));
    expect(decideRevision(stored, g2bDraft("000"))).toStrictEqual({
      kind: "STALE",
      revision: 1,
      amendmentNo: "000",
    });
  });

  it("STALE 의 revision 은 저장된 최신 revision 이다", () => {
    expect(decideRevision(storedAt(g2bDraft("001"), 5), g2bDraft("000"))).toStrictEqual({
      kind: "STALE",
      revision: 5,
      amendmentNo: "000",
    });
  });

  it("최신 차수가 취소돼 있어도 이전 차수는 STALE 이다(다시 열지 않는다)", () => {
    const cancelled = g2bDraft("001", {
      status: "CANCELLED",
      original: { noticeNo: "R26BK00000001", status: "취소공고" },
    });
    expect(decideRevision(storedAt(cancelled, 2), g2bDraft("000")).kind).toBe("STALE");
  });

  it("000 을 저장한 뒤 001 을 받으면 CHANGED·revision 2 다", () => {
    const stored = toStored("bid-g2b", decideRevision(null, g2bDraft("000")));
    const decision = decideRevision(stored, g2bDraft("001"));
    expect([decision.kind, "bid" in decision ? decision.bid.revision : null]).toEqual([
      "CHANGED",
      2,
    ]);
  });

  it("000→001→000→001 순서로 받으면 CREATED·CHANGED·STALE·DUPLICATE 다", () => {
    const { decisions } = deliver([
      g2bDraft("000"),
      g2bDraft("001"),
      g2bDraft("000"),
      g2bDraft("001"),
    ]);
    expect(decisions.map(({ kind }) => kind)).toEqual(["CREATED", "CHANGED", "STALE", "DUPLICATE"]);
  });

  it("000→001→000→001 순서로 받아도 revision 2 에서 멈춘다", () => {
    const { latest } = deliver([
      g2bDraft("000"),
      g2bDraft("001"),
      g2bDraft("000"),
      g2bDraft("001"),
    ]);
    expect([latest?.revision, latest?.normalized.amendmentNo]).toEqual([2, "001"]);
  });

  it("두 번째 001 은 DUPLICATE·revision 2 다", () => {
    const { decisions } = deliver([
      g2bDraft("000"),
      g2bDraft("001"),
      g2bDraft("000"),
      g2bDraft("001"),
    ]);
    expect(decisions[3]).toStrictEqual({ kind: "DUPLICATE", revision: 2 });
  });

  it("같은 차수의 내용 변경은 STALE 이 아니라 CHANGED 다", () => {
    const stored = storedAt(g2bDraft("001"), 2);
    const decision = decideRevision(
      stored,
      g2bDraft("001", { title: "가상 정보시스템 고도화 사업(변경)" }),
    );
    expect(decision.kind).toBe("CHANGED");
  });

  it("저장된 revision 에 차수가 없으면 STALE 로 보지 않는다", () => {
    expect(decideRevision(storedAt(g2bDraft(undefined), 1), g2bDraft("000")).kind).toBe("CHANGED");
  });

  it("받은 draft 에 차수가 없으면 STALE 로 보지 않는다", () => {
    expect(decideRevision(storedAt(g2bDraft("001"), 1), g2bDraft(undefined)).kind).toBe("CHANGED");
  });

  it("previous 와 draft 를 바꾸지 않는다", () => {
    const previous = storedAt(g2bDraft("001"), 1);
    const draft = g2bDraft("000");
    const before = structuredClone({ previous, draft });
    decideRevision(previous, draft);
    expect({ previous, draft }).toStrictEqual(before);
  });
});

describe("decideRevision — FX-10 차수 01·02", () => {
  const fx10 = () => {
    const r01 = fixtureDraft("FX-10", "SEED");
    const r02 = fixtureDraft("FX-10", "LIVE");
    const stored01 = toStored("bid-fx10", decideRevision(null, r01));
    const decision02 = decideRevision(stored01, r02);
    return { r01, decision02 };
  };

  it("01 을 저장한 뒤 02 를 받으면 CHANGED·revision 2 다", () => {
    const { decision02 } = fx10();
    expect([decision02.kind, "bid" in decision02 ? decision02.bid.revision : null]).toEqual([
      "CHANGED",
      2,
    ]);
  });

  it("02 를 저장한 뒤 01 을 다시 받으면 STALE·revision 2 다", () => {
    const { r01, decision02 } = fx10();
    expect(decideRevision(toStored("bid-fx10", decision02), r01)).toStrictEqual({
      kind: "STALE",
      revision: 2,
      amendmentNo: "01",
    });
  });
});
