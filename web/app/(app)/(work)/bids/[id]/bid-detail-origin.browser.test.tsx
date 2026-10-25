import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { BID_LIST } from "@/components/bids/test-data";
import { BidDetailView, type DetailBid } from "./bid-detail-view";

// 10-25 실수집 계획 B2: 공고 상세가 출처를 말하는 방식. 근거는 저장된 is_demo·source·source_url 뿐이다.
// 실제 공고에는 DEMO 가 없고, 기관 라벨은 출처의 정규화 필드를 따르며, 서비스 안내 주소는 원본 공고로 부르지 않는다.

vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: vi.fn() }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const detail = (overrides: Partial<DetailBid>): DetailBid => ({
  ...BID_LIST[2]!,
  id: "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f61",
  noticeId: "R25BK01000001",
  source: "g2b-bid-notice",
  isDemo: false,
  agency: "서울특별시 강남구",
  noticeAgency: "조달청 서울지방조달청",
  sourceUrl: "https://www.g2b.go.kr/notice/R25BK01000001",
  sourceUrlKind: "NOTICE",
  content: "실제 공고 본문입니다.",
  documents: [],
  stageLinks: { planRef: null, preSpecRef: null },
  extractionStatus: "COMPLETED",
  latestAnalysis: null,
  reviews: [],
  ...overrides,
});

const mounted: Root[] = [];
function render(bid: DetailBid, changedAt: string | null = null) {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "1184px";
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <BidDetailView
        bid={bid}
        previousScored={null}
        history={null}
        assessmentLabels={{}}
        members={[]}
        currentUserId="user-viewer"
        canAnalyze={false}
        canDecide={false}
        backHref="/bids"
        now="2026-10-25T03:00:00Z"
        changedAt={changedAt}
      />,
    ),
  );
  mounted.push(root);
  return host;
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("공고 상세 출처 표시", () => {
  it("G2B 실제 공고: DEMO 없음, 수요기관·공고기관을 원본 필드대로, 원문 링크와 마지막 변경", async () => {
    const host = render(detail({}), "2026-10-25T02:10:00.000Z");
    await expect.element(page.getByText(/수요기관 서울특별시 강남구/)).toBeVisible();
    expect(host.textContent).not.toContain("DEMO");
    expect(host.querySelector('[data-part="unverified-origin"]')).toBeNull();
    expect(host.textContent).toContain(
      "수요기관 서울특별시 강남구 · 공고기관 조달청 서울지방조달청",
    );
    expect(host.textContent).toContain("마지막 변경 2026-10-25 11:10 KST");
    const link = page.getByRole("link", { name: "원문 보기 (새 탭)" });
    await expect
      .element(link)
      .toHaveAttribute("href", "https://www.g2b.go.kr/notice/R25BK01000001");
  });

  it("공고기관 값이 없으면 칸을 만들지 않고, 변경 시각을 모르면 적지 않는다", async () => {
    const host = render(detail({ noticeAgency: null }));
    await expect.element(page.getByText(/수요기관 서울특별시 강남구/)).toBeVisible();
    expect(host.textContent).not.toContain("공고기관");
    expect(host.textContent).not.toContain("마지막 변경");
  });

  it("KEPCO 의 서비스 안내 주소는 원본 공고로 부르지 않고, 기관은 발주 회사다", async () => {
    render(
      detail({
        source: "kepco-ebid-contract",
        agency: "한국전력공사",
        noticeAgency: null,
        sourceUrl: "https://www.data.go.kr/data/15148223/openapi.do",
        sourceUrlKind: "SERVICE_DOCUMENTATION",
      }),
    );
    await expect.element(page.getByText(/발주 회사 한국전력공사/)).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "서비스 안내 (원본 공고 아님) (새 탭)" }))
      .toBeVisible();
    expect(page.getByRole("link", { name: "원문 보기 (새 탭)" }).elements()).toHaveLength(0);
  });

  it("is_demo=false 인데 source 가 데모 수집기면 DEMO 도 실제도 아닌 출처 미확인이다", async () => {
    const host = render(detail({ source: "fixture", noticeId: "DEMO-2026-0099" }));
    await expect.element(page.getByText("출처 미확인", { exact: true })).toBeVisible();
    expect(host.textContent).toContain("DEMO-2026-0099");
    expect(page.getByText("DEMO", { exact: true }).elements()).toHaveLength(0);
  });
});
