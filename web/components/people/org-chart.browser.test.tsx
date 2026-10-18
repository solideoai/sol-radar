import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { OrgChart } from "./org-chart";
import type { PeopleDirectory } from "@/server/people";
const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});
const data: PeopleDirectory = {
  departments: [
    {
      id: "division",
      code: "d",
      name: "자연 본부",
      kind: "DIVISION",
      parentId: null,
      targetCount: null,
      memberCount: 80,
    },
    {
      id: "direct",
      code: "t",
      name: "직속팀",
      kind: "TEAM",
      parentId: "division",
      targetCount: 80,
      memberCount: 80,
    },
    {
      id: "group",
      code: "g",
      name: "미확인 그룹",
      kind: "GROUP",
      parentId: null,
      targetCount: null,
      memberCount: 0,
    },
    {
      id: "unknown",
      code: "u",
      name: "미확인 팀",
      kind: "TEAM",
      parentId: null,
      targetCount: 120,
      memberCount: 120,
    },
  ],
  jobTitles: [{ id: "j", code: "j", label: "책임" }],
  members: Array.from({ length: 200 }, (_, index) => ({
    id: `person-${index}`,
    personCode: `SOL-P${String(index + 1).padStart(4, "0")}`,
    name: `가상직원${index + 1}`,
    departmentId: index < 80 ? "direct" : "unknown",
    jobTitleId: "j",
    portraitUrl: null,
    scoringEligible: index < 27,
    isDemo: true as const,
  })),
  summary: { totalCount: 200, scoringCount: 27 },
};
const render = () => {
  const onSelect = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(<OrgChart directory={data} onSelect={onSelect} />);
  return onSelect;
};
describe("full organization chart", () => {
  it("discloses every200 person once and collapses again without inventing a group parent", async () => {
    const select = render();
    await expect.element(page.getByRole("heading", { name: "본부", exact: true })).toBeVisible();
    expect(document.querySelectorAll('button[aria-label$="상세 보기"]')).toHaveLength(0);
    await page.getByRole("button", { name: "모두 펼치기", exact: true }).click();
    expect(document.querySelectorAll('button[aria-label$="상세 보기"]')).toHaveLength(200);
    expect(
      new Set(
        [...document.querySelectorAll("[data-person-id]")].map((node) =>
          node.getAttribute("data-person-id"),
        ),
      ).size,
    ).toBe(200);
    await page.getByRole("button", { name: "가상직원200 상세 보기", exact: true }).click();
    expect(select.mock.calls[0][0].id).toBe("person-199");
    await expect
      .element(page.getByText("2개 부서 · 소속 인력 120명", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("소속 인력 0명 · 연결된 팀 없음", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "모두 접기", exact: true }).click();
    expect(document.querySelectorAll('button[aria-label$="상세 보기"]')).toHaveLength(0);
  });
  it.each([1280, 1440])("keeps expanded tree inside %ipx with sidebar space", async (width) => {
    await page.viewport(width, 900);
    document.body.style.paddingLeft = "256px";
    try {
      render();
      await page.getByRole("button", { name: "모두 펼치기", exact: true }).click();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    } finally {
      document.body.style.paddingLeft = "";
    }
  });
});
