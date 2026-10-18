import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { PeopleDirectory } from "./people-directory";
import type { PeopleDirectory as Directory, PeoplePage } from "@/server/people";
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => router }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});
beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});
const directory: Directory = {
  departments: [
    {
      id: "team",
      code: "SOL-D001",
      name: "긴 부서 이름 개발운영지원팀",
      kind: "TEAM",
      parentId: null,
      targetCount: 2,
      memberCount: 2,
    },
  ],
  jobTitles: [{ id: "title", code: "SOL-J001", label: "책임" }],
  members: [],
  summary: { totalCount: 41, scoringCount: 7 },
};
const member = {
  id: "member",
  personCode: "SOL-P0001",
  name: "김민준",
  departmentId: "team",
  jobTitleId: "title",
  portraitUrl: null,
  scoringEligible: true,
  isDemo: true as const,
};
const list: PeoplePage = {
  items: [member],
  pageInfo: {
    cursor: "page2",
    nextCursor: "page3",
    previousCursor: null,
    hasNext: true,
    startIndex: 20,
  },
  totalCount: 41,
  summary: directory.summary,
};
const render = (props: Partial<React.ComponentProps<typeof PeopleDirectory>> = {}) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(
    <PeopleDirectory
      query="scoring=1&cursor=page2"
      view="list"
      directory={{ status: "ready", data: directory }}
      list={{ status: "ready", data: list }}
      {...props}
    />,
  );
  return root;
};
describe("people list", () => {
  it("clears all unsubmitted drafts on the default URL and submits without filters", async () => {
    render({ query: "" });
    const name = page.getByRole("textbox", { name: "이름", exact: true });
    const department = page.getByRole("combobox", { name: "부서", exact: true });
    const jobTitle = page.getByRole("combobox", { name: "직급/직책", exact: true });
    const scoring = page.getByRole("combobox", { name: "점수 계산 대상", exact: true });
    await name.fill("미적용 이름");
    await department.click();
    await page.getByRole("option", { name: "긴 부서 이름 개발운영지원팀", exact: true }).click();
    await jobTitle.click();
    await page.getByRole("option", { name: "책임", exact: true }).click();
    await scoring.click();
    await page.getByRole("option", { name: "대상", exact: true }).click();
    await expect.element(name).toHaveValue("미적용 이름");
    await expect.element(department).toHaveTextContent("긴 부서 이름 개발운영지원팀");
    await expect.element(jobTitle).toHaveTextContent("책임");
    await expect.element(scoring).toHaveTextContent("대상");
    expect(router.push).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    expect(router.push).toHaveBeenCalledWith("/people", { scroll: false });
    await expect.element(name).toHaveValue("");
    await expect.element(department).toHaveTextContent("전체 부서");
    await expect.element(jobTitle).toHaveTextContent("전체 직급/직책");
    await expect.element(scoring).toHaveTextContent("전체");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const submitted = new URL(router.push.mock.calls.at(-1)?.[0], "http://local");
    expect(submitted.pathname).toBe("/people");
    for (const key of ["q", "departmentId", "jobTitleId", "scoring", "cursor"]) {
      expect(submitted.searchParams.has(key)).toBe(false);
    }
  });

  it("offers retry for an empty whole organization without invented totals", async () => {
    render({
      view: "tree",
      directory: {
        status: "ready",
        data: {
          departments: [],
          jobTitles: [],
          members: [],
          summary: { totalCount: 0, scoringCount: 0 },
        },
      },
    });
    await expect
      .element(page.getByText("등록된 조직·인력이 없습니다", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it.each([0, 41])(
    "distinguishes empty directory vs zero filtered results with organization total%i",
    async (totalCount) => {
      render({
        list: {
          status: "ready",
          data: {
            ...list,
            items: [],
            totalCount: 0,
            pageInfo: {
              cursor: null,
              nextCursor: null,
              previousCursor: null,
              hasNext: false,
              startIndex: 0,
            },
            summary: { totalCount, scoringCount: 0 },
          },
        },
      });
      await expect
        .element(
          page.getByText(totalCount ? "조건에 맞는 인력이 없습니다" : "등록된 인력이 없습니다", {
            exact: true,
          }),
        )
        .toBeVisible();
      expect(document.body.textContent).not.toContain("0–0명");
      await expect.element(page.getByRole("button", { name: "이전", exact: true })).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
    },
  );

  it("opens shared drawer then discards selection on URL change and history return", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...member, scoring: null })));
    try {
      const root = render();
      await page.getByRole("button", { name: "김민준 상세 보기", exact: true }).click();
      await expect.element(page.getByRole("dialog", { name: "김민준", exact: true })).toBeVisible();
      root.render(
        <PeopleDirectory
          query="q=새조건"
          view="list"
          directory={{ status: "ready", data: directory }}
          list={{ status: "ready", data: list }}
        />,
      );
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
      root.render(
        <PeopleDirectory
          query="scoring=1&cursor=page2"
          view="list"
          directory={{ status: "ready", data: directory }}
          list={{ status: "ready", data: list }}
        />,
      );
      await expect
        .element(page.getByRole("textbox", { name: "이름", exact: true }))
        .toHaveValue("");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows server counts, labels, range and enables null-cursor previous on page two", async () => {
    render();
    await expect
      .element(page.getByText("전체 41명 · 점수 계산 대상 7명", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("전체 41명 중 21–21명", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "김민준 상세 보기" })).toBeVisible();
    await page.getByRole("button", { name: "이전", exact: true }).click();
    expect(new URL(router.push.mock.calls[0][0], "http://local").searchParams.has("cursor")).toBe(
      false,
    );
    expect(new URL(router.push.mock.calls[0][0], "http://local").searchParams.get("scoring")).toBe(
      "1",
    );
  });
  it("applies a draft name only on search and resets cursor", async () => {
    render();
    await page.getByRole("textbox", { name: "이름", exact: true }).fill("김");
    expect(router.push).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const url = new URL(router.push.mock.calls[0][0], "http://local");
    expect(url.searchParams.get("q")).toBe("김");
    expect(url.searchParams.has("cursor")).toBe(false);
  });
  it("uses URL state after back/forward-like rerender", async () => {
    const root = render();
    await page.getByRole("textbox", { name: "이름", exact: true }).fill("작성중");
    root.render(
      <PeopleDirectory
        query="q=복원"
        view="list"
        directory={{ status: "ready", data: directory }}
        list={{ status: "ready", data: list }}
      />,
    );
    await expect
      .element(page.getByRole("textbox", { name: "이름", exact: true }))
      .toHaveValue("복원");
  });
  it("never invents totals on initial catalog failure and retries", async () => {
    render({
      directory: { status: "error", code: "SERVICE_UNAVAILABLE" },
      list: { status: "error", code: "SERVICE_UNAVAILABLE" },
    });
    await expect
      .element(page.getByText("인력 명부를 불러오지 못했습니다", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("전체 200명");
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it.each([1280, 1440])("fits at %ipx with open sidebar space", async (width) => {
    await page.viewport(width, 900);
    const host = document.body.appendChild(document.createElement("div"));
    host.style.marginLeft = "256px";
    const root = createRoot(host);
    mounted.push(root);
    root.render(
      <PeopleDirectory
        query=""
        view="list"
        directory={{ status: "ready", data: directory }}
        list={{ status: "ready", data: list }}
      />,
    );
    await expect.element(page.getByRole("button", { name: "김민준 상세 보기" })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  });
});
