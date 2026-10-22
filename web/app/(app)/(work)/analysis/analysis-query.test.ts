import { expect, it } from "vitest";
import { comparisonSelection } from "./analysis-query";

it("공유 URL 중복은 제거하고 초과·잘못된 선택은 비교하지 않는다", () => {
  const ids = [1, 2, 3, 4, 5].map(
    (value) => `a0000000-0000-4000-8000-${String(value).padStart(12, "0")}`,
  );
  expect(comparisonSelection(`${ids[0]},${ids[0]},${ids[1]}`)).toEqual({
    ids: ids.slice(0, 2),
    notice: null,
  });
  expect(comparisonSelection(ids.join(","))).toMatchObject({ ids: [], notice: expect.any(String) });
  expect(comparisonSelection("bad")).toMatchObject({ ids: [], notice: expect.any(String) });
});
