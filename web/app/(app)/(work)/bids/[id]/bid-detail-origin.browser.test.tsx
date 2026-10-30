import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { BID_LIST, FX01_VIEW } from "@/components/bids/test-data";
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
  analysisReadiness: { ready: true, reason: null },
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
  it("360px: 긴 공고명과 분석 결과가 한 열에 맞고 검토 패널은 본문 아래에서 스크롤된다", async () => {
    await page.viewport(360, 900);
    const host = render(
      detail({
        title: "공공데이터통합플랫폼구축및클라우드전환사업을위한차세대정보시스템구축",
        latestAnalysis: { ...FX01_VIEW, runMode: "mock", profileIsDemo: true },
      }),
    );
    host.style.width = "100%";
    await expect
      .element(page.getByRole("region", { name: "분석 요약", exact: true }))
      .toBeVisible();
    const main = host.querySelector<HTMLElement>('[data-slot="bid-detail-main"]');
    const rail = host.querySelector<HTMLElement>('[data-slot="bid-detail-rail"]');
    if (main === null || rail === null) throw new Error("상세 본문과 검토 패널이 없습니다");
    expect(rail.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      main.getBoundingClientRect().bottom,
    );
    expect(getComputedStyle(rail).position).toBe("static");
    expect(getComputedStyle(rail).maxHeight).toBe("none");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
  });

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

describe("공고 상세 회사 프로필 배지", () => {
  it("공개 자료 프로필(is_demo=false)로 분석했으면 공개 자료 글자이고 가상 글자는 없다", async () => {
    const host = render(
      detail({ latestAnalysis: { ...FX01_VIEW, runMode: "live", profileIsDemo: false } }),
    );
    await expect.element(page.getByText("공개 자료 회사 프로필로 분석")).toBeVisible();
    await expect.element(page.getByText("실제 공고 × 공개 자료 회사 프로필")).toBeVisible();
    expect(host.textContent).not.toContain("가상 회사 프로필");
  });

  it("가상 프로필 분석이면 가상 글자 그대로이고 공개 자료 글자는 없다", async () => {
    const host = render(detail({ latestAnalysis: { ...FX01_VIEW, profileIsDemo: true } }));
    await expect.element(page.getByText("가상 회사 프로필로 분석")).toBeVisible();
    await expect.element(page.getByText("실제 공고 × 가상 회사 프로필")).toBeVisible();
    expect(host.textContent).not.toContain("공개 자료 회사 프로필");
  });
});

describe("분석 상세 정보 접기", () => {
  it("모의 응답과 프로필 고지는 남기고 실행 정보는 펼쳐야 보인다", async () => {
    render(detail({ latestAnalysis: { ...FX01_VIEW, runMode: "mock", profileIsDemo: true } }));
    const band = page.getByRole("region", { name: "분석 요약", exact: true });
    await expect.element(band.getByText("Mock 응답(데모 데이터)", { exact: true })).toBeVisible();
    await expect.element(band.getByText("가상 회사 프로필로 분석", { exact: true })).toBeVisible();
    expect(
      band.getByText("분석 상세 정보", { exact: true }).element().closest("details")?.open,
    ).toBe(false);
    await userEvent.click(band.getByText("분석 상세 정보", { exact: true }));
    await expect.element(band.getByText("분석 실행 모드: mock", { exact: true })).toBeVisible();
    await expect.element(band.getByText("AI: mock", { exact: true })).toBeVisible();
    await userEvent.click(band.getByText("분석 상세 정보", { exact: true }));
    expect(
      band.getByText("분석 상세 정보", { exact: true }).element().closest("details")?.open,
    ).toBe(false);
  });
});
