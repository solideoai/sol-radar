import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, computeBidChecksum, finalizeRevision } from "./checksum";
import { normalizedBidSchema, type NormalizedBidDraft } from "./normalized-bid.model";

const DRAFT: NormalizedBidDraft = {
  schemaVersion: "normalized-bid/v0.2",
  source: "fixture",
  noticeId: "DEMO-2026-0099",
  amendmentNo: "01",
  stage: "NOTICE",
  status: "OPEN",
  title: "시험용 가상 공고 (가상)",
  agency: "가상기관",
  budgetKrw: "100000000",
  noticeDate: "2026-10-14T09:00:00.000Z",
  deadlineAt: "2026-11-02T09:00:00.000Z",
  sourceUrl: "https://demo.sol-radar.invalid/notices/TEST",
  content: "시험용 본문이다.",
  attachments: [
    { name: "제안요청서.pdf", url: "fixtures/docs/TEST-rfp.pdf" },
    { name: "과업지시서.hwp", url: "fixtures/docs/TEST-sow.hwp" },
  ],
  structuredQualifications: [],
  original: { noticeNo: "DEMO-2026-0099", stage: "NOTICE", budget: "1억원" },
  isDemo: true,
  fetchedAt: "2026-10-19T03:05:00.000Z",
};
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("canonicalJson", () => {
  it("객체 키를 사전순으로 정렬한다", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("중첩 객체와 배열 속 객체의 키도 정렬한다", () => {
    expect(canonicalJson({ z: { y: 1, x: [{ b: 1, a: 2 }] }, a: null })).toBe(
      '{"a":null,"z":{"x":[{"a":2,"b":1}],"y":1}}',
    );
  });

  it("키를 로캘이 아니라 UTF-16 코드 유닛 순서로 정렬한다", () => {
    expect(canonicalJson({ a: 1, Z: 2, 가: 3, _: 4 })).toBe('{"Z":2,"_":4,"a":1,"가":3}');
  });

  it("값이 undefined 인 키를 뺀다", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: { d: undefined } })).toBe('{"a":1,"c":{}}');
  });

  it("배열 순서를 유지한다", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("배열 속 객체의 순서도 유지한다", () => {
    expect(canonicalJson([{ b: 1 }, { a: 1 }])).toBe('[{"b":1},{"a":1}]');
  });

  it("구분 공백을 넣지 않고 문자열 안의 공백은 그대로 둔다", () => {
    expect(canonicalJson({ a: [1, 2], b: { c: "x y" } })).toBe('{"a":[1,2],"b":{"c":"x y"}}');
  });

  it("원시값은 JSON 표기 그대로다", () => {
    expect([
      canonicalJson("가"),
      canonicalJson(1),
      canonicalJson(null),
      canonicalJson(true),
    ]).toEqual(['"가"', "1", "null", "true"]);
  });

  it("키 순서만 다른 두 객체는 같은 문자열이 된다", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("입력 객체의 키 순서를 바꾸지 않는다", () => {
    const input = { b: 1, a: { d: 1, c: 2 } };
    canonicalJson(input);
    expect(Object.keys(input)).toEqual(["b", "a"]);
    expect(Object.keys(input.a)).toEqual(["d", "c"]);
  });
});

describe("computeBidChecksum", () => {
  it("64자 소문자 16진수다", () => {
    expect(computeBidChecksum({ ...DRAFT, revision: 1 })).toMatch(HEX64);
  });

  it("fetchedAt 을 뺀 canonicalJson 의 UTF-8 sha256 이다", () => {
    const bid = { ...DRAFT, revision: 1 };
    const withoutFetchedAt = Object.fromEntries(
      Object.entries(bid).filter(([key]) => key !== "fetchedAt"),
    );

    expect(computeBidChecksum(bid)).toBe(sha256(canonicalJson(withoutFetchedAt)));
  });

  it("키 순서가 달라도 같은 값을 낸다", () => {
    const bid = { ...DRAFT, revision: 1 };
    const reordered = Object.fromEntries(Object.entries(bid).reverse()) as typeof bid;

    expect(computeBidChecksum(reordered)).toBe(computeBidChecksum(bid));
  });

  it("마감이 바뀌면 다른 값을 낸다", () => {
    expect(
      computeBidChecksum({ ...DRAFT, revision: 1, deadlineAt: "2026-11-16T09:00:00.000Z" }),
    ).not.toBe(computeBidChecksum({ ...DRAFT, revision: 1 }));
  });

  it("첨부 순서가 바뀌면 다른 값을 낸다", () => {
    const swapped = [...DRAFT.attachments].reverse();
    expect(computeBidChecksum({ ...DRAFT, revision: 1, attachments: swapped })).not.toBe(
      computeBidChecksum({ ...DRAFT, revision: 1 }),
    );
  });
});

describe("finalizeRevision", () => {
  it("draft 에 revision 과 그 revision 의 checksum 을 붙인다", () => {
    expect(finalizeRevision(DRAFT, 1)).toStrictEqual({
      ...DRAFT,
      revision: 1,
      checksum: computeBidChecksum({ ...DRAFT, revision: 1 }),
    });
  });

  it("결과가 normalizedBidSchema 를 통과한다", () => {
    expect(normalizedBidSchema.safeParse(finalizeRevision(DRAFT, 1)).success).toBe(true);
  });

  it("fetchedAt 만 다르면 checksum 이 같다", () => {
    const later = { ...DRAFT, fetchedAt: "2026-10-20T00:00:00.000Z" };
    expect(finalizeRevision(later, 1).checksum).toBe(finalizeRevision(DRAFT, 1).checksum);
  });

  it("revision 이 다르면 checksum 이 다르다", () => {
    expect(finalizeRevision(DRAFT, 2).checksum).not.toBe(finalizeRevision(DRAFT, 1).checksum);
  });

  it("같은 draft 와 revision 이면 매번 같은 checksum 을 낸다", () => {
    expect(finalizeRevision(structuredClone(DRAFT), 3).checksum).toBe(
      finalizeRevision(DRAFT, 3).checksum,
    );
  });

  it("draft 를 바꾸지 않는다", () => {
    const draft = structuredClone(DRAFT);
    finalizeRevision(draft, 1);
    expect(draft).toStrictEqual(DRAFT);
  });
});
