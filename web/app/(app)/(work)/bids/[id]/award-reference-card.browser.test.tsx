import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { AwardReference } from "@/server/award-reference";
import { AwardReferenceCard } from "./award-reference-card";

// 참고 낙찰가 범위 카드(스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md §2, 계획 Task B).
// 금지어는 화면 글자와 막대 이름(aria-label) 모두에서 본다(ADR-007).

const FORBIDDEN = /확률|가능성|승률|예측|보장|수주 금액|경쟁사/;

const BASE = 796_011_720;
const NEGOTIATION: AwardReference = {
  kind: "RANGE",
  group: "NEGOTIATION",
  step: 1,
  sampleSize: 38,
  periodMonths: 12,
  scopeLabel: "소프트웨어유지및지원서비스",
  amountBand: { min: 0.5, max: 2 },
  base: { amountKrw: BASE, kind: "ASSIGNED_BUDGET" },
  ratio: { q1: 0.861, median: 0.894, q3: 0.927 },
  amountKrw: {
    q1: Math.round(BASE * 0.861),
    median: Math.round(BASE * 0.894),
    q3: Math.round(BASE * 0.927),
  },
  priceWeight: 10,
  lowerLimitRate: null,
  dataAsOf: "2026-11-03T00:30:00.000Z",
};

// 중분류까지 넓힌 하한율 공고. 큰 금액으로 좁은 화면 줄바꿈을 본다.
const WIDE_BASE = 13_850_000_000;
const LOWER_LIMIT_WIDENED: AwardReference = {
  kind: "RANGE",
  group: "LOWER_LIMIT",
  step: 3,
  sampleSize: 7,
  periodMonths: 12,
  scopeLabel: "SW 및 시스템 개발",
  amountBand: { min: 1 / 3, max: 3 },
  base: { amountKrw: WIDE_BASE, kind: "ESTIMATED_PLUS_VAT" },
  ratio: { q1: 0.87, median: 0.88, q3: 0.9 },
  amountKrw: {
    q1: Math.round(WIDE_BASE * 0.87),
    median: Math.round(WIDE_BASE * 0.88),
    q3: Math.round(WIDE_BASE * 0.9),
  },
  priceWeight: null,
  lowerLimitRate: 88,
  dataAsOf: "2026-11-03T00:30:00.000Z",
};

const TOO_FEW: AwardReference = {
  kind: "TOO_FEW",
  group: "NEGOTIATION",
  sampleSize: 3,
  periodMonths: 9,
  scopeLabel: "SW 및 시스템 개발",
  priceWeight: 20,
  lowerLimitRate: null,
  dataAsOf: null,
};

const mounted: Root[] = [];
function render(...references: AwardReference[]) {
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "flex flex-col gap-6 p-4";
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <>
        {references.map((reference, index) => (
          <AwardReferenceCard key={index} reference={reference} />
        ))}
      </>,
    ),
  );
  mounted.push(root);
  return host;
}

const card = () => page.getByRole("region", { name: /참고 낙찰가 범위/ });
const shownText = (host: HTMLElement) =>
  [
    host.textContent ?? "",
    ...[...host.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label")),
  ].join("\n");

beforeEach(async () => {
  await page.viewport(1440, 900);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

describe("참고 낙찰가 범위 카드", () => {
  it("협상 계약: 가운데 절반 금액·중간값·기준·가격 배점·고지를 적는다", async () => {
    const host = render(NEGOTIATION);
    await expect
      .element(card().getByRole("heading", { level: 2 }))
      .toHaveTextContent("참고 낙찰가 범위 · 지난 낙찰 기준");
    await expect.element(card().getByText("6억 8,536만 ~ 7억 3,790만 원")).toBeVisible();
    await expect
      .element(card().getByText(/중간값 7억 1,163만 원 \(배정예산의 89\.4%\)/))
      .toBeVisible();
    await expect.element(card().getByText("조달청 낙찰정보 · 2026-11-03 기준")).toBeVisible();
    await expect
      .element(
        card().getByText(
          "기준: 소프트웨어유지및지원서비스 · 협상 계약 · 금액 0.5~2배 · 최근 12개월 · 38건",
        ),
      )
      .toBeVisible();
    await expect.element(card().getByText(/기술 90 : 가격 10/)).toBeVisible();
    await expect
      .element(
        card().getByText("지난 낙찰값을 모은 참고 값입니다. 최종 투찰가는 담당자가 정합니다."),
      )
      .toBeVisible();
    await expect
      .element(card().getByRole("img"))
      .toHaveAccessibleName(/가운데 절반 86\.1%~92\.7%, 중간값 89\.4%/);
    expect(shownText(host)).not.toMatch(FORBIDDEN);
  });

  it("하한율·중분류로 넓힘: 넓힌 배수와 낙찰하한율을 적는다", async () => {
    const host = render(LOWER_LIMIT_WIDENED);
    await expect
      .element(
        card().getByText(
          "기준: SW 및 시스템 개발 · 낙찰하한율 방식 · 금액 0.33~3배 · 최근 12개월 · 7건 · 중분류로 넓힘",
        ),
      )
      .toBeVisible();
    await expect.element(card().getByText(/낙찰하한율은 88%/)).toBeVisible();
    await expect.element(card().getByText(/추정가격\+부가세의 88%/)).toBeVisible();
    expect(shownText(host)).not.toMatch(FORBIDDEN);
  });

  it("표본이 적으면 범위·막대 없이 한 줄로 알린다", async () => {
    const host = render(TOO_FEW);
    await expect
      .element(card().getByText("비슷한 지난 낙찰이 적어 범위를 보여 주지 않습니다"))
      .toBeVisible();
    await expect.element(card().getByText("조달청 낙찰정보", { exact: true })).toBeVisible();
    expect(host.querySelector('[data-slot="award-range"]')).toBeNull();
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).not.toMatch(/~ .* 원/);
    expect(shownText(host)).not.toMatch(FORBIDDEN);
  });

  // page.screenshot 은 web/ 밖에 쓰지 못한다. web/test-results 에 찍는다.
  it.each([360, 390, 768, 1280, 1440])(
    "%ipx: 가로로 넘치지 않고 큰 금액은 덩어리째 줄을 바꾼다",
    async (width) => {
      await page.viewport(width, 1200);
      const host = render(NEGOTIATION, LOWER_LIMIT_WIDENED, TOO_FEW);
      await expect.element(card().first()).toBeVisible();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      for (const section of host.querySelectorAll("section")) {
        expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
      }
      // 금액·비율 덩어리는 한 줄에 놓인다(글자 조각마다 사각형이 나오므로 줄 위치로 센다).
      for (const chunk of host.querySelectorAll("section .whitespace-nowrap")) {
        const lineTops = new Set([...chunk.getClientRects()].map((rect) => Math.round(rect.top)));
        expect(lineTops.size, chunk.textContent ?? "").toBe(1);
      }
      await page.screenshot({
        path: `../../../../../test-results/vitest-screenshots/award-reference-card-${width}.png`,
      });
    },
  );
});
