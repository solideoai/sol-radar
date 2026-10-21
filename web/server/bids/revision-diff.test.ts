import { describe, expect, it } from "vitest";
import { DIFF_CELL_LIMIT, diffText, toRevisionChanges } from "./revision-diff";
import type { TextSegment } from "./revision.model";

const join = (segments: TextSegment[], ops: TextSegment["op"][]): string =>
  segments
    .filter((segment) => ops.includes(segment.op))
    .map((segment) => segment.text)
    .join("");

describe("diffText", () => {
  it("바뀐 단어 하나를 removed 다음 added 로 낸다", () => {
    expect(diffText("a b c", "a x c")).toEqual([
      { op: "same", text: "a " },
      { op: "removed", text: "b" },
      { op: "added", text: "x" },
      { op: "same", text: " c" },
    ]);
  });

  it.each([
    ["사업 기간은 6개월이며 장소는 서울이다", "사업 기간은 8개월이며 장소는 대전이다"],
    ["a b c d e", "e d c b a"],
    ["  앞 공백이 있는 글", "앞 공백이 없는 글  "],
    ["하나\n둘\n셋", "하나\n셋\n넷\n다섯"],
  ])("조각을 이으면 앞뒤 글이 되고 이웃 조각의 op 는 다르다: %s", (before, after) => {
    const segments = diffText(before, after);
    expect(join(segments, ["same", "removed"])).toBe(before);
    expect(join(segments, ["same", "added"])).toBe(after);
    segments.slice(1).forEach((segment, index) => {
      expect(segment.op).not.toBe(segments[index].op);
    });
  });

  it("FX-07 꼴: 뒤에만 Kubernetes 가 있으면 added 하나만 그 단어를 담는다", () => {
    const segments = diffText(
      "클라우드 전환 사업 수행 능력을 평가한다",
      "클라우드 전환 사업 Kubernetes 수행 능력을 평가한다",
    );
    expect(segments.filter((segment) => segment.op === "removed")).toEqual([]);
    const added = segments.filter((segment) => segment.op === "added");
    expect(added).toHaveLength(1);
    expect(added[0].text).toContain("Kubernetes");
  });

  it("쉼표가 붙은 낱말은 구두점을 따로 떼어 같은 단어가 두 번 보이지 않는다", () => {
    const segments = diffText(
      "필수 기술은 Hadoop, Spark 이다.",
      "필수 기술은 Hadoop, Spark, Kubernetes 이다.",
    );
    expect(segments.filter((segment) => segment.op === "removed")).toEqual([]);
    const added = segments.filter((segment) => segment.op === "added");
    expect(added.some((segment) => segment.text === ",")).toBe(true);
    expect(added.some((segment) => segment.text.includes("Kubernetes"))).toBe(true);
    expect(join(segments, ["same", "added"])).toBe("필수 기술은 Hadoop, Spark, Kubernetes 이다.");
    expect(added.some((segment) => segment.text.includes("Spark"))).toBe(false);
  });

  it("소수점 숫자와 뒤 글자는 한 토큰이고 마침표는 따로 남는다", () => {
    const segments = diffText("사업예산은 18억원이다.", "사업예산은 21.6억원이다.");
    expect(segments.filter((segment) => segment.op === "removed")).toEqual([
      { op: "removed", text: "18억원이다" },
    ]);
    expect(segments.filter((segment) => segment.op === "added")).toEqual([
      { op: "added", text: "21.6억원이다" },
    ]);
    expect(segments.at(-1)).toEqual({ op: "same", text: "." });
  });

  it("같은 글은 same 하나다", () => {
    expect(diffText("같은 글", "같은 글")).toEqual([{ op: "same", text: "같은 글" }]);
  });

  it("빈 글에서 시작하면 added 하나, 둘 다 비면 빈 배열이다", () => {
    expect(diffText("", "x y")).toEqual([{ op: "added", text: "x y" }]);
    expect(diffText("x y", "")).toEqual([{ op: "removed", text: "x y" }]);
    expect(diffText("", "")).toEqual([]);
  });

  it("토큰 곱이 상한을 넘으면 통째로 바꾼다", () => {
    const count = 1001;
    const before = Array.from({ length: count }, (_, i) => `b${i}`).join(" ");
    const after = Array.from({ length: count }, (_, i) => `a${i}`).join(" ");
    // 공백 토큰까지 세므로 한 변이 2001 토큰, 곱은 상한을 훨씬 넘는다.
    expect((2 * count - 1) ** 2).toBeGreaterThan(DIFF_CELL_LIMIT);
    expect(diffText(before, after)).toEqual([
      { op: "removed", text: before },
      { op: "added", text: after },
    ]);
  });
});

describe("toRevisionChanges", () => {
  it("금액과 본문 변경을 낸다. amendmentNo 는 항목이 아니다", () => {
    const changes = toRevisionChanges(
      ["amendmentNo", "budgetKrw", "content"],
      { budgetKrw: "1800000000", content: "A" },
      { budgetKrw: "2160000000", content: "A B" },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      field: "budgetKrw",
      kind: "scalar",
      before: "1800000000",
      after: "2160000000",
    });
    expect(changes[1]).toMatchObject({ field: "content", kind: "text" });
  });

  it("DISPLAY_ORDER 순서로 낸다", () => {
    const changes = toRevisionChanges(["content", "deadlineAt"], {}, {});
    expect(changes.map((change) => change.field)).toEqual(["deadlineAt", "content"]);
  });

  it("모르는 이름은 버리고 없는 값은 null 이다", () => {
    expect(toRevisionChanges(["foo"], {}, {})).toEqual([]);
    expect(toRevisionChanges(["sourceUrl"], {}, { sourceUrl: "https://x.test" })).toEqual([
      { field: "sourceUrl", kind: "scalar", before: null, after: "https://x.test" },
    ]);
  });

  it("본문이 한쪽에만 없으면 빈 글로 본다", () => {
    expect(toRevisionChanges(["content"], {}, { content: "새 본문" })).toEqual([
      { field: "content", kind: "text", segments: [{ op: "added", text: "새 본문" }] },
    ]);
  });

  it("첨부는 이름으로 더해진 것·빠진 것·그대로를 나눈다", () => {
    const changes = toRevisionChanges(
      ["attachments"],
      { attachments: [{ name: "과업지시서.hwp" }] },
      { attachments: [{ name: "과업지시서.hwp" }, { name: "제안요청서.pdf" }] },
    );
    expect(changes).toEqual([
      {
        field: "attachments",
        kind: "list",
        added: ["제안요청서.pdf"],
        removed: [],
        kept: ["과업지시서.hwp"],
      },
    ]);
  });

  it("자격 항목은 값이 있으면 이름 뒤에 붙여 보인다", () => {
    const changes = toRevisionChanges(
      ["structuredQualifications"],
      { structuredQualifications: [{ name: "정보통신공사업", value: null }] },
      {
        structuredQualifications: [
          { name: "정보통신공사업", value: null },
          { name: "실적", value: "3건 이상" },
        ],
      },
    );
    expect(changes).toEqual([
      {
        field: "structuredQualifications",
        kind: "list",
        added: ["실적 3건 이상"],
        removed: [],
        kept: ["정보통신공사업"],
      },
    ]);
  });
});
