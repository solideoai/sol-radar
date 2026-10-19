import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { OrgChart } from "./org-chart";
import { OrgChartDirectory, OrgChartPending } from "./org-chart-directory";
import type { PeopleDirectory } from "@/server/people";
const { router, fetchDetail } = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  fetchDetail: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => {
    const [search, setSearch] = useState(window.location.search);
    useEffect(() => {
      const update = () => setSearch(window.location.search);
      window.addEventListener("popstate", update);
      return () => window.removeEventListener("popstate", update);
    }, []);
    return new URLSearchParams(search);
  },
}));
const mounted: Root[] = [];
const originalPush = history.pushState.bind(history);
const originalReplace = history.replaceState.bind(history);
beforeEach(() => {
  originalReplace(null, "", "/org-chart");
  vi.spyOn(history, "pushState").mockImplementation((...args) => {
    originalPush(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  vi.spyOn(history, "replaceState").mockImplementation((...args) => {
    originalReplace(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.paddingLeft = "";
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
      memberCount: 999,
    },
    {
      id: "empty-division",
      code: "e",
      name: "P&AX컨설팅본부",
      kind: "DIVISION",
      parentId: null,
      targetCount: null,
      memberCount: 0,
    },
    {
      id: "direct",
      code: "a",
      name: "자연 본부 직속팀",
      kind: "TEAM",
      parentId: "division",
      targetCount: 80,
      memberCount: 999,
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
      targetCount: null,
      memberCount: 999,
    },
    {
      id: "empty",
      code: "z",
      name: "빈 팀",
      kind: "TEAM",
      parentId: "division",
      targetCount: null,
      memberCount: 0,
    },
  ],
  jobTitles: [
    { id: "senior", code: "z", label: "수석" },
    { id: "junior", code: "a", label: "책임" },
  ],
  members: Array.from({ length: 200 }, (_, index) => ({
    id: `person-${index}`,
    personCode: `SOL-P${String(index + 1).padStart(4, "0")}`,
    name: index === 0 ? "가나" : index === 1 ? "나나" : `직원${String(index + 1).padStart(3, "0")}`,
    departmentId: index < 80 ? "direct" : "unknown",
    jobTitleId: index === 1 ? "senior" : "junior",
    portraitUrl: null,
    scoringEligible: index < 27,
    isDemo: true as const,
  })),
  summary: { totalCount: 200, scoringCount: 27 },
};
const render = (directory = data, withHeader = false) => {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(
    <>
      {withHeader ? <header className="h-12 shrink-0 border-b border-border" /> : null}
      <OrgChart directory={directory} onSelect={onSelect} onRetry={onRetry} />
    </>,
  );
  return { onSelect, onRetry };
};
describe("organization explorer", () => {
  it.each([
    ["자연 본부", "80명"],
    ["자연 본부 직속팀", "80명"],
    ["상위 미지정", "2개 부서 · 120명"],
    ["나나 상세 보기", "수석 점수 계산 대상"],
    ["직원028 상세 보기", "책임"],
  ])("describes %s with visible metadata: %s", async (name, description) => {
    render();
    const button = page.getByRole("button", { name, exact: true });
    await expect.element(button).toBeVisible();
    await expect.element(button, { timeout: 1000 }).toHaveAccessibleDescription(description);
  });
  it("keeps person action names and visible scoring metadata with an accessible Avatar", async () => {
    render();
    const scoring = page.getByRole("button", { name: "나나 상세 보기", exact: true });
    await expect.element(scoring).toHaveAccessibleName("나나 상세 보기");
    const card = scoring.element().closest("li")!;
    expect(card.textContent).toContain("수석");
    expect(card.textContent).toContain("점수 계산 대상");
    await expect
      .element(page.getByRole("img", { name: "나나 프로필 사진 없음", exact: true }))
      .toBeVisible();
  });
  it.each(["avatar", "title", "scoring"])(
    "opens detail when clicking the card's %s outside its name",
    async (area) => {
      const { onSelect } = render();
      const button = page.getByRole("button", { name: "나나 상세 보기", exact: true });
      await expect.element(button).toBeVisible();
      const container = button.element().closest("li")!;
      const target =
        area === "avatar"
          ? container.querySelector('[data-slot="avatar"]')!
          : [...container.querySelectorAll("span")].find(
              (element) => element.textContent === (area === "title" ? "수석" : "점수 계산 대상"),
            )!;
      const bounds = container.getBoundingClientRect();
      const hit = target.getBoundingClientRect();
      // The visible metadata is covered by the real button's stretched hit area.
      // Send a physical click at that point instead of requiring the metadata itself to receive it.
      await userEvent.click(container, {
        force: true,
        position: { x: hit.x - bounds.x + hit.width / 2, y: hit.y - bounds.y + hit.height / 2 },
      });
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(data.members[1], button.element());
    },
  );
  it.each([1280, 1440])(
    "keeps a long tree inside its pane at %ipx with a short selected team",
    async (width) => {
      await page.viewport(width, 1000);
      document.body.style.paddingLeft = "256px";
      render(
        {
          ...data,
          members: data.members.slice(0, 5),
          departments: [
            ...data.departments,
            ...Array.from({ length: 35 }, (_, index) => ({
              id: `long-team-${index}`,
              code: `u${index}`,
              name: `상위 미지정 부서 탐색용 긴 이름의 팀 ${index + 1}`,
              kind: "TEAM" as const,
              parentId: null,
              targetCount: null,
              memberCount: 0,
            })),
          ],
          summary: { totalCount: 5, scoringCount: 5 },
        },
        true,
      );
      const pane = page.getByRole("complementary", { name: "부서 탐색", exact: true });
      await expect.element(pane).toBeVisible();
      const element = pane.element();
      const bounds = element.getBoundingClientRect();
      console.info("org-tree-geometry", {
        width,
        viewportHeight: innerHeight,
        top: bounds.top,
        bottom: bounds.bottom,
        paneClientHeight: element.clientHeight,
        paneScrollHeight: element.scrollHeight,
        documentHeight: document.documentElement.scrollHeight,
      });
      expect(bounds.width).toBe(300);
      expect(bounds.top).toBeGreaterThan(150);
      expect(bounds.bottom).toBeLessThanOrEqual(innerHeight - 24);
      expect(element.scrollHeight).toBeGreaterThan(element.clientHeight);
      expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(innerHeight);
      const documentTop = window.scrollY;
      await pane.wheel({ delta: { y: 240 } });
      await expect.poll(() => element.scrollTop).toBeGreaterThan(0);
      expect(window.scrollY).toBe(documentTop);
      element.scrollTop = element.scrollHeight;
      const last = document.querySelector("#org-unassigned-teams")!.lastElementChild!;
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(bounds.top);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    },
  );
  it("selects a real default team, counts unique people and exposes empty divisions without arrows", async () => {
    render();
    await expect.element(page.getByRole("heading", { name: "조직도", exact: true })).toBeVisible();
    await expect
      .element(
        page.getByRole("heading", { name: "자연 본부 직속팀 · 80명 · 목표 80명", exact: true }),
      )
      .toBeVisible();
    await expect.poll(() => new URLSearchParams(location.search).get("team")).toBe("direct");
    expect(document.querySelectorAll("[data-person-id]")).toHaveLength(80);
    expect(document.querySelector('[role="tree"]')).toBeNull();
    expect(document.body.textContent).toContain("전체 200명 · 본부 2 · 그룹 1 · 팀 3");
    expect(document.body.textContent).toContain("본부 · 80명");
    expect(document.body.textContent).toContain("상위 미지정 · 2개 부서 · 120명");
    expect(document.querySelector('button[aria-label="P&AX컨설팅본부"]')).toBeNull();
    const emptyDivision = page.getByText("P&AX컨설팅본부", { exact: true }).element().closest("li");
    expect(emptyDivision?.querySelector("button")).toBeNull();
    expect(emptyDivision?.textContent).toContain("연결된 팀 없음");
    expect(
      [...document.querySelectorAll("[data-person-id]")]
        .slice(0, 2)
        .map((node) => node.getAttribute("data-person-id")),
    ).toEqual(["person-1", "person-0"]);
  });
  it("collapses and reopens UI bundles without changing team selection or empty department rows", async () => {
    render();
    const section = page.getByRole("button", { name: "상위 미지정", exact: true });
    const groups = page.getByRole("button", { name: "그룹 1개", exact: true });
    const teams = page.getByRole("button", { name: "팀 1개", exact: true });
    await expect.element(section).toHaveAttribute("aria-expanded", "true");
    await expect.element(section).toHaveAttribute("aria-controls", "org-unassigned-content");
    await expect.element(groups).toHaveAttribute("aria-controls", "org-unassigned-groups");
    await expect.element(teams).toHaveAttribute("aria-controls", "org-unassigned-teams");
    await groups.click();
    await expect.element(groups).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByText("미확인 그룹", { exact: true })).not.toBeVisible();
    await groups.click();
    const emptyGroup = page.getByText("미확인 그룹", { exact: true }).element().closest("li");
    expect(emptyGroup?.querySelector("button")).toBeNull();
    expect(emptyGroup?.textContent).toContain("0명 · 연결된 팀 없음");
    const unknownTeam = page.getByRole("button", { name: "미확인 팀", exact: true }).element();
    await teams.click();
    await expect.element(teams).toHaveAttribute("aria-expanded", "false");
    await expect.element(unknownTeam).not.toBeVisible();
    await teams.click();
    await expect
      .element(page.getByRole("button", { name: "미확인 팀", exact: true }))
      .toBeVisible();
    await section.click();
    await expect.element(section).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("org-unassigned-content")?.hidden).toBe(true);
    expect(location.search).toBe("?team=direct");
    expect(document.querySelectorAll("[data-person-id]")).toHaveLength(80);
    await section.click();
    await expect
      .element(page.getByRole("button", { name: "미확인 팀", exact: true }))
      .toBeVisible();
    expect(document.body.textContent).toContain("상위 미지정 · 2개 부서 · 120명");
  });
  it.each(["teams", "groups"])(
    "finder expands a collapsed unknown section and containing %s bundle only",
    async (bundle) => {
      const directory =
        bundle === "groups"
          ? {
              ...data,
              departments: data.departments.map((department) =>
                department.id === "unknown" ? { ...department, parentId: "group" } : department,
              ),
            }
          : data;
      const { onSelect } = render(directory);
      const containingBundle = page.getByRole("button", {
        name: bundle === "groups" ? "그룹 1개" : "팀 1개",
        exact: true,
      });
      await containingBundle.click();
      await page.getByRole("button", { name: "상위 미지정", exact: true }).click();
      const finder = page.getByRole("combobox", { name: "이름으로 찾기", exact: true });
      await finder.fill("직원200");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");
      await expect
        .element(page.getByRole("button", { name: "직원200 상세 보기", exact: true }))
        .toHaveFocus();
      await expect
        .element(page.getByRole("button", { name: "상위 미지정", exact: true }))
        .toHaveAttribute("aria-expanded", "true");
      await expect.element(containingBundle).toHaveAttribute("aria-expanded", "true");
      await expect
        .element(page.getByRole("button", { name: "미확인 팀", exact: true }))
        .toHaveAttribute("aria-current", "true");
      if (bundle === "groups")
        await expect
          .element(page.getByRole("button", { name: "미확인 그룹", exact: true }))
          .toHaveAttribute("aria-expanded", "true");
      expect(onSelect).not.toHaveBeenCalled();
      expect(location.search).toBe("?team=unknown");
    },
  );
  it("restores the containing unknown UI path on deep link and Back while preserving unrelated collapsed bundles", async () => {
    originalReplace(null, "", "/org-chart?team=unknown");
    render();
    const section = page.getByRole("button", { name: "상위 미지정", exact: true });
    const teams = page.getByRole("button", { name: "팀 1개", exact: true });
    const groups = page.getByRole("button", { name: "그룹 1개", exact: true });
    await expect.element(section).toHaveAttribute("aria-expanded", "true");
    await expect.element(teams).toHaveAttribute("aria-expanded", "true");
    await groups.click();
    await page.getByRole("button", { name: "자연 본부", exact: true }).click();
    await page.getByRole("button", { name: "자연 본부 직속팀", exact: true }).click();
    await teams.click();
    await section.click();
    history.back();
    await expect
      .element(page.getByRole("button", { name: "미확인 팀", exact: true }))
      .toHaveAttribute("aria-current", "true");
    await expect.element(section).toHaveAttribute("aria-expanded", "true");
    await expect.element(teams).toHaveAttribute("aria-expanded", "true");
    await expect.element(groups).toHaveAttribute("aria-expanded", "false");
  });
  it("selects every employee exactly once across teams and keeps unknown breadcrumbs and empty teams", async () => {
    const { onSelect } = render();
    await expect
      .element(page.getByRole("button", { name: "자연 본부 직속팀", exact: true }))
      .toHaveAttribute("aria-current", "true");
    const ids = [...document.querySelectorAll("[data-person-id]")].map((node) =>
      node.getAttribute("data-person-id"),
    );
    await page.getByRole("button", { name: "미확인 팀", exact: true }).click();
    await expect
      .element(page.getByRole("heading", { name: "미확인 팀 · 120명", exact: true }))
      .toBeVisible();
    expect(document.body.textContent).toContain("상위 부서 미지정");
    ids.push(
      ...[...document.querySelectorAll("[data-person-id]")].map((node) =>
        node.getAttribute("data-person-id"),
      ),
    );
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
    await page.getByRole("button", { name: "직원200 상세 보기", exact: true }).click();
    expect(onSelect.mock.calls[0][0].id).toBe("person-199");
    await page.getByRole("button", { name: "빈 팀", exact: true }).click();
    await expect.element(page.getByText("소속 인력이 없습니다", { exact: true })).toBeVisible();
    expect(location.search).toBe("?team=empty");
  });
  it.each(["foreign", "division", "", "malformed"])(
    'safely defaults invalid team "%s" without an error',
    async (team) => {
      originalReplace(null, "", `/org-chart?team=${team}`);
      render();
      await expect
        .element(
          page.getByRole("heading", { name: "자연 본부 직속팀 · 80명 · 목표 80명", exact: true }),
        )
        .toBeVisible();
      await expect.poll(() => new URLSearchParams(location.search).get("team")).toBe("direct");
    },
  );
  it("finds at most8 names by keyboard, selects their team and focuses a card without opening detail", async () => {
    const { onSelect } = render();
    const finder = page.getByRole("combobox", { name: "이름으로 찾기", exact: true });
    await finder.fill("직원");
    await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBe(8);
    await finder.fill("직원200");
    await expect
      .element(page.getByRole("option", { name: "직원200 · 미확인 팀 · 책임", exact: true }))
      .toBeVisible();
    await finder.click();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    const card = page.getByRole("button", { name: "직원200 상세 보기", exact: true });
    await expect.element(card).toHaveFocus();
    expect(location.search).toBe("?team=unknown");
    expect(onSelect).not.toHaveBeenCalled();
    await expect.element(card).toHaveAttribute("data-highlighted", "true");
    const cardBounds = card.element().closest("[data-person-id]")!.getBoundingClientRect();
    expect(cardBounds.top).toBeGreaterThanOrEqual(0);
    expect(cardBounds.bottom).toBeLessThanOrEqual(innerHeight);
    await finder.fill("없는 이름");
    await expect.element(page.getByText("일치하는 이름이 없습니다", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(finder).toHaveAttribute("aria-expanded", "false");
  });
  it("expires finder intent while away so returning does not repeat highlight or steal navigation focus", async () => {
    const { onSelect } = render();
    const finder = page.getByRole("combobox", { name: "이름으로 찾기", exact: true });
    await finder.fill("직원200");
    await userEvent.keyboard("{ArrowDown}");
    const pickedAt = performance.now();
    await userEvent.keyboard("{Enter}");
    const card = page.getByRole("button", { name: "직원200 상세 보기", exact: true });
    await expect.element(card).toHaveFocus();
    await expect.element(card).toHaveAttribute("data-highlighted", "true");
    await page.getByRole("button", { name: "자연 본부 직속팀", exact: true }).click();
    await expect
      .element(
        page.getByRole("heading", { name: "자연 본부 직속팀 · 80명 · 목표 80명", exact: true }),
      )
      .toBeVisible();
    expect(performance.now() - pickedAt).toBeLessThan(1600);
    // Wait past the product's1600ms lifetime while the searched card is not rendered.
    await new Promise((resolve) => window.setTimeout(resolve, 1700));
    const returnTeam = page.getByRole("button", { name: "미확인 팀", exact: true });
    await returnTeam.click();
    await expect
      .element(page.getByRole("heading", { name: "미확인 팀 · 120명", exact: true }))
      .toBeVisible();
    expect(card.element().getAttribute("data-highlighted")).not.toBe("true");
    expect(document.activeElement).toBe(returnTeam.element());
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("restores a valid team on initial load and browser history", async () => {
    originalReplace(null, "", "/org-chart?team=unknown");
    render();
    await expect
      .element(page.getByRole("heading", { name: "미확인 팀 · 120명", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "자연 본부", exact: true }).click();
    await page.getByRole("button", { name: "자연 본부 직속팀", exact: true }).click();
    history.back();
    await expect
      .element(page.getByRole("heading", { name: "미확인 팀 · 120명", exact: true }))
      .toBeVisible();
  });
  it("retries a truly empty directory without invented counts", async () => {
    const { onRetry } = render({
      departments: [],
      jobTitles: [],
      members: [],
      summary: { totalCount: 0, scoringCount: 0 },
    });
    await expect
      .element(page.getByText("등록된 조직·인력이 없습니다", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it.each([
    [1280, 3],
    [1440, 4],
  ])("measures %ipx grid with expanded sidebar space", async (width, columns) => {
    await page.viewport(width, 900);
    document.body.style.paddingLeft = "256px";
    render();
    await expect.element(page.getByRole("heading", { name: "조직도", exact: true })).toBeVisible();
    const grid = document.querySelector('[data-slot="org-people-grid"]');
    expect(grid).not.toBeNull();
    expect(getComputedStyle(grid!).gridTemplateColumns.split(" ")).toHaveLength(columns);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const avatar = document.querySelector('[data-person-id] [data-slot="avatar"]');
    expect(avatar?.getBoundingClientRect().width).toBe(44);
  });
  it.each(["{Enter}", " "])(
    "opens the shared Drawer with %s and returns focus on Escape",
    async (key) => {
      vi.stubGlobal("fetch", fetchDetail);
      fetchDetail.mockResolvedValue(Response.json({ ...data.members[1], scoring: null }));
      const root = createRoot(document.body.appendChild(document.createElement("div")));
      mounted.push(root);
      root.render(<OrgChartDirectory directory={{ status: "ready", data }} />);
      const card = page.getByRole("button", { name: "나나 상세 보기", exact: true });
      await expect.element(card).toBeVisible();
      card.element().focus();
      await userEvent.keyboard(key);
      await expect.element(page.getByRole("dialog", { name: "나나", exact: true })).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(card).toHaveFocus();
    },
  );
  it("shows recoverable directory errors with requestId but no partial counts", async () => {
    router.refresh.mockReset();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted.push(root);
    root.render(
      <OrgChartDirectory
        directory={{ status: "error", code: "SERVICE_UNAVAILABLE", requestId: "public-request" }}
      />,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("조직도를 불러오지 못했습니다");
    expect(document.body.textContent).toContain("public-request");
    expect(document.body.textContent).not.toContain("전체 200명");
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it("renders a loading skeleton without fixed or partial numbers", async () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted.push(root);
    root.render(<OrgChartPending />);
    await expect.element(page.getByRole("status")).toHaveTextContent("조직도를 불러오는 중입니다");
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain("200");
  });
});
