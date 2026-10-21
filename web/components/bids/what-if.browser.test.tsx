import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { QualificationChecklist } from "@/components/bids/qualification-checklist";
import { FX03_WHAT_IF_VIEW, whatIfSummaryOf } from "@/components/bids/test-data";
import { WhatIfBand, WhatIfNotice } from "@/components/bids/what-if-band";
import type { WhatIfSummary } from "@/server/scoring";

// BOOST-2 가정 시나리오 띠와 필수자격 "보유 가정" 스위치를 진짜 브라우저에 그린다(디자인 스펙 docs/plans/2026-10-20-boost2-what-if-ui.md).
// 요청·연타·결정 패널과의 분리는 화면 쪽 시험(app/(app)/(work)/bids/[id]/what-if.browser.test.tsx)이 본다.
// 띠 안쪽 폭은 1440px 742px, 1280px 582px 이다(스펙 §3.2).

const W1 = "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.";
const W2 = "결정 모델 의견은 가정에 포함하지 않았습니다.";
const W6 = "보유 가정을 켜면 저장하지 않고 권고와 점수를 다시 계산합니다.";
const W7 = "가정은 10개까지 켤 수 있습니다.";
const W11 = "바뀐 요소 없음 · 필수자격 판정은 SOL Score 계산에 들어가지 않습니다";
const FORBIDDEN = /확률|승률|가능성|수주|%/;
const ICT = "ICT_CONSTRUCTION";

const BEFORE = whatIfSummaryOf(FX03_WHAT_IF_VIEW);
// 정보통신공사업 등록을 보유했다고 가정하면 자격은 충족, 권고는 WATCH(점수 68 이 BID 기준 미만), 점수는 그대로다.
const AFTER = whatIfSummaryOf(FX03_WHAT_IF_VIEW, {
  recommendation: "WATCH",
  qualificationStatus: "SATISFIED",
  checks: BEFORE.checks.map((check) =>
    check.id === "q2" ? { ...check, outcome: "SATISFIED" } : check,
  ),
});
const ASSUMED = [{ code: ICT, name: "정보통신공사업 등록" }];

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 742) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

type BandProps = React.ComponentProps<typeof WhatIfBand>;
const band = (props: Partial<BandProps> = {}) => (
  <WhatIfBand
    assumptions={ASSUMED}
    state={{ phase: "result", before: BEFORE, after: AFTER }}
    onClear={() => {}}
    onRetry={() => {}}
    {...props}
  />
);

const bandOf = (host: HTMLElement) => {
  const section = host.querySelector<HTMLElement>('[data-slot="what-if-band"]');
  if (section === null) throw new Error("띠가 없다");
  return section;
};
const comparisonRows = () =>
  page.getByRole("table", { name: "원래 결과와 가정 결과 비교" }).getByRole("row");

describe("WhatIfBand 결과(스펙 §4.3)", () => {
  it("원래 → 가정 권고·점수·자격과 고정 문구 두 줄, 켠 가정 칩을 그린다", async () => {
    const host = render(band());
    const section = bandOf(host);
    expect(section.tagName).toBe("SECTION");
    expect(section.getAttribute("aria-busy")).not.toBe("true");
    const title = page.getByRole("heading", { level: 2, name: "가정 시나리오" });
    await expect.element(title).toHaveAttribute("tabindex", "-1");
    await expect.element(page.getByText(W1, { exact: true })).toBeVisible();
    await expect.element(page.getByText(W2, { exact: true })).toBeVisible();
    await expect.element(page.getByText("정보통신공사업 등록 보유", { exact: true })).toBeVisible();
    await expect.element(comparisonRows().nth(0)).toHaveTextContent(/원래.*가정/);
    await expect.element(comparisonRows().nth(1)).toHaveTextContent(/^권고NO-BIDWATCH$/);
    await expect
      .element(comparisonRows().nth(2))
      .toHaveTextContent(/^SOL Score68\/ 100참고68\/ 100변화 없음$/);
    await expect.element(comparisonRows().nth(3)).toHaveTextContent(/^필수자격미충족충족$/);
    // 상태는 아이콘 + 글자 + 색이다. 화살표는 읽지 않는다.
    const recommendationCells = comparisonRows().nth(1).getByRole("cell").elements();
    expect(recommendationCells[0]?.querySelector(".text-destructive svg")).not.toBeNull();
    expect(recommendationCells[1]?.querySelector(".text-warning svg")).not.toBeNull();
    expect(recommendationCells[1]?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "가정 지우기" })).toBeVisible();
  });

  it("바뀐 자격 항목은 바뀐 행만, 요소 변화가 없으면 고정 안내 한 줄이다", async () => {
    const host = render(band());
    const changed = page.getByRole("heading", { level: 3, name: "바뀐 자격 항목" });
    await expect.element(changed).toBeVisible();
    const items = bandOf(host).querySelectorAll("ul li");
    expect(Array.from(items, (item) => item.textContent)).toEqual([
      "정보통신공사업 등록미충족충족",
    ]);
    await expect
      .element(page.getByRole("heading", { level: 3, name: "요소별 점수" }))
      .toBeVisible();
    await expect.element(page.getByText(W11, { exact: true })).toBeVisible();
  });

  it("값이 모두 같으면 세 행 모두 변화 없음이고 바뀐 자격 항목 없음이다", async () => {
    const host = render(band({ state: { phase: "result", before: BEFORE, after: BEFORE } }));
    const unchanged = Array.from(bandOf(host).querySelectorAll("tbody tr"), (row) =>
      (row.textContent ?? "").includes("변화 없음"),
    );
    expect(unchanged).toEqual([true, true, true]);
    await expect.element(page.getByText("바뀐 자격 항목 없음", { exact: true })).toBeVisible();
  });

  it.each([
    [74, 26, "+6점", "기술 스택 적합20.0 → 26.0 / 30 (+6.0)"],
    [60, 12, "−8점", "기술 스택 적합20.0 → 12.0 / 30 (−8.0)"],
  ])(
    "점수가 %i 이면 차이 %s 와 바뀐 요소 줄을 보인다",
    async (score, points, delta, factorLine) => {
      const after: WhatIfSummary = {
        ...AFTER,
        score,
        factors: AFTER.factors.map((f) => (f.factor === "skillMatch" ? { ...f, points } : f)),
      };
      const host = render(band({ state: { phase: "result", before: BEFORE, after } }));
      await expect.element(comparisonRows().nth(2)).toHaveTextContent(delta);
      const factorItems = Array.from(
        bandOf(host).querySelectorAll('[data-slot="what-if-factors"] li'),
        (item) => item.textContent,
      );
      expect(factorItems).toEqual([factorLine]);
    },
  );

  it("띠·칩·버튼 글자에 확률·승률·가능성·수주·% 가 없다", () => {
    const host = render(band());
    expect(bandOf(host).textContent).not.toMatch(FORBIDDEN);
  });
});

describe("WhatIfBand 계산 중·실패(스펙 §4.6)", () => {
  it("계산 중이면 aria-busy 이고 값 칸은 skeleton, 고정 문구와 칩은 그대로다", async () => {
    const host = render(band({ state: { phase: "calculating" } }));
    const section = bandOf(host);
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(8);
    await expect.element(page.getByText(W1, { exact: true })).toBeVisible();
    await expect.element(page.getByText(W2, { exact: true })).toBeVisible();
    await expect.element(page.getByText("정보통신공사업 등록 보유", { exact: true })).toBeVisible();
    // 이전 결과를 남기지 않는다(D7).
    expect(section.textContent).not.toContain("NO-BID");
    expect(section.textContent).not.toContain("WATCH");
  });

  it("실패하면 비교표 자리에 사유·코드·요청 id 와 [다시 시도]를 두고, 띠 안에서 알리지 않는다", async () => {
    const onRetry = vi.fn();
    const onClear = vi.fn();
    const host = render(
      band({
        state: {
          phase: "error",
          failure: {
            code: "ANALYSIS_IN_PROGRESS",
            message: "분석이 아직 진행 중입니다",
            requestId: "req-409",
          },
        },
        onRetry,
        onClear,
      }),
    );
    const error = bandOf(host).querySelector<HTMLElement>('[data-slot="what-if-calc-error"]');
    expect(error?.textContent).toContain("가정 결과를 계산하지 못했습니다");
    expect(error?.textContent).toContain("분석이 아직 진행 중입니다");
    expect(error?.textContent).toContain("ANALYSIS_IN_PROGRESS · req-409");
    expect(error?.querySelector(".text-destructive")).not.toBeNull();
    expect(bandOf(host).querySelector("table")).toBeNull();
    expect(bandOf(host).querySelector('[role="alert"], [role="status"]')).toBeNull();
    await expect.element(page.getByText(W1, { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("button", { name: "가정 지우기" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("WhatIfBand 폭(스펙 §3.2·§9)", () => {
  const longName = "정보통신공사업법에 따른 정보통신공사업 등록 및 소프트웨어 직접생산확인증명서";
  const busyBand = () =>
    band({
      assumptions: [
        { code: ICT, name: longName },
        { code: "DIRECT_PRODUCTION", name: "직접생산확인증명서" },
      ],
      state: {
        phase: "result",
        before: {
          ...BEFORE,
          checks: BEFORE.checks.map((c) => ({ ...c, requirementName: longName })),
        },
        after: { ...AFTER, checks: AFTER.checks.map((c) => ({ ...c, requirementName: longName })) },
      },
    });

  it.each([
    [742, true],
    [582, false],
  ])("띠 안쪽 %ipx 에서 가로로 넘치지 않고 자세히 2열은 %s 다", async (inner, twoColumns) => {
    // 띠 안쪽 = 상자 폭 - 테두리 2 - p-4 32.
    const host = render(busyBand(), inner + 34);
    await document.fonts.ready;
    const section = bandOf(host);
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
    const right = section.getBoundingClientRect().right;
    const outside = Array.from(section.querySelectorAll<HTMLElement>("*")).filter(
      (el) => !el.closest(".sr-only") && el.getBoundingClientRect().right > right + 0.5,
    );
    expect(outside.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    const [changed, factors] = Array.from(section.querySelectorAll("h3"), (h) =>
      h.getBoundingClientRect(),
    );
    expect(changed?.top === factors?.top).toBe(twoColumns);
  });
});

describe("WhatIfNotice(스펙 §4.5)", () => {
  it("불러오기 실패는 코드·요청 id 와 [다시 시도]를 보이고 경고 역할을 쓰지 않는다", async () => {
    const onRetry = vi.fn();
    const host = render(
      <WhatIfNotice
        kind="load-error"
        failure={{
          code: "INTERNAL_ERROR",
          message: "요청을 처리하지 못했습니다.",
          requestId: "req-500",
        }}
        onRetry={onRetry}
      />,
    );
    const line = host.querySelector<HTMLElement>('[data-slot="what-if-load-error"]');
    expect(line?.textContent).toContain("보유 가정을 불러오지 못했습니다");
    expect(line?.textContent).toContain("INTERNAL_ERROR · req-500");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "no-snapshot",
      "이 분석에는 가정 계산에 쓸 입력 기록이 없습니다. 재분석하면 보유 가정을 켤 수 있습니다.",
    ],
    [
      "mismatch",
      "저장된 분석과 지금 규칙으로 다시 계산한 값이 달라 가정을 켤 수 없습니다. 재분석하면 쓸 수 있습니다.",
    ],
  ] as const)("%s 는 안내 한 줄만 보이고 다시 시도가 없다", async (kind, copy) => {
    render(<WhatIfNotice kind={kind} />);
    await expect.element(page.getByText(copy, { exact: true })).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });
});

describe("QualificationChecklist 보유 가정 스위치(스펙 §4.2)", () => {
  type ChecklistProps = React.ComponentProps<typeof QualificationChecklist>;
  const checklist = (props: Partial<ChecklistProps> = {}) => (
    <QualificationChecklist
      qualification={FX03_WHAT_IF_VIEW.qualification}
      assumable={new Set([ICT])}
      assumed={new Set()}
      onToggleAssumption={() => {}}
      {...props}
    />
  );
  const switchGroupText = (host: HTMLElement) =>
    Array.from(
      host.querySelectorAll('[data-slot="what-if-switch"]'),
      (el) => el.parentElement?.textContent ?? "",
    ).join(" ");

  it("assumable 행에만 스위치를 달고 이름은 '{행 이름} 보유 가정', 설명은 안내 줄이다", async () => {
    const host = render(checklist(), 616);
    const switches = page.getByRole("switch");
    expect(switches.elements()).toHaveLength(1);
    const only = page.getByRole("switch", { name: "정보통신공사업 등록 보유 가정" });
    await expect.element(only).toHaveAttribute("aria-checked", "false");
    await expect.element(only).toHaveAttribute("data-slot", "what-if-switch");
    await expect.element(only).toHaveAttribute("data-code", ICT);
    const hintId = only.element().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)?.textContent).toBe(W6);
    // 판정 배지는 원래 그대로다.
    const row = only.element().closest("li");
    expect(row?.textContent).toContain("미충족");
    // 스위치는 첫 줄 오른쪽 끝, 이름 묶음과 같은 줄 위쪽이다.
    const name = page
      .getByText("정보통신공사업 등록", { exact: true })
      .element()
      .getBoundingClientRect();
    const box = only.element().getBoundingClientRect();
    expect(box.left).toBeGreaterThan(name.right);
    expect(Math.abs(box.right - (row?.getBoundingClientRect().right ?? 0))).toBeLessThan(1);
    expect(host.textContent).not.toContain("가정 시나리오 보기");
    expect(`${switchGroupText(host)} ${W6}`).not.toMatch(FORBIDDEN);
  });

  it("스위치·라벨 글자·Space 로 바꾸면 그 코드로 한 번씩 부른다", async () => {
    const onToggle = vi.fn();
    render(checklist({ onToggleAssumption: onToggle }), 616);
    const only = page.getByRole("switch", { name: "정보통신공사업 등록 보유 가정" });
    await userEvent.click(only);
    await userEvent.click(page.getByText("보유 가정", { exact: true }));
    only.element().focus();
    await userEvent.keyboard(" ");
    expect(onToggle.mock.calls).toEqual([[ICT], [ICT], [ICT]]);
  });

  it("켠 행은 스위치가 켜지고 '가정 시나리오 보기'가 생기지만 배지·사유는 그대로다", async () => {
    const host = render(checklist({ assumed: new Set([ICT]) }), 616);
    const only = page.getByRole("switch", { name: "정보통신공사업 등록 보유 가정" });
    await expect.element(only).toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("button", { name: "가정 시나리오 보기" })).toBeVisible();
    const row = only.element().closest("li");
    expect(row?.textContent).toContain("미충족");
    expect(row?.textContent).toContain("프로필에 등록 없음");
    expect(host.querySelectorAll('[data-slot="what-if-switch"][data-checked]')).toHaveLength(1);
  });

  it("꺼짐 트랙은 muted-foreground 테두리로 흰 바탕 위에서 보인다(WCAG 1.4.11)", () => {
    render(checklist(), 616);
    const track = page.getByRole("switch").element();
    expect(track.className).toContain("border-muted-foreground");
    expect(track.className).toContain("bg-background");
    const style = getComputedStyle(track);
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderTopColor).not.toBe(style.backgroundColor);
    expect(track.getBoundingClientRect().height).toBe(20);
    expect(track.getBoundingClientRect().width).toBe(36);
  });

  it("10개를 켜면 꺼진 스위치는 비활성이고 안내 줄 끝에 한도 문장을 붙인다", async () => {
    const ten = new Set(Array.from({ length: 10 }, (_, i) => `CODE_${i}`));
    render(checklist({ assumed: ten }), 616);
    await expect.element(page.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByText(`${W6} ${W7}`, { exact: true })).toBeVisible();
  });

  it("assumable 이 없으면 스위치·안내 줄이 없다(지금 화면 그대로)", () => {
    const host = render(<QualificationChecklist qualification={FX03_WHAT_IF_VIEW.qualification} />);
    expect(page.getByRole("switch").elements()).toHaveLength(0);
    expect(host.textContent).not.toContain(W6);
  });

  it("notice 는 필수자격 제목 바로 아래에 둔다", () => {
    const host = render(
      checklist({ assumable: undefined, notice: <WhatIfNotice kind="mismatch" /> }),
    );
    const heading = host.querySelector("h2");
    expect(heading?.nextElementSibling?.textContent).toContain("저장된 분석과 지금 규칙으로");
  });
});
