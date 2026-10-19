import { describe, expect, it } from "vitest";
import { isVisibleAt, revisionAsOf } from "./point-in-time";

// 15 §7 시점 일치: 결정 시각 이전에 수집된 revision 만 쓴다(fetchedAt <= 결정 시각).
const R1 = { revision: 1, fetchedAt: "2026-10-16T00:00:00.000Z" };
const R2 = { revision: 2, fetchedAt: "2026-10-18T00:00:00.000Z" };
const R3 = { revision: 3, fetchedAt: "2026-10-20T00:00:00.000Z" };
const at = (iso: string) => new Date(iso);

describe("isVisibleAt", () => {
  it("결정 시각보다 먼저 수집된 revision 은 보인다", () => {
    expect(isVisibleAt(R1, at("2026-10-17T00:00:00.000Z"))).toBe(true);
  });

  it("결정 시각과 같은 시각에 수집된 revision 은 보인다", () => {
    expect(isVisibleAt(R2, at("2026-10-18T00:00:00.000Z"))).toBe(true);
  });

  it("결정 시각보다 1ms 뒤에 수집된 revision 은 보이지 않는다", () => {
    expect(isVisibleAt(R2, at("2026-10-17T23:59:59.999Z"))).toBe(false);
  });
});

describe("revisionAsOf", () => {
  it("결정 시각에 보이는 revision 중 가장 큰 것을 고른다", () => {
    expect(revisionAsOf([R1, R2, R3], at("2026-10-19T00:00:00.000Z"))).toEqual(R2);
  });

  it("결정 시각과 fetchedAt 이 같은 revision 을 포함한다", () => {
    expect(revisionAsOf([R1, R2, R3], at("2026-10-18T00:00:00.000Z"))).toEqual(R2);
  });

  it("결정 시각이 fetchedAt 보다 1ms 앞이면 그 revision 을 빼고 앞 revision 을 고른다", () => {
    expect(revisionAsOf([R1, R2, R3], at("2026-10-17T23:59:59.999Z"))).toEqual(R1);
  });

  it("모두 보이면 마지막 revision 을 고른다", () => {
    expect(revisionAsOf([R1, R2, R3], at("2026-10-21T00:00:00.000Z"))).toEqual(R3);
  });

  it("입력 순서와 무관하게 같은 revision 을 고른다", () => {
    expect(revisionAsOf([R3, R1, R2], at("2026-10-19T00:00:00.000Z"))).toEqual(R2);
  });

  it("뒤섞인 입력에서 모두 보이면 마지막 원소가 아니라 가장 큰 revision 을 고른다", () => {
    expect(revisionAsOf([R3, R1, R2], at("2026-10-21T00:00:00.000Z"))).toEqual(R3);
  });

  it("보이는 revision 이 없으면 null 이다", () => {
    expect(revisionAsOf([R1, R2, R3], at("2026-10-15T00:00:00.000Z"))).toBeNull();
  });

  it("빈 목록이면 null 이다", () => {
    expect(revisionAsOf([], at("2026-10-19T00:00:00.000Z"))).toBeNull();
  });

  it("고른 원소의 다른 필드를 그대로 돌려준다", () => {
    const revisions = [
      { ...R1, revisionId: "rev-1" },
      { ...R2, revisionId: "rev-2" },
    ];
    expect(revisionAsOf(revisions, at("2026-10-19T00:00:00.000Z"))).toEqual({
      ...R2,
      revisionId: "rev-2",
    });
  });

  it("입력 배열의 순서를 바꾸지 않는다", () => {
    const revisions = [R3, R1, R2];
    revisionAsOf(revisions, at("2026-10-19T00:00:00.000Z"));
    expect(revisions).toEqual([R3, R1, R2]);
  });
});
