import { expect, it } from "vitest";
import { analysisViewSchema } from "./analysis-view.model";

it("번역 누락으로 규칙만 사용한 분석의 검토 플래그를 상세 화면 계약이 받아들인다", () => {
  expect(
    analysisViewSchema.shape.reviewFlags.safeParse(["TRANSLATION_INCOMPLETE", "KEV_UNAVAILABLE"])
      .success,
  ).toBe(true);
});
