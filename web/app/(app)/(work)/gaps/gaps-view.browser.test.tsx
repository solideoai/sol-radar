import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BlockerRow, GapRadarView, OpenedNotice } from "@/server/gaps";
import type { GapsCopy, GapsLinks, ReadyGapView } from "./gaps-props";
import { GapsView } from "./gaps-view";

// 자격 갭 레이더 화면 하나를 손으로 만든 GapRadarView 로 그린다(디자인 스펙 docs/plans/2026-10-28-gaps-ui-spec.md).
// 서버 이동은 router.push 를 가로채 주소만 확인하고, 이동 뒤 결과는 같은 root 에 새 view 를 다시 그려 흉내 낸다.
// 문구는 계약 파일(web/server/gaps/gaps.model.ts)의 고정 문구 그대로다. 배럴이 server-only 라 시험이 값을 직접 가져오지 못한다.

const spies = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    onClick,
    className,
    title,
    children,
  }: React.ComponentProps<"a"> & { scroll?: boolean }) => (
    <a href={href} onClick={onClick} className={className} title={title}>
      {children}
    </a>
  ),
}));

const BUDGET_NOTICE =
  "예산 합계는 참가 자격이 열리는 공고의 배정 예산 합이며 수주 금액이나 확률이 아닙니다.";
const ASSUMPTION_NOTICE = "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.";
const COPY: GapsCopy = {
  bucketLabels: {
    ELIGIBLE: "참가 가능(API 기준)",
    MISSING_RECORD: "회사 기록 없음",
    NOT_HELD: "미보유",
    NEEDS_REVIEW: "사람 확인 필요",
  },
  reasonLabels: {
    LICENSE_MULTI_ROW: "면허제한 여러 행(AND/OR 미확인)",
    LICENSE_OUT_OF_DICTIONARY: "면허제한 업종이 자격 코드 사전 밖",
    LICENSE_RECORD_MISSING: "면허 기록 없음(다른 조건도 확인 필요)",
    LICENSE_RECORD_EXPIRED: "회사 면허 유효기간 지남",
    INDUSTRY_UNVERIFIED: "허용 업종 확인 필요",
    REGION_UNVERIFIED: "참가가능지역·지역 공동도급 확인 필요",
    AUX_LOOKUP_INCOMPLETE: "면허·지역 보조 조회 미완료",
    AUX_LOOKUP_ABSENT: "면허·지역 보조 조회 결과 없음",
    STAGE_NOT_APPLICABLE: "공고 단계상 자격 미확정",
    DATA_INVALID: "공고 정규화 데이터 형식 오류",
  },
  blockerKindLabels: {
    MISSING_RECORD: "회사 기록 없음",
    NOT_HELD: "미보유",
    OUT_OF_DICTIONARY: "자격 코드 사전 밖",
  },
  scopeNotice:
    "공고 API 의 구조화 필드(면허제한·참가가능지역)만으로 1차 선별했습니다. 첨부(제안요청서)의 자격 요건은 반영하지 않았습니다.",
  budgetNotice: BUDGET_NOTICE,
  assumptionNotice: ASSUMPTION_NOTICE,
  sourceNotice:
    "나라장터 입찰공고 수집분 기준 · 낙찰·계약 데이터는 수집하지 않습니다 · 발주계획·사전규격 미포함",
  dictionaryNames: {
    SW_BUSINESS_REG: "소프트웨어사업자 신고확인서",
    DEFENSE_CONTRACTOR: "방산업체 지정",
  },
};
const LINKS: GapsLinks = {
  clearAssume: "/gaps",
  assume: {
    SW_BUSINESS_REG: { on: "/gaps?assume=SW_BUSINESS_REG", off: "/gaps" },
    DEFENSE_CONTRACTOR: { on: "/gaps?assume=DEFENSE_CONTRACTOR", off: "/gaps" },
  },
};
const ASSUMED_LINKS: GapsLinks = {
  ...LINKS,
  assume: {
    SW_BUSINESS_REG: { on: "/gaps?assume=SW_BUSINESS_REG", off: "/gaps" },
    DEFENSE_CONTRACTOR: {
      on: "/gaps?assume=SW_BUSINESS_REG,DEFENSE_CONTRACTOR",
      off: "/gaps?assume=SW_BUSINESS_REG",
    },
  },
};

// 숫자·제목·기관은 모두 지어낸 값이다. 운영 실측값과 겹치지 않게 골랐다(docs/evidence/gaps/20261028/README.md).
const SW_NAME = "소프트웨어사업자(컴퓨터관련서비스사업)";
const BLOCKERS: BlockerRow[] = [
  {
    key: "SW_BUSINESS_REG",
    name: SW_NAME,
    apiCode: "1468·1469",
    code: "SW_BUSINESS_REG",
    kind: "MISSING_RECORD",
    count: 46,
    budgetKrw: "25300000000",
    bundledReviewCount: 29,
  },
  {
    key: "9999",
    name: "기타자유업종",
    apiCode: "9999",
    code: null,
    kind: "OUT_OF_DICTIONARY",
    count: 17,
    budgetKrw: "12350000000",
    bundledReviewCount: 0,
  },
  {
    key: "DEFENSE_CONTRACTOR",
    name: "방위산업체",
    apiCode: "7101·7102·7103·7104·7105·7106·7107·7108·7109·7110·7111·7112",
    code: "DEFENSE_CONTRACTOR",
    kind: "MISSING_RECORD",
    count: 4,
    budgetKrw: "820000000",
    bundledReviewCount: 9,
  },
  // 10행을 넘겨 "나머지 n개 업종 보기"를 본다. 사전 밖 업종이라 스위치가 없다.
  ...Array.from({ length: 9 }, (_, index) => ({
    key: `80${index}`,
    name: `사전 밖 업종 ${index + 1}`,
    apiCode: `80${index}`,
    code: null,
    kind: "OUT_OF_DICTIONARY" as const,
    count: 2,
    budgetKrw: "3000000",
    bundledReviewCount: 0,
  })),
];
// 46건, 예산 10억에서 2천만 원씩 줄어 합이 253억(막는 자격 1행과 같다).
const OPENED: OpenedNotice[] = Array.from({ length: 46 }, (_, index) => ({
  bidId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  title:
    index === 0
      ? "가상 공공기관 통합 업무 플랫폼 클라우드 전환 및 데이터 연계 구축 사업(1단계) 정보화전략계획 반영 상세 설계(가상)"
      : `가상 정보시스템 유지관리 및 고도화 사업 ${index + 1}(가상)`,
  agency:
    index === 0
      ? "가상 발주기관 1 정보화담당관실 디지털정책과 클라우드전환팀"
      : `가상 발주기관 ${index + 1}`,
  deadlineAt: "2026-11-06T08:00:00.000Z",
  budgetKrw: String(1_000_000_000 - index * 20_000_000),
}));

const READY: ReadyGapView = {
  kind: "READY",
  profile: { revision: 5, isDemo: false, name: "솔리데오" },
  asOf: "2026-10-28T05:05:00.000Z",
  today: "2026-10-28",
  query: { assume: [] },
  radar: {
    summary: {
      total: { count: 268, budgetKrw: "111445000000" },
      buckets: {
        ELIGIBLE: { count: 36, budgetKrw: "3375000000" },
        MISSING_RECORD: { count: 74, budgetKrw: "31620000000" },
        NOT_HELD: { count: 0, budgetKrw: "0" },
        NEEDS_REVIEW: { count: 158, budgetKrw: "76450000000" },
      },
    },
    blockers: BLOCKERS,
    reviewReasons: [
      { reason: "LICENSE_MULTI_ROW", count: 97 },
      { reason: "LICENSE_OUT_OF_DICTIONARY", count: 17 },
      { reason: "AUX_LOOKUP_INCOMPLETE", count: 33 },
    ],
  },
  assumption: null,
};
const ASSUMED: ReadyGapView = {
  ...READY,
  query: { assume: ["SW_BUSINESS_REG"] },
  assumption: {
    codes: [{ code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서" }],
    summary: {
      total: READY.radar.summary.total,
      buckets: {
        ELIGIBLE: { count: 82, budgetKrw: "28675000000" },
        MISSING_RECORD: { count: 28, budgetKrw: "6320000000" },
        NOT_HELD: { count: 0, budgetKrw: "0" },
        NEEDS_REVIEW: { count: 158, budgetKrw: "76450000000" },
      },
    },
    opened: OPENED,
  },
};
// 미보유 5건 가운데 미보유가 유일한 장애인 4건만 순위 행에 있다(서버 soleBlocker). 1건은 다른 확인 사항이 함께 걸렸다.
const NOT_HELD_SPLIT: ReadyGapView = {
  ...READY,
  radar: {
    ...READY.radar,
    summary: {
      ...READY.radar.summary,
      buckets: { ...READY.radar.summary.buckets, NOT_HELD: { count: 5, budgetKrw: "1150000000" } },
    },
    blockers: [
      {
        key: "ISMS_P",
        name: "정보보호관리체계 인증",
        apiCode: null,
        code: "ISMS_P",
        kind: "NOT_HELD",
        count: 4,
        budgetKrw: "720000000",
        bundledReviewCount: 0,
      },
      ...BLOCKERS,
    ],
  },
};
// 화면 글자에 쓰면 안 되는 말. 확률·수주는 계약의 예산 고정 문구(부정문)에만 있다.
// 회사 기록 없음·사전 밖은 정보 부족이지 미충족이 아니라 "참가할 수 없"다고 쓰지 않는다.
const FORBIDDEN = /승률|확률|가능성|수주|%|참가할 수 없/;

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
  spies.router.push.mockReset();
});

// 앱 틀의 사이드바(256px)를 비워 두고 본문만 그린다.
function draw(view: GapRadarView, links: GapsLinks | null): HTMLElement {
  const host =
    document.querySelector<HTMLElement>("[data-test-host]") ??
    document.body.appendChild(document.createElement("div"));
  host.dataset.testHost = "";
  host.style.width = "calc(100% - 256px)";
  host.style.marginLeft = "256px";
  root ??= createRoot(host);
  flushSync(() =>
    root?.render(
      <GapsView
        view={view}
        copy={COPY}
        links={links}
        access={{ canOpenCompany: true, canRunIngestion: true }}
        now="2026-10-28T05:30:00.000Z"
      />,
    ),
  );
  return host;
}

const textOf = (host: HTMLElement, selector: string): string =>
  host.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const bodyRows = (host: HTMLElement, caption: string) =>
  [...host.querySelectorAll("table")]
    .find((table) => table.querySelector("caption")?.textContent === caption)
    ?.querySelectorAll("tbody tr") ?? [];
const withoutFixedNotice = (host: HTMLElement): string =>
  (host.textContent ?? "").replaceAll(BUDGET_NOTICE, "");
// 시험 화면은 iframe 이라 한 번 찍으면 문서 높이만큼 나오지만 지금 창 높이만큼만 그려진다.
// 창 높이씩 스크롤하며 찍고, 파일 이름에 스크롤 위치를 남겨 증거 폴더로 옮길 때 그려진 부분만 이어 붙인다.
// page.screenshot 은 web/ 밖에 쓰지 못한다. web/test-results 에 찍는다.
async function shootPage(name: string) {
  const height = window.innerHeight;
  const last = document.documentElement.scrollHeight - height;
  for (let top = 0; ; top += height) {
    window.scrollTo(0, Math.min(top, last));
    await page.screenshot({
      path: `../../../../test-results/vitest-screenshots/${name}.at-${window.scrollY}.png`,
    });
    if (top >= last) break;
  }
  window.scrollTo(0, 0);
}
const noHorizontalOverflow = () =>
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );

it("요약·막는 자격 순위·보유 가정을 원래 값과 가정 값으로 나눠 보이고 1440·1280 에서 넘치지 않는다", async () => {
  await page.viewport(1440, 900);
  const host = draw(READY, LINKS);

  // 요약 띠는 원래 값이다. 고정 문구 두 줄과 출처가 늘 보인다.
  await expect
    .element(page.getByRole("heading", { level: 1, name: "자격 갭 레이더" }))
    .toBeVisible();
  const strip = page.getByRole("region", { name: "자격 갭 요약" });
  await expect.element(strip).toBeVisible();
  expect(textOf(host, '[data-bucket="ELIGIBLE"]')).toBe("참가 가능(API 기준)36건예산 합 33.8억");
  expect(textOf(host, '[data-bucket="NOT_HELD"]')).toBe("미보유0건예산 합 0억");
  expect(host.textContent).toContain(COPY.scopeNotice);
  expect(host.textContent).toContain(BUDGET_NOTICE);
  expect(host.textContent).toContain(COPY.sourceNotice);
  expect(host.textContent).toContain("공개 자료 회사 프로필로 분석");

  // 가정이 없으면 띠는 안내와 고정 문구만 있고 결과 숫자·새로 열리는 공고 구역이 없다.
  const band = host.querySelector<HTMLElement>('[data-slot="gaps-assumption-band"]');
  if (band === null) throw new Error("가정 시나리오 띠가 없다");
  expect(band.querySelector('[data-slot="gaps-assumption-figures"]')).toBeNull();
  expect(band.textContent).toContain(ASSUMPTION_NOTICE);
  expect(host.querySelector("#gaps-opened")).toBeNull();

  // 순위: 서버 순서 그대로, 사전 코드 행에만 스위치. 사전 밖 행은 "가정 불가".
  const rows = bodyRows(host, "막는 자격 순위");
  expect(rows).toHaveLength(10);
  expect(rows[0].querySelector("th")?.textContent).toBe(
    `${SW_NAME}API 1468·1469 · 사전: 소프트웨어사업자 신고확인서`,
  );
  expect([...rows[0].querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
    "1",
    "회사 기록 없음",
    "46건",
    "253억",
    "29건",
    "보유 가정",
  ]);
  expect(rows[1].querySelector('[role="switch"]')).toBeNull();
  expect(rows[1].textContent).toContain("자격 코드 사전 밖");
  expect(rows[1].textContent).toContain("가정 불가");
  expect(rows[1].querySelectorAll("td")[4].textContent).toBe("—");
  expect(rows[3].textContent).toContain("0.1억 미만");
  expect(host.querySelectorAll('[data-slot="gaps-assume-switch"]')).toHaveLength(2);
  await expect.element(page.getByRole("button", { name: "나머지 2개 업종 보기" })).toBeVisible();
  // 발표 동선: 1440×900 첫 화면에 순위 1~3행과 스위치가 보인다(디자인 스펙 §3).
  const swSwitch = page.getByRole("switch", { name: `${SW_NAME} 보유 가정` });
  expect(rows[2].getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  const tableTop = rows[0].getBoundingClientRect().top;

  // 스위치는 page 가 만든 주소로 스크롤 없이 이동한다.
  await userEvent.click(swSwitch);
  expect(spies.router.push).toHaveBeenCalledWith("/gaps?assume=SW_BUSINESS_REG", { scroll: false });

  // 이동 뒤 결과(가정 있음). 원래 값은 그대로, 가정 값은 띠와 새로 열리는 공고에만 나온다.
  draw(ASSUMED, ASSUMED_LINKS);
  const figures = band.querySelector('[data-slot="gaps-assumption-figures"]');
  expect(figures?.textContent?.replace(/\s+/g, " ")).toBe(
    "참가 가능(API 기준)원래36건가정82건차이+46건배정 예산 합원래33.8억가정286.8억차이+253억",
  );
  expect(band.textContent).toContain("소프트웨어사업자 신고확인서 보유");
  expect(band.textContent).toContain(
    "회사 기록 없음 74 → 28건 · 미보유 변화 없음 · 사람 확인 필요 변화 없음",
  );
  expect(band.textContent).toContain(ASSUMPTION_NOTICE);
  expect(textOf(host, '[data-bucket="ELIGIBLE"]')).toBe("참가 가능(API 기준)36건예산 합 33.8억");
  expect(textOf(host, '[data-slot="gaps-live"]')).toBe(
    "가정 결과. 참가 가능(API 기준) 36건에서 82건으로 바뀜. 배정 예산 합 33.8억에서 286.8억으로 바뀜.",
  );
  await expect.element(swSwitch).toBeChecked();
  // 띠 자리를 미리 잡아 두어 스위치를 켜도 표가 밀리지 않는다.
  expect(bodyRows(host, "막는 자격 순위")[0].getBoundingClientRect().top).toBe(tableTop);

  const opened = bodyRows(host, "가정 시 새로 열리는 공고");
  await expect
    .element(page.getByRole("heading", { level: 2, name: "새로 열리는 공고 46건" }))
    .toBeVisible();
  expect(opened).toHaveLength(10);
  expect(opened[0].querySelector("a")?.getAttribute("href")).toBe(
    `/bids/${OPENED[0].bidId}?origin=live`,
  );
  expect(opened[0].querySelectorAll("td")[2].textContent).toBe("11. 6. · D-9");
  await expect.element(page.getByRole("button", { name: "10건 더 보기" })).toBeVisible();
  expect(withoutFixedNotice(host)).not.toMatch(FORBIDDEN);
  noHorizontalOverflow();
  await shootPage("gaps-1440");

  await page.viewport(1280, 800);
  noHorizontalOverflow();
  const strip1280 = host.querySelector('[aria-label="자격 갭 요약"] dl');
  if (strip1280 === null) throw new Error("요약 띠가 없다");
  expect(strip1280.scrollWidth).toBeLessThanOrEqual(strip1280.clientWidth);
  // 사전 코드로 합친 행의 API 코드("7101·7102·…")가 길어도 자격 칸 안에서 꺾인다.
  const merged = bodyRows(host, "막는 자격 순위")[2].querySelector("th");
  if (merged === null) throw new Error("합친 행 머리가 없다");
  expect(merged.scrollWidth).toBeLessThanOrEqual(merged.clientWidth);
  await shootPage("gaps-1280");

  // 가정 지우기: 가정 없는 주소로 가고, 단추가 사라지기 전에 초점을 띠 제목으로 옮긴다.
  await userEvent.click(page.getByRole("link", { name: "가정 지우기" }));
  expect(spies.router.push).toHaveBeenLastCalledWith("/gaps", { scroll: false });
  expect(document.activeElement?.textContent).toBe("가정 시나리오");
  draw(READY, LINKS);
  expect(textOf(host, '[data-slot="gaps-live"]')).toBe("가정을 지웠습니다. 원래 결과만 보입니다.");
  expect(host.querySelector("#gaps-opened")).toBeNull();

  // 요약 띠의 미보유가 순위 행 합보다 많을 때만, 빠진 건수를 표 아래 한 줄로 밝힌다(띠 5건·표 4건 → 1건).
  expect(host.querySelector('[data-slot="gaps-excluded-not-held"]')).toBeNull();
  draw(NOT_HELD_SPLIT, LINKS);
  expect(textOf(host, '[data-slot="gaps-excluded-not-held"]')).toBe(
    "다른 확인 사항이 함께 걸려 순위에서 뺀 미보유 공고 1건",
  );
  expect(withoutFixedNotice(host)).not.toMatch(FORBIDDEN);
});
