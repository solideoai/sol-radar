import { describe, expect, it } from "vitest";
import type { TextSegment } from "@/server/bids";
import { foldSegments } from "./text-diff";

const same = (n: number): TextSegment => ({ op: "same", text: "가".repeat(n) });

describe("foldSegments (스펙 §4.4)", () => {
  it("400자 이하 same 은 그대로 둔다", () => {
    const segments: TextSegment[] = [same(400), { op: "added", text: "추가" }];
    const { parts, foldable } = foldSegments(segments);
    expect(foldable).toBe(false);
    expect(parts).toEqual([
      { op: "same", text: "가".repeat(400) },
      { op: "added", text: "추가" },
    ]);
  });

  it("1,000자 첫 same 은 뒤 120자만 남기고 880자를 생략한다", () => {
    const { parts, foldable } = foldSegments([same(1000), { op: "added", text: "끝" }]);
    expect(foldable).toBe(true);
    expect(parts).toEqual([
      { op: "fold", text: "… 바뀌지 않은 880자 생략 …" },
      { op: "same", text: "가".repeat(120) },
      { op: "added", text: "끝" },
    ]);
  });

  it("마지막 same 은 앞 120자만, 가운데 same 은 앞뒤 120자씩 남긴다", () => {
    const tail = foldSegments([{ op: "removed", text: "옛" }, same(500)]);
    expect(tail.parts).toEqual([
      { op: "removed", text: "옛" },
      { op: "same", text: "가".repeat(120) },
      { op: "fold", text: "… 바뀌지 않은 380자 생략 …" },
    ]);
    const middle = foldSegments([
      { op: "added", text: "a" },
      same(1500),
      { op: "removed", text: "b" },
    ]);
    expect(middle.parts).toEqual([
      { op: "added", text: "a" },
      { op: "same", text: "가".repeat(120) },
      { op: "fold", text: "… 바뀌지 않은 1,260자 생략 …" },
      { op: "same", text: "가".repeat(120) },
      { op: "removed", text: "b" },
    ]);
  });

  it("added·removed 는 길어도 접지 않는다", () => {
    const long = "나".repeat(2000);
    const { parts, foldable } = foldSegments([
      { op: "removed", text: long },
      { op: "added", text: long },
      same(10),
    ]);
    expect(foldable).toBe(false);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ op: "removed", text: long });
  });

  it("same 이 없는 1,000자 통째 교체는 앞 240자 + 760자 더 있음으로 줄인다", () => {
    const { parts, foldable } = foldSegments([
      { op: "removed", text: "옛".repeat(1000) },
      { op: "added", text: "새".repeat(1000) },
    ]);
    expect(foldable).toBe(true);
    expect(parts).toEqual([
      { op: "removed", text: "옛".repeat(240) },
      { op: "fold", text: "… 760자 더 있음" },
      { op: "added", text: "새".repeat(240) },
      { op: "fold", text: "… 760자 더 있음" },
    ]);
  });

  it("글자 수는 코드 포인트 기준이라 이모지를 쪼개지 않는다", () => {
    const { parts } = foldSegments([{ op: "same", text: "😀".repeat(500) }]);
    expect(parts[0]).toEqual({ op: "same", text: "😀".repeat(120) });
    expect(parts[1]).toEqual({ op: "fold", text: "… 바뀌지 않은 380자 생략 …" });
  });

  it("조각이 same 하나뿐이면 앞 120자만 남긴다", () => {
    const { parts } = foldSegments([same(401)]);
    expect(parts).toEqual([
      { op: "same", text: "가".repeat(120) },
      { op: "fold", text: "… 바뀌지 않은 281자 생략 …" },
    ]);
  });
});
