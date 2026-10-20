import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BidTable } from "@/components/bids/bid-table";
import { BID_LIST } from "@/components/bids/test-data";
import type { BidListItem } from "@/server/bids";

// 운영 글꼴(Pretendard, app/layout.tsx 가 불러오는 것과 같은 CSS)로 표를 잰다.
// 다른 부품 시험은 시스템 글꼴로 돌아 라틴 글자 폭이 좁게 잡힌다. 머리 칸("SOL Score") 넘침은 이 글꼴에서만 드러난다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, title, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

const NOW = new Date("2026-10-16T00:00:00Z");
const base = BID_LIST[1];
// 가장 긴 값 조합(취소됨·부분 완료·WATCH·NO-BID·100점·큰 예산).
const WIDEST: BidListItem = {
  ...base,
  id: "bid-widest",
  status: "CANCELLED",
  budgetKrw: "99999999999",
  latestAnalysis: {
    ...(base.latestAnalysis as NonNullable<BidListItem["latestAnalysis"]>),
    status: "PARTIAL",
    solScore: 100,
    recommendation: "WATCH",
  },
  latestReview: { decision: "NO_BID", decidedAt: "2026-10-16T02:00:00Z", reviewerName: "김영업" },
};
const ITEMS = [WIDEST, ...BID_LIST];

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = async (node: React.ReactNode, width: number, scale?: "dashboard") => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  host.className = "@container";
  if (scale) host.setAttribute("data-type-scale", scale);
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  // 표에 쓰인 글자의 조각(unicode-range)을 모두 받은 뒤에 잰다.
  const text = host.textContent ?? "";
  await Promise.all(
    ["400", "500", "600"].map((weight) =>
      document.fonts.load(`${weight} 16px "Pretendard Variable"`, text),
    ),
  );
  await document.fonts.ready;
  const loaded = [...document.fonts].filter(
    (face) => face.family.includes("Pretendard") && face.status === "loaded",
  );
  expect(loaded.length).toBeGreaterThan(0);
  expect(getComputedStyle(host.querySelector("th") as Element).fontFamily).toContain("Pretendard");
  return host;
};

const textBox = (el: Element): DOMRect => {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
};

// 머리 칸 글자 폭이 그 칸의 내용 폭(칸 폭 - 좌우 여백)을 넘는지. scrollWidth 는 정수로 반올림돼 1px 미만 넘침을 놓친다.
const headSpill = (th: Element): number => {
  const style = getComputedStyle(th);
  const content =
    th.getBoundingClientRect().width -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  return textBox(th).width - content;
};

// 칸 안에서 눈에 보이는 숫자 글자(스크린리더 전용 글자는 뺀다).
const visibleText = (td: Element): Element =>
  td.querySelector('[aria-hidden="true"]') ?? td.firstElementChild ?? td;

// 머리 칸은 overflow 가 보이는 채라 넘친 글자가 옆 칸을 덮는다. 몸통 칸은 잘림을 잡는다(제목·기관 말줄임은 의도라 뺀다).
const overflowing = (host: HTMLElement): string[] => {
  const heads = [...host.querySelectorAll("thead th")];
  const headText = heads.map((th) => th.textContent);
  const cells = [...host.querySelectorAll("tbody tr")].flatMap((tr) =>
    [...tr.querySelectorAll("td")].filter(
      (_, col) => headText[col] !== "제목" && headText[col] !== "발주기관",
    ),
  );
  return [
    ...heads
      .filter((th) => headSpill(th) > 0)
      .map((th) => `머리 ${th.textContent}: ${headSpill(th).toFixed(1)}px 넘침`),
    ...cells
      .filter((td) => td.scrollWidth > td.clientWidth)
      .map((td) => `${td.textContent}:${td.scrollWidth}>${td.clientWidth}`),
  ];
};

describe("BidTable (Pretendard)", () => {
  it.each([960, 1120])("/bids 10열 표는 %ipx 에서 머리·몸통 칸이 넘치지 않는다", async (width) => {
    const host = await render(<BidTable items={ITEMS} caption="공고 목록" now={NOW} />, width);
    expect(overflowing(host)).toEqual([]);
    const table = host.querySelector("table") as HTMLElement;
    expect(table.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it("숫자 열(예산·SOL Score) 머리 글자의 오른쪽 끝이 숫자와 맞는다", async () => {
    const host = await render(<BidTable items={ITEMS} caption="공고 목록" now={NOW} />, 960);
    const heads = [...host.querySelectorAll("thead th")];
    for (const label of ["예산", "SOL Score"]) {
      const col = heads.findIndex((th) => th.textContent === label);
      const head = heads[col];
      const cell = host.querySelector(`tbody tr td:nth-child(${col + 1})`) as HTMLElement;
      const headRight = textBox(head).right;
      expect(Math.abs(headRight - textBox(visibleText(cell)).right)).toBeLessThanOrEqual(1);
      expect(headSpill(head)).toBeLessThanOrEqual(0);
    }
  });

  it.each([
    ["recommended", 958],
    ["deadline", 958],
    ["recommended", 1374],
  ] as const)(
    "대시보드 compact %s 표는 %ipx(+3px 글자)에서 머리·몸통 칸이 넘치지 않는다",
    async (kind, width) => {
      const host = await render(
        <BidTable items={ITEMS} caption="표" now={NOW} compact compactKind={kind} />,
        width,
        "dashboard",
      );
      expect(overflowing(host)).toEqual([]);
    },
  );
});
