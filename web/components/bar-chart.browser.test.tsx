import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { BarChart, type BarChartDay } from "@/components/bar-chart";
import { Card, CardContent } from "@/components/ui/card";

// 막대 차트를 진짜 브라우저 레이아웃으로 잰다. 대시보드처럼 본문 여백(px-4) 안의 카드에 넣는다.
// 두 계열(추가·완료)의 막대가 좁은 화면에서도 날짜 칸 안에 들고, 높이가 값에 맞고, 범례 색이 막대 색과 같은지 본다.
// 디자인 스펙(작업·활동 기록) 6.1 이 이 시험을 정했다.

const LABELS = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-10-${String(index + 1).padStart(2, "0")}`,
  label: `10. ${index + 1}.`,
}));
// 맨 위 눈금이 가장 큰 값(8)과 같도록 짝수로 둔다. 0 이 섞여 있다.
const ADDED = [3, 0, 2, 8, 4, 1, 4, 0, 3, 7, 5, 6, 4, 2];
const COMPLETED = [1, 2, 0, 3, 4, 0, 2, 1, 0, 5, 3, 4, 2, 1];
const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

// 그린 뒤 표(화면 낭독기용)가 나타날 때까지 기다린다. 그 뒤에 레이아웃을 바로 잰다.
const render = async (chart: React.ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(
    <main className="px-4">
      <Card>
        <CardContent>{chart}</CardContent>
      </Card>
    </main>,
  );
  mounted.push(root);
  await expect.element(page.getByRole("table")).toBeInTheDocument();
};

const twoSeries = (
  <BarChart
    dates={LABELS}
    series={[
      { name: "추가", tone: "brand", counts: ADDED },
      { name: "완료", tone: "chart-2", counts: COMPLETED },
    ]}
    caption="최근 14일 날짜별 작업 추가 수와 완료 수"
    unit="개"
  />
);

// 날짜 칸 하나. 마우스로 정확한 값을 보는 대상이라 title 이 붙어 있다.
const columnOf = (index: number) =>
  page.getByTitle(`${LABELS[index].label} 추가 ${ADDED[index]}개 · 완료 ${COMPLETED[index]}개`, {
    exact: true,
  });

describe("BarChart 두 계열", () => {
  it.each([320, 375, 1280])(
    "%ipx 화면에서 날짜마다 막대 둘이 제 칸 안에 나란히 들고 차트가 가로로 넘치지 않는다",
    async (width) => {
      await page.viewport(width, 800);
      await render(twoSeries);

      const columns = LABELS.map((_, index) => columnOf(index).element());
      columns.forEach((column, index) => {
        const box = column.getBoundingClientRect();
        const bars = Array.from(column.children);
        expect(bars).toHaveLength(2);
        bars.forEach((bar) => {
          const barBox = bar.getBoundingClientRect();
          expect(barBox.width, `${LABELS[index].label} 막대 폭`).toBeGreaterThan(0);
          expect(barBox.left).toBeGreaterThanOrEqual(box.left - 0.5);
          expect(barBox.right).toBeLessThanOrEqual(box.right + 0.5);
        });
        // 추가 막대가 완료 막대 왼쪽이다.
        expect(bars[0].getBoundingClientRect().right).toBeLessThanOrEqual(
          bars[1].getBoundingClientRect().left,
        );
        // 날짜 칸끼리 겹치지 않는다.
        if (index > 0) {
          expect(box.left).toBeGreaterThanOrEqual(columns[index - 1].getBoundingClientRect().right);
        }
      });

      const card = page.getByRole("main").element().firstElementChild;
      if (!card) throw new Error("카드가 그려지지 않았다");
      expect(card.scrollWidth).toBe(card.clientWidth);
      expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);
    },
  );

  it("막대 높이는 값에 비례하고, 0 은 높이가 없으며 작은 값도 보인다", async () => {
    await page.viewport(1280, 800);
    await render(twoSeries);

    LABELS.forEach((day, index) => {
      const column = columnOf(index).element();
      const plotHeight = column.getBoundingClientRect().height;
      [ADDED[index], COMPLETED[index]].forEach((count, seriesIndex) => {
        const height = column.children[seriesIndex].getBoundingClientRect().height;
        const message = `${day.label} ${seriesIndex === 0 ? "추가" : "완료"} ${count}`;
        if (count === 0) {
          expect(height, message).toBe(0);
          return;
        }
        // 맨 위 눈금은 8 이다. 아주 작은 값도 최소 높이(4px) 아래로 줄지 않는다.
        expect(height, message).toBeCloseTo(Math.max((count / 8) * plotHeight, 4), 0);
      });
    });
  });

  it("범례는 계열 이름과 14일 합계를 보이고, 색 칸은 그 계열 막대와 같은 색이며 두 계열의 색은 다르다", async () => {
    await page.viewport(1280, 800);
    await render(twoSeries);

    const legend = page.getByRole("listitem");
    await expect.element(legend.nth(0)).toHaveTextContent(`추가${sum(ADDED)}개`);
    await expect.element(legend.nth(1)).toHaveTextContent(`완료${sum(COMPLETED)}개`);

    // 값이 있는 날(10. 4.)의 막대로 색을 잰다.
    const bars = Array.from(columnOf(3).element().children);
    const colors = [0, 1].map((seriesIndex) => {
      const swatch = legend.nth(seriesIndex).element().firstElementChild;
      if (!swatch) throw new Error("범례 색 칸이 없다");
      const barColor = getComputedStyle(bars[seriesIndex]).backgroundColor;
      expect(getComputedStyle(swatch).backgroundColor).toBe(barColor);
      // 토큰 클래스가 빌드에 들어가지 않으면 바탕이 투명해진다.
      expect(barColor).not.toBe("rgba(0, 0, 0, 0)");
      return barColor;
    });
    expect(colors[0]).not.toBe(colors[1]);
  });

  it("화면 낭독기 표는 날짜와 계열마다 열을 두고 값에 단위를 붙인다", async () => {
    await render(twoSeries);

    const table = page.getByRole("table", { name: "최근 14일 날짜별 작업 추가 수와 완료 수" });
    const headers = table.getByRole("columnheader").elements();
    expect(headers.map((header) => header.textContent)).toEqual(["날짜", "추가", "완료"]);
    const rows = table.getByRole("row").elements();
    expect(rows).toHaveLength(LABELS.length + 1);
    expect(Array.from(rows[4].children).map((cell) => cell.textContent)).toEqual([
      "10. 4.",
      "8개",
      "3개",
    ]);
  });
});

describe("BarChart 한 계열", () => {
  const days: BarChartDay[] = LABELS.map((day, index) => ({ ...day, count: ADDED[index] }));

  it("첫 화면 견본처럼 한 계열이면 범례 없이 막대 하나씩 그리고 값만 title 로 단다", async () => {
    await render(
      <BarChart
        days={days}
        caption="최근 14일 날짜별 작업 추가 수"
        valueHeader="추가한 작업"
        unit="개"
      />,
    );

    await expect.element(page.getByRole("list")).not.toBeInTheDocument();
    const column = page.getByTitle("10. 4. 8개", { exact: true });
    expect(column.element().children).toHaveLength(1);
    const headers = page
      .getByRole("table", { name: "최근 14일 날짜별 작업 추가 수" })
      .getByRole("columnheader")
      .elements();
    expect(headers.map((header) => header.textContent)).toEqual(["날짜", "추가한 작업"]);
  });
});
