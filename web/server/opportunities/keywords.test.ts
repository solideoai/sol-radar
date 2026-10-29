import { describe, expect, it } from "vitest";
import { keywordFilterOf } from "./keywords";

describe("분야 키워드 칩(ADR-069)", () => {
  it("고른 칩을 분류·태그 OR 식으로 바꾼다", () => {
    expect(keywordFilterOf([])).toBeNull();
    expect(keywordFilterOf(["AI_AX", "MAINTENANCE"])).toBe(
      "categories.ov.{AI_AX},tags.ov.{maintenance}",
    );
    expect(keywordFilterOf(["DIGITAL_TWIN"])).toBe(
      "categories.ov.{DIGITAL_TWIN},tags.ov.{BIM,smartcity}",
    );
    expect(keywordFilterOf(["ISP_ISMP", "ISP_ISMP"])).toBe("tags.ov.{ISP,ISMP}");
  });
});
