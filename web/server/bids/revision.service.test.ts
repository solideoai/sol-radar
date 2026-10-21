import { describe, expect, it, vi } from "vitest";
import type { BidRevisionSummary } from "./bid.model";
import type { BidsRepo } from "./bids.repo";
import {
  compareBidRevision,
  getBidRevision,
  listBidRevisions,
  parseRevisionParam,
} from "./revision.service";

const summary = (
  revision: number,
  patch: Partial<BidRevisionSummary> = {},
): BidRevisionSummary => ({
  id: `rev-${revision}`,
  revision,
  amendmentNo: `0${revision}`,
  fetchedAt: `2026-10-1${revision}T00:00:00.000Z`,
  checksum: `sum-${revision}`,
  changedFields: [],
  ...patch,
});

const R1 = {
  title: "클라우드 전환 사업",
  budgetKrw: "1800000000",
  content: "클라우드 전환 사업 수행",
  status: "OPEN",
};
const R2 = {
  title: "클라우드 전환 사업",
  budgetKrw: "2160000000",
  content: "클라우드 전환 사업 Kubernetes 수행",
  status: "OPEN",
};

type Stored = { revision: number; normalized: unknown };

function repoOf(
  history: { title: string; revisions: BidRevisionSummary[] } | null,
  snapshots: Stored[],
): BidsRepo {
  return {
    getRevisionHistory: vi.fn(async () => history),
    getRevisionSnapshots: vi.fn(async (_bidId: string, revisions: number[]) =>
      snapshots.filter((row) => revisions.includes(row.revision)),
    ),
  } as unknown as BidsRepo;
}

const twoRevisions = (r2Normalized: unknown = R2): BidsRepo =>
  repoOf(
    {
      title: "클라우드 전환 사업",
      revisions: [
        summary(2, { changedFields: ["amendmentNo", "budgetKrw", "content"] }),
        summary(1),
      ],
    },
    [
      { revision: 1, normalized: R1 },
      { revision: 2, normalized: r2Normalized },
    ],
  );

const BID = "bid-1";

describe("공고가 없으면", () => {
  it("세 함수 모두 404 bid 다", async () => {
    const repo = repoOf(null, []);
    const expected = { ok: false, status: 404, code: "NOT_FOUND", details: { resource: "bid" } };
    expect(await listBidRevisions("o", BID, { repo })).toMatchObject(expected);
    expect(await getBidRevision("o", BID, 1, { repo })).toMatchObject(expected);
    expect(await compareBidRevision("o", BID, null, { repo })).toMatchObject(expected);
  });
});

describe("listBidRevisions", () => {
  it("저장소의 내림차순 목록을 그대로 낸다", async () => {
    const result = await listBidRevisions("o", BID, { repo: twoRevisions() });
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.ok && result.data.map((row) => row.revision)).toEqual([2, 1]);
  });
});

describe("getBidRevision", () => {
  it("그 revision 의 스냅샷을 낸다", async () => {
    const result = await getBidRevision("o", BID, 2, { repo: twoRevisions() });
    expect(result).toMatchObject({ ok: true, data: { budgetKrw: "2160000000" } });
  });

  it("없는 번호는 404 revision 이다", async () => {
    expect(await getBidRevision("o", BID, 3, { repo: twoRevisions() })).toMatchObject({
      ok: false,
      status: 404,
      message: "변경 이력을 찾을 수 없습니다",
      details: { resource: "revision" },
    });
  });
});

describe("compareBidRevision", () => {
  it("revision 이 하나뿐이면 previous 없이 changes 가 비어 있다", async () => {
    const repo = repoOf({ title: "처음 공고", revisions: [summary(1)] }, [
      { revision: 1, normalized: R1 },
    ]);
    const result = await compareBidRevision("o", BID, null, { repo });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.current.revision).toBe(1);
    expect(result.data.previous).toBeNull();
    expect(result.data.changes).toEqual([]);
    expect(result.data.title).toBe("처음 공고");
  });

  it("null 이면 가장 높은 revision 을 바로 앞 revision 과 견준다", async () => {
    const result = await compareBidRevision("o", BID, null, { repo: twoRevisions() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.current).toMatchObject({ revision: 2, amendmentNo: "02" });
    expect(result.data.previous).toMatchObject({ revision: 1, amendmentNo: "01" });
    expect(result.data.revisions.map((row) => row.revision)).toEqual([2, 1]);
    expect(result.data.changes.map((change) => change.field)).toEqual(["budgetKrw", "content"]);
    expect(result.data.changes[0]).toEqual({
      field: "budgetKrw",
      kind: "scalar",
      before: "1800000000",
      after: "2160000000",
    });
    expect(result.data.cancelled).toBe(false);
  });

  it("1 을 주면 previous 가 null 이다", async () => {
    const result = await compareBidRevision("o", BID, 1, { repo: twoRevisions() });
    expect(result.ok && result.data.previous).toBeNull();
    expect(result.ok && result.data.current.revision).toBe(1);
  });

  it("없는 번호는 404 revision 이다", async () => {
    expect(await compareBidRevision("o", BID, 3, { repo: twoRevisions() })).toMatchObject({
      ok: false,
      status: 404,
      details: { resource: "revision" },
    });
  });

  it("이력이 비어 있어도 null 요청은 404 revision 이다", async () => {
    const repo = repoOf({ title: "t", revisions: [] }, []);
    expect(await compareBidRevision("o", BID, null, { repo })).toMatchObject({
      ok: false,
      status: 404,
      details: { resource: "revision" },
    });
  });

  it("current 스냅샷이 CANCELLED 면 cancelled 다", async () => {
    const result = await compareBidRevision("o", BID, null, {
      repo: twoRevisions({ ...R2, status: "CANCELLED" }),
    });
    expect(result.ok && result.data.cancelled).toBe(true);
  });

  it("스냅샷이 스키마에 맞지 않으면 던진다", async () => {
    await expect(
      compareBidRevision("o", BID, null, { repo: twoRevisions({ ...R2, content: 7 }) }),
    ).rejects.toThrow();
  });
});

describe("parseRevisionParam", () => {
  it("양의 정수 표기만 숫자로 읽는다", () => {
    expect(parseRevisionParam("2")).toBe(2);
    expect(parseRevisionParam("123456")).toBe(123456);
    for (const bad of ["0", "01", "-1", "a", "1.5", undefined, "1234567", ""]) {
      expect(parseRevisionParam(bad)).toBeNull();
    }
  });
});
