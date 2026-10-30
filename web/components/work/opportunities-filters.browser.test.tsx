import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { OpportunityFilters } from "@/components/work/opportunities-filters";

const navigation = vi.hoisted(() => ({
  pathname: "/bids",
  query: "",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

let root: Root | undefined;
function show(query = "", pathname = "/bids") {
  navigation.pathname = pathname;
  navigation.query = query;
  function Harness() {
    const [currentQuery, setQuery] = useState(query);
    const [, startTransition] = useTransition();
    navigation.push.mockImplementation((href: string) => {
      navigation.query = href.split("?")[1] ?? "";
      setQuery(navigation.query);
    });
    return (
      <div style={{ width: "calc(100vw - 320px)" }}>
        <OpportunityFilters
          query={currentQuery}
          defaultOrigin="live"
          agencies={[{ id: "agency-1", name: "시험 기관" }]}
          companies={[{ id: "company-1", name: "시험 회사" }]}
          startTransition={startTransition}
        />
      </div>
    );
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  flushSync(() => root?.render(<Harness />));
}

afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.replaceChildren();
  navigation.push.mockReset();
});

it("입찰 공고 필터가 모두 보이고 다중 선택은 나머지 URL 조건을 보존한다", async () => {
  await page.viewport(1280, 900);
  show("q=cloud&agencyId=agency-1&recommendation=BID&origin=demo&cursor=next&limit=10&asOf=old");
  await expect.element(page.getByRole("searchbox")).toBeVisible();
  for (const id of [
    "opportunity-source",
    "opportunity-stage",
    "opportunity-status",
    "opportunity-decision",
    "opportunity-company",
    "opportunity-origin",
    "opportunity-sort",
  ])
    expect(document.getElementById(id)?.checkVisibility()).toBe(true);
  await expect.element(page.getByRole("switch", { name: "Early Opportunity 포함" })).toBeVisible();
  await page.getByRole("button", { name: "AI·AX", exact: true }).click();
  await page.getByRole("button", { name: "클라우드", exact: true }).click();
  const params = new URLSearchParams(navigation.query);
  expect(params.getAll("keyword")).toEqual(["AI_AX", "CLOUD"]);
  expect(params.get("q")).toBe("cloud");
  expect(params.getAll("agencyId")).toEqual(["agency-1"]);
  expect(params.getAll("recommendation")).toEqual(["BID"]);
  expect(params.get("origin")).toBe("demo");
  for (const key of ["cursor", "limit", "asOf"]) expect(params.has(key)).toBe(false);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
});

it("관심 목록에서도 필터를 바로 조작하고 초기화하면 기본 상태로 돌아간다", async () => {
  await page.viewport(1440, 900);
  show("q=cloud&keyword=AI_AX&origin=demo&siAiFirst=false&includeEarly=true", "/watchlist");
  await expect
    .element(page.getByRole("button", { name: "AI·AX", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(page.getByRole("switch", { name: "AI·SI 우선" })).not.toBeChecked();
  await page.getByRole("button", { name: "필터 초기화" }).click();
  expect(navigation.push).toHaveBeenLastCalledWith("/watchlist", { scroll: false });
  await expect.element(page.getByRole("searchbox")).toHaveValue("");
  await expect.element(page.getByRole("switch", { name: "AI·SI 우선" })).toBeChecked();
  await expect
    .element(page.getByRole("button", { name: "AI·AX", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await expect.element(page.getByRole("button", { name: "필터 초기화" })).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1440);
});
