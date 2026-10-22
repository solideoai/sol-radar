import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { FX01_VIEW } from "@/components/bids/test-data";
import type { AnalysisHistoryItem, AnalysisView } from "@/server/bids";
import { AnalysisComparison } from "./analysis-comparison";

vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("4열에서 부분·실패 값을 유지하고 실패한 조회만 재시도하며 1280 본문 폭을 넘지 않는다", async () => {
  const views: AnalysisView[] = [0, 1, 2, 3].map((index) => ({
    ...FX01_VIEW,
    id: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    revision: index + 1,
    status: index === 1 ? "PARTIAL" : index === 2 ? "FAILED" : "COMPLETED",
    solScore: index === 2 ? null : FX01_VIEW.solScore,
    scoreBreakdown: index === 2 ? [] : FX01_VIEW.scoreBreakdown,
    errorCode: index === 2 ? "EXTRACTION_FAILED" : null,
  }));
  const summaries: AnalysisHistoryItem[] = views.map((view) => ({
    ...view,
    bidTitle: "긴공고명".repeat(40),
    isDemo: true,
  }));
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const id = String(input).split("/").at(-1);
    const view = views.find((entry) => entry.id === id);
    if (!view) throw new Error("예상하지 않은 요청");
    if (
      id === views[3].id &&
      fetch.mock.calls.filter(([url]) => String(url).endsWith(id)).length === 1
    )
      return Response.json(
        { error: { code: "INTERNAL_ERROR", message: "조회 실패", requestId: "test" } },
        { status: 500 },
      );
    return Response.json(view);
  });
  vi.stubGlobal("fetch", fetch);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "960px";
  root = createRoot(host);
  flushSync(() =>
    root?.render(
      <AnalysisComparison
        ids={views.map((view) => view.id)}
        summaries={summaries}
        onRemove={vi.fn()}
      />,
    ),
  );
  await expect.poll(() => host.querySelectorAll("button").length).toBe(5);
  expect(host.textContent).toContain("부분 완료 (규칙만)");
  expect(host.textContent).toContain("EXTRACTION_FAILED");
  const scoreRow = [...host.querySelectorAll("tbody tr")].find(
    (row) => row.querySelector("th")?.textContent === "SOL Score",
  );
  expect(scoreRow?.querySelectorAll("td")[2].textContent).toBe("—");
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "다시 시도",
  );
  if (!retry) throw new Error("재시도 버튼이 없다");
  await userEvent.click(retry);
  await expect.poll(() => fetch.mock.calls.length).toBe(5);
  await expect.poll(() => host.querySelector('[role="alert"]')).toBeNull();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(views[0].id))).toHaveLength(1);
  expect(host.textContent).toContain("비교 기준이 다릅니다");
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
});
