import { useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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
function show(query = "", pathname = "/bids", agencyName = "시험 기관") {
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
      <div style={{ width: "100%", maxWidth: "calc(100vw - 32px)" }}>
        <OpportunityFilters
          query={currentQuery}
          defaultOrigin="live"
          agencies={[{ id: "agency-1", name: agencyName }]}
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

it("모바일 필터는 적용 전 URL을 바꾸지 않고 취소·적용·조건 해제가 동작한다", async () => {
  await page.viewport(360, 800);
  show("q=cloud&origin=demo&cursor=next");
  await expect.element(page.getByRole("button", { name: "필터 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "필터 1", exact: true }).click();
  await page.getByRole("button", { name: "AI·AX", exact: true }).click();
  expect(navigation.push).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(navigation.push).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "필터 1", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "AI·AX", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "AI·AX", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  const applied = new URLSearchParams(navigation.query);
  expect(applied.get("keyword")).toBe("AI_AX");
  expect(applied.get("q")).toBe("cloud");
  expect(applied.get("origin")).toBe("demo");
  expect(applied.has("cursor")).toBe(false);
  await page.getByRole("button", { name: "키워드: AI·AX 조건 해제", exact: true }).click();
  expect(new URLSearchParams(navigation.query).has("keyword")).toBe(false);
  expect(new URLSearchParams(navigation.query).get("q")).toBe("cloud");
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
});

it("긴 기관 조건은 모바일 폭 안에서 줄바꿈하고 상태 묶음은 한 번에 해제한다", async () => {
  await page.viewport(360, 800);
  const agencyName = "공공정보시스템통합운영지원사업본부".repeat(3);
  show(
    "q=cloud&agencyId=agency-1&status=OPEN&status=AMENDED&status=CLOSED&status=CANCELLED",
    "/bids",
    agencyName,
  );
  const agency = page.getByRole("button", { name: `기관: ${agencyName} 조건 해제`, exact: true });
  await expect.element(agency).toBeVisible();
  expect(agency.element().scrollWidth).toBeLessThanOrEqual(agency.element().clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
  await page
    .getByRole("button", { name: "상태: 진행 중 · 정정 · 마감 · 취소 조건 해제", exact: true })
    .click();
  const params = new URLSearchParams(navigation.query);
  expect(params.getAll("status")).toEqual([]);
  expect(params.get("q")).toBe("cloud");
  expect(params.get("agencyId")).toBe("agency-1");
});
