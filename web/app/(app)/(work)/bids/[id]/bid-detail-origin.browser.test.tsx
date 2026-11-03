import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { BID_LIST, FX01_VIEW, FX02_VIEW } from "@/components/bids/test-data";
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
    expect(host.textContent).toContain("마지막 변경 2026-10-25 11:10");
    // 시간대 표기·내부 수집 번호·출처 키는 보이지 않는다(2026-11-03 사용자 지시).
    expect(host.textContent).not.toMatch(/KST|UTC|revision|g2b-bid-notice/);
    expect(host.textContent).toContain("출처 나라장터 입찰공고");
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

describe("분석 요약 띠의 기술 정보", () => {
  it("모의 응답과 프로필 고지는 남기고 실행 모드·모델명·버전은 화면 어디에도 없다", async () => {
    const host = render(
      detail({ latestAnalysis: { ...FX01_VIEW, runMode: "mock", profileIsDemo: true } }),
    );
    const band = page.getByRole("region", { name: "분석 요약", exact: true });
    await expect.element(band.getByText("Mock 응답(데모 데이터)", { exact: true })).toBeVisible();
    await expect.element(band.getByText("가상 회사 프로필로 분석", { exact: true })).toBeVisible();
    expect(host.textContent).not.toMatch(
      /분석 상세 정보|실행 모드|AI: |알고리즘|sol-v\d|프로필 rev|질문 세트|공급자|kev-qs|Qwen/,
    );
  });
});

// 2026-11-03 사용자 지시(ADR-081): 같은 고지를 구역마다 되풀이하지 않고, 결정 모델 내부 숫자·자리 표시는 보이지 않는다.
describe("공고 상세의 고지와 내부 숫자", () => {
  const occurrences = (text: string | null, pattern: RegExp) => (text?.match(pattern) ?? []).length;

  it("고지는 구역마다 한 번이고 신호 값·기준값·적합도·판정 근거 이름·합계 줄·자리 표시가 없다", async () => {
    const host = render(
      detail({
        latestAnalysis: {
          ...FX01_VIEW,
          explanation: `${FX01_VIEW.explanation} 최종 참여 결정은 사람이 합니다.`,
        },
      }),
    );
    const kev = page.getByRole("region", { name: "결정 모델 참고 지표", exact: true });
    await expect
      .element(kev.getByText("모델 선택지 신뢰 분포 (충족·수주 확률 아님)", { exact: true }))
      .toBeVisible();
    await expect.element(kev.getByText("규칙 권고와 같음", { exact: true })).toBeVisible();
    expect(host.textContent).not.toMatch(
      /기준 0\.70|0\.05|0\.12|적합도 의견|담당자가 기록|결정 모델 확률은|충족 확률·낙찰 확률이 아니며|규칙 \+ 결정 모델 참고|반올림|원문 대조/,
    );
    // mock 고지는 분석 요약 띠 한 곳, "사람이 합니다"는 결정 패널 고지 한 곳이다(점수 설명의 끝 문장은 화면에서 뺀다).
    expect(occurrences(host.textContent, /Mock 응답\(데모 데이터\)/g)).toBe(1);
    expect(occurrences(host.textContent, /최종 참여 결정은 사람이 합니다/g)).toBe(1);
    expect(
      page.getByRole("list", { name: "단계 이력", exact: true }).element().textContent,
    ).not.toContain("—");
  });

  it("신호가 기준 이상이면 숫자 없이 문장 한 줄만 보인다", async () => {
    const host = render(detail({ latestAnalysis: FX02_VIEW }));
    const kev = page.getByRole("region", { name: "결정 모델 참고 지표", exact: true });
    await expect
      .element(kev.getByText("사람 검토가 필요하다는 신호가 기준 이상입니다", { exact: true }))
      .toBeVisible();
    expect(host.textContent).not.toContain("필수자격 위험 신호가 기준 이상입니다");
    expect(host.textContent).not.toMatch(/0\.74|기준 0\.70/);
  });

  it("분석 요약 띠가 mock 을 밝히지 않는 run 이면 결정 모델 칸이 직접 Mock 응답을 밝힌다", async () => {
    const host = render(
      detail({
        latestAnalysis: { ...FX01_VIEW, model: { ...FX01_VIEW.model, provider: "local" } },
      }),
    );
    const kev = page.getByRole("region", { name: "결정 모델 참고 지표", exact: true });
    await expect.element(kev.getByText("Mock 응답(데모 데이터)", { exact: true })).toBeVisible();
    expect(occurrences(host.textContent, /Mock 응답\(데모 데이터\)/g)).toBe(1);
  });
});
