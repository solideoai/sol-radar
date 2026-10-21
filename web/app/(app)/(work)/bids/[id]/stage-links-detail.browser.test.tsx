import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import { STAGE_LINKS_COPY } from "@/components/bids/stage-links";
import { BID_DOCUMENTS, BID_LIST } from "@/components/bids/test-data";
import type { StageLinksView } from "@/server/bids";
import { BidDetailView, type DetailBid } from "./bid-detail-view";

// P0-8 단계 연결 구역을 상세 본문(BidDetailView) 통째로 그려 자리·넘침을 재고 증거 화면을 찍는다
// (디자인 스펙 docs/plans/2026-10-21-p08-stage-links-ui-spec.md §4.1·§4.6·§10 증거 스크린샷).
// mock·render 꼴은 같은 폴더 bid-detail-view.browser.test.tsx 와 같다. 시험 상자 폭 = 화면 폭 - 사이드바 256px.
// 사이드바·상단 막대는 그리지 않는다(상세 본문만). 화면은 web/ 밖에 못 써서 web/test-results/p08 에 찍는다.

const spies = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  topbar: vi.fn(() => Promise.resolve()),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.topbar }));
vi.mock("sonner", () => ({ toast: spies.toast }));
// 나머지 속성(aria-describedby 등)을 넘긴다. StageLinks 의 제목 링크가 설명을 단다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = "2026-10-16T03:00:00Z";
const FX01_ID = "0f1e2d3c-4b5a-4968-8776-000000000001";
const FX17_ID = "0f1e2d3c-4b5a-4968-8776-000000000017";
const FX18_ID = "0f1e2d3c-4b5a-4968-8776-000000000018";
const FX19_ID = "0f1e2d3c-4b5a-4968-8776-000000000019";
const FX01_TITLE = "세종특별자치시 차세대 행정정보시스템 고도화 (가상)";
const FX17_TITLE = "과학기술정보통신부 2027년 AI 행정서비스 구축 발주계획 (가상)";
const MSIT = "과학기술정보통신부";
const SEJONG = "세종특별자치시";

const detail = (overrides: Partial<DetailBid> = {}): DetailBid => ({
  ...BID_LIST[1]!,
  source: "fixture",
  content: "공고 본문 (가상).",
  documents: BID_DOCUMENTS,
  stageLinks: { planRef: null, preSpecRef: null },
  extractionStatus: "COMPLETED",
  latestAnalysis: null,
  reviews: [],
  ...overrides,
});

// FX-18 사전규격: 같은 planRef(DEMO-PLAN-0042)로 발주계획 FX-17 과 이어진다(스펙 §6).
const FX18_BID = detail({
  id: FX18_ID,
  noticeId: "DEMO-2026-0018",
  title: "과학기술정보통신부 AI 행정서비스 구축 사전규격 (가상)",
  agency: MSIT,
  stage: "PRE_SPEC",
  budgetKrw: "4800000000",
  deadlineAt: "2026-10-23T09:00:00Z",
  planRef: "DEMO-PLAN-0042",
  stageLinks: { planRef: "DEMO-PLAN-0042", preSpecRef: null },
});
const FX18_LINKS: StageLinksView = {
  linked: [
    {
      bidId: FX17_ID,
      stage: "PLAN",
      noticeId: "DEMO-2026-0017",
      title: FX17_TITLE,
      agency: MSIT,
      status: "OPEN",
      basis: "PLAN_REF",
    },
  ],
  candidates: [],
};

// FX-19 사전규격: 식별자 없이 제목만 비슷한 입찰공고 FX-01 이 연결 후보다.
const FX19_BID = detail({
  id: FX19_ID,
  noticeId: "DEMO-2026-0019",
  title: "세종특별자치시 행정정보 연계 플랫폼 사전규격 (가상)",
  agency: SEJONG,
  stage: "PRE_SPEC",
  budgetKrw: "1000000000",
  deadlineAt: "2026-10-30T09:00:00Z",
  planRef: null,
  stageLinks: { planRef: null, preSpecRef: null },
});
const FX19_LINKS: StageLinksView = {
  linked: [],
  candidates: [
    {
      bidId: FX01_ID,
      stage: "NOTICE",
      noticeId: "DEMO-2026-0001",
      title: FX01_TITLE,
      agency: SEJONG,
    },
  ],
};

// 둘 다 + 취소 + 띄어쓰기 없는 긴 제목(live 에서 생길 수 있는 꼴, 스펙 §4.7 마지막 그림).
const LONG_LINKS: StageLinksView = {
  linked: [
    {
      bidId: FX17_ID,
      stage: "PLAN",
      noticeId: "R26DD00012345",
      title: "○○시 2027년 통합 정보시스템 구축 발주계획",
      agency: "○○시",
      status: "OPEN",
      basis: "PLAN_REF",
    },
    {
      bidId: FX18_ID,
      stage: "PRE_SPEC",
      noticeId: "R26BD00067890",
      title: "○○시통합정보시스템구축사업(1단계)사전규격공개및의견수렴에관한건".repeat(4),
      agency: "한국지능정보사회진흥원디지털정부혁신추진단".repeat(3),
      status: "CANCELLED",
      basis: "PRE_SPEC_REF",
    },
  ],
  candidates: [FX19_LINKS.candidates[0]!],
};

type ViewProps = React.ComponentProps<typeof BidDetailView>;
const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  bid: detail(),
  previousScored: null,
  history: { items: [], hasMore: false },
  assessmentLabels: {},
  members: [{ id: "user-sales", name: "김영업" }],
  currentUserId: "user-sales",
  canAnalyze: true,
  canDecide: true,
  backHref: "/bids",
  now: NOW,
  ...overrides,
});

const mounted: Root[] = [];
const render = (overrides: Partial<ViewProps>, width = 1024) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(<BidDetailView {...props(overrides)} />));
  mounted.push(root);
  return host;
};

beforeEach(async () => {
  await page.viewport(1280, 900);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
  vi.unstubAllGlobals();
});

const stageSection = (host: HTMLElement) => {
  const section = host.querySelector<HTMLElement>('section[aria-labelledby="stage-history-title"]');
  if (section === null) throw new Error("단계 이력 구역이 없다");
  return section;
};

// 운영 글꼴(Pretendard)을 받은 뒤에 잰다. 시스템 글꼴이면 글자 폭이 달라 넘침을 놓친다.
const fontsReady = async (host: HTMLElement) => {
  const shown = host.textContent ?? "";
  await Promise.all(
    ["400", "500", "600", "700"].map((weight) =>
      document.fonts.load(`${weight} 16px "Pretendard Variable"`, shown),
    ),
  );
  await document.fonts.ready;
};

// 상자와 주 영역이 가로로 넘치지 않고, 단 오른쪽 끝을 넘는 요소가 없다.
const expectNoOverflow = (host: HTMLElement, main: number) => {
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  const column = host.querySelector<HTMLElement>('[data-slot="bid-detail-main"]');
  if (column === null) throw new Error("주 영역이 없다");
  expect(column.getBoundingClientRect().width).toBe(main);
  expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
  const right = column.getBoundingClientRect().right;
  const outside = Array.from(column.querySelectorAll<HTMLElement>("*")).filter(
    (el) => !el.closest(".sr-only") && el.getBoundingClientRect().right > right + 0.5,
  );
  expect(outside.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
};

const SHOT_DIR = "../../../../../test-results/p08";
const WIDTHS = [
  [1280, 1024, 616],
  [1440, 1184, 776],
] as const;

describe("상세 단계 연결 구역 자리와 증거 화면(P0-8 스펙 §4.1·§10)", () => {
  it.each(WIDTHS)(
    "FX-18 꼴(%ipx, 상자 %ipx): 단계 이력 줄 바로 다음에 연결된 공고 FX-17 이 보이고 넘치지 않는다",
    async (screen, box, main) => {
      await page.viewport(screen, 900);
      const host = render({ bid: FX18_BID, stageLinks: FX18_LINKS }, box);
      await fontsReady(host);
      const section = stageSection(host);
      const timeline = section.querySelector('ol[aria-label="단계 이력"]');
      const links = section.querySelector('[data-slot="stage-links"]');
      expect(links).not.toBeNull();
      expect(timeline?.nextElementSibling).toBe(links);
      // 단계 이력 줄 아래 한 줄로 내려가 구역 폭을 다 쓴다(basis-full).
      expect(links?.getBoundingClientRect().width).toBe(main);
      await expect
        .element(page.getByRole("link", { name: FX17_TITLE, exact: true }))
        .toHaveAttribute("href", `/bids/${FX17_ID}`);
      expectNoOverflow(host, main);
      await page.screenshot({
        path: `${SHOT_DIR}/20261021-p08-bid-detail-fx18-loaded-${screen}.png`,
      });
    },
  );

  it.each(WIDTHS)(
    "FX-19 꼴(%ipx, 상자 %ipx): 연결 후보는 접혀 있고 펼치면 FX-01 이 점선 상자에 보인다",
    async (screen, box, main) => {
      await page.viewport(screen, 900);
      const host = render({ bid: FX19_BID, stageLinks: FX19_LINKS }, box);
      await fontsReady(host);
      const details = stageSection(host).querySelector<HTMLDetailsElement>(
        'details[data-slot="stage-links-candidates"]',
      );
      if (details === null) throw new Error("후보 묶음이 없다");
      expect(details.open).toBe(false);
      await userEvent.click(page.getByText(STAGE_LINKS_COPY.candidatesNote));
      expect(details.open).toBe(true);
      await expect
        .element(page.getByRole("link", { name: FX01_TITLE, exact: true }))
        .toHaveAttribute("href", `/bids/${FX01_ID}`);
      expectNoOverflow(host, main);
      await page.screenshot({
        path: `${SHOT_DIR}/20261021-p08-bid-detail-fx19-loaded-${screen}.png`,
      });
    },
  );

  it.each(WIDTHS)(
    "읽기 실패(%ipx, 상자 %ipx): 단계 이력 아래 한 줄 안내만 두고 상세 나머지는 그린다",
    async (screen, box, main) => {
      await page.viewport(screen, 900);
      const host = render({ bid: FX19_BID, stageLinks: null }, box);
      await fontsReady(host);
      const error = stageSection(host).querySelector('[data-slot="stage-links-error"]');
      expect(error?.textContent).toBe(STAGE_LINKS_COPY.loadFailed);
      expect(host.querySelector('[data-slot="stage-links"]')).toBeNull();
      await expect.element(page.getByText("아직 분석하지 않았습니다")).toBeVisible();
      await expect.element(page.getByRole("heading", { name: "참여 판단" })).toBeVisible();
      expectNoOverflow(host, main);
      await page.screenshot({
        path: `${SHOT_DIR}/20261021-p08-bid-detail-stage-links-error-${screen}.png`,
      });
    },
  );

  it.each(WIDTHS)(
    "둘 다·취소·띄어쓰기 없는 긴 제목(%ipx, 상자 %ipx)도 주 영역 안에서 꺾이고 넘치지 않는다",
    async (screen, box, main) => {
      await page.viewport(screen, 900);
      const host = render({ bid: FX18_BID, stageLinks: LONG_LINKS }, box);
      await fontsReady(host);
      await userEvent.click(page.getByText(STAGE_LINKS_COPY.candidatesNote));
      expect(stageSection(host).querySelectorAll('[data-slot="stage-link-item"]')).toHaveLength(3);
      expectNoOverflow(host, main);
    },
  );

  it("stageLinks 를 주지 않으면(기능 끔) 구역도 실패 안내도 없고 단계 이력은 지금과 같다", () => {
    const host = render({ bid: FX18_BID });
    expect(host.querySelector('[data-slot="stage-links"]')).toBeNull();
    expect(host.querySelector('[data-slot="stage-links-error"]')).toBeNull();
    const children = Array.from(stageSection(host).children).map((el) => el.tagName.toLowerCase());
    expect(children).toEqual(["h2", "ol"]);
  });

  it("연결도 후보도 없으면 단계 이력 구역에 아무것도 더하지 않는다", () => {
    const host = render({ bid: FX18_BID, stageLinks: { linked: [], candidates: [] } });
    const children = Array.from(stageSection(host).children).map((el) => el.tagName.toLowerCase());
    expect(children).toEqual(["h2", "ol"]);
  });
});
