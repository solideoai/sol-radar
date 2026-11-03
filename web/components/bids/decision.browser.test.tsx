import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DecisionPanel, type SubmitResult } from "@/components/bids/decision-panel";
import { EvidenceDrawer } from "@/components/bids/evidence-drawer";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import { REVIEW_FLAG_LABEL } from "@/components/bids/labels";
import { FX01_VIEW, FX02_VIEW, FX03_VIEW, REVIEWS_FX01 } from "@/components/bids/test-data";
import type { BidDocument, Review } from "@/server/bids";

// 결정 패널과 근거 서랍을 진짜 브라우저로 잰다. 레일 폭은 1280 = 320px, 1440 = 360px 이다.

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
});

const render = (node: React.ReactNode, width = 320) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const MEMBERS = [
  { id: "user-sales", name: "김영업" },
  { id: "user-analyst", name: "이분석" },
];

const ok = (): Promise<SubmitResult> => Promise.resolve({ ok: true });

type PanelProps = Partial<React.ComponentProps<typeof DecisionPanel>>;
const panel = (props: PanelProps = {}) => (
  <DecisionPanel
    analysis={FX01_VIEW}
    reviews={REVIEWS_FX01}
    members={MEMBERS}
    currentUserId="user-sales"
    canRecordReview
    bidStatus="OPEN"
    onSubmit={ok}
    {...props}
  />
);

type Submit = React.ComponentProps<typeof DecisionPanel>["onSubmit"];
const spy = () => vi.fn<Submit>(ok);

const firstRadio = () => document.querySelector('[data-slot="radio-group"] [role="radio"]');
const reasonBox = () => page.getByRole("textbox", { name: "사유" });

describe("DecisionPanel 폼", () => {
  it("시스템 권고로 라디오를 미리 고른다(D21)", async () => {
    render(panel());
    await expect.element(page.getByRole("radio", { name: "추천", exact: true })).toBeChecked();
    await expect.element(page.getByRole("radio", { name: "보류" })).not.toBeChecked();
  });

  it("권고가 비추천이면 비추천을 미리 고른다", async () => {
    render(panel({ analysis: FX03_VIEW }));
    await expect.element(page.getByRole("radio", { name: "비추천" })).toBeChecked();
  });

  it("사유 9자는 전송하지 않고 오류와 초점을 사유 칸에 둔다", async () => {
    const onSubmit = spy();
    render(panel({ onSubmit }));
    await userEvent.fill(reasonBox(), "아홉글자입니다요");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("사유를 10자 이상 적어 주세요")).toBeVisible();
    await expect.element(reasonBox()).toHaveAttribute("aria-invalid", "true");
    await expect.element(reasonBox()).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("올바른 입력은 결정·사유·담당자·분석 id 를 넘긴다", async () => {
    const onSubmit = spy();
    render(panel({ onSubmit }));
    await userEvent.click(page.getByRole("radio", { name: "보류" }));
    await userEvent.fill(reasonBox(), "  일정 위험이 있어 지켜봅니다.  ");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      decision: "WATCH",
      reason: "일정 위험이 있어 지켜봅니다.",
      assigneeUserId: "user-sales",
      scoreRunId: FX01_VIEW.id,
    });
  });

  it("분석이 없으면 scoreRunId 없이 제출하고 버튼은 outline 이다", async () => {
    const onSubmit = spy();
    render(panel({ analysis: null, onSubmit }));
    await expect.element(page.getByText("미분석")).toBeVisible();
    await userEvent.click(page.getByRole("radio", { name: "보류" }));
    await userEvent.fill(reasonBox(), "아직 분석 전이지만 지켜봅니다.");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("scoreRunId");
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ decision: "WATCH" });
    const button = page.getByRole("button", { name: "결정 기록" }).element();
    expect(button.className).toContain("border-border");
  });

  it("canRecordReview=false 이면 입력이 모두 비활성이고 이유를 글자로 보인다", async () => {
    render(panel({ canRecordReview: false }));
    await expect
      .element(page.getByText("결정은 관리자·영업 역할만 기록할 수 있습니다"))
      .toBeVisible();
    await expect.element(page.getByRole("radio", { name: "추천", exact: true })).toBeDisabled();
    await expect.element(reasonBox()).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "결정 기록" })).toBeDisabled();
  });

  it("취소된 공고는 폼을 잠그고 이유를 글자로 보인다", async () => {
    render(panel({ bidStatus: "CANCELLED" }));
    await expect.element(reasonBox()).toBeDisabled();
    await expect.element(page.getByText("취소된 공고에는 결정을 기록할 수 없습니다")).toBeVisible();
  });

  it("저장 실패는 폼 위에 코드와 requestId 를 보이고 입력을 남긴다", async () => {
    const onSubmit = vi.fn((): Promise<SubmitResult> =>
      Promise.resolve({
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        message: "서버 오류",
        requestId: "r-1",
      }),
    );
    render(panel({ onSubmit }));
    await userEvent.fill(reasonBox(), "저장이 실패해도 입력은 남아야 합니다.");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("결정을 저장하지 못했습니다")).toBeVisible();
    await expect.element(page.getByText(/INTERNAL_ERROR/)).toBeVisible();
    await expect.element(page.getByText(/r-1/)).toBeVisible();
    await expect.element(reasonBox()).toHaveValue("저장이 실패해도 입력은 남아야 합니다.");
  });

  it("403 은 역할 오류 글자를, 담당자 404 는 담당자 칸 오류를 보인다", async () => {
    const forbidden = (): Promise<SubmitResult> =>
      Promise.resolve({ ok: false, status: 403, code: "FORBIDDEN", message: "x" });
    render(panel({ onSubmit: forbidden }));
    await userEvent.fill(reasonBox(), "역할이 막혀 있는 경우입니다.");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("이 역할로는 결정을 기록할 수 없습니다")).toBeVisible();
  });

  it("담당자가 조직 밖이면 담당자 칸 아래에 오류를 보인다", async () => {
    const outside = (): Promise<SubmitResult> =>
      Promise.resolve({
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "x",
        field: "assigneeUserId",
      });
    render(panel({ onSubmit: outside }));
    await userEvent.fill(reasonBox(), "담당자가 조직 밖인 경우입니다.");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("이 조직 구성원이 아닙니다")).toBeVisible();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("review-assignee"));
  });

  it("결정을 고르지 않고 제출하면 결정 오류를 보이고 초점이 첫 라디오에 간다", async () => {
    const onSubmit = spy();
    render(panel({ analysis: null, onSubmit }));
    await userEvent.fill(reasonBox(), "결정은 고르지 않았지만 사유는 적었습니다.");
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("결정을 선택하세요")).toBeVisible();
    await vi.waitFor(() => expect(document.activeElement).toBe(firstRadio()));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("결정과 사유 오류가 함께면 초점은 결정 쪽이다", async () => {
    render(panel({ analysis: null }));
    await userEvent.click(page.getByRole("button", { name: "결정 기록" }));
    await expect.element(page.getByText("결정을 선택하세요")).toBeVisible();
    await expect.element(page.getByText("사유를 10자 이상 적어 주세요")).toBeVisible();
    await vi.waitFor(() => expect(document.activeElement).toBe(firstRadio()));
  });
});

describe("DecisionPanel 표시", () => {
  it("권고·점수·면책을 보인다", async () => {
    render(panel());
    await expect.element(page.getByRole("heading", { name: "참여 판단" })).toBeVisible();
    await expect.element(page.getByText(FX01_VIEW.disclaimer)).toBeVisible();
    await expect.element(page.getByRole("meter")).toBeVisible();
    expect(page.getByText("사람 검토 권장").elements()).toHaveLength(0);
  });

  it("검토 권장 플래그가 있으면 상자 제목만 보이고 플래그 배지·코드는 없다(FX-02 KEV_NEEDS_REVIEW)", async () => {
    render(panel({ analysis: FX02_VIEW }));
    await expect.element(page.getByText("사람 검토 권장")).toBeVisible();
    expect(page.getByText("KEV_NEEDS_REVIEW").elements()).toHaveLength(0);
    expect(page.getByText(REVIEW_FLAG_LABEL.KEV_NEEDS_REVIEW).elements()).toHaveLength(0);
  });

  it("규칙 우선(FX-03)은 점수에 참고를 붙이고 검토 권장을 보인다", async () => {
    render(panel({ analysis: FX03_VIEW }));
    await expect.element(page.getByText("사람 검토 권장")).toBeVisible();
    await expect.element(page.getByText("참고", { exact: true })).toBeVisible();
  });

  it("규칙 우선 플래그는 레일에 문구를 남기지 않고, 중립 플래그는 라벨만 보이며 320px 레일을 넘지 않는다", async () => {
    const host = render(
      panel({
        analysis: {
          ...FX03_VIEW,
          reviewFlags: [
            "MODEL_RULE_DISAGREEMENT",
            "KEV_MANDATORY_RISK",
            "TRANSLATION_INCOMPLETE",
            "MOCK_FALLBACK",
          ],
        },
      }),
    );
    await expect.element(page.getByText("사람 검토 권장")).toBeVisible();
    await expect
      .element(page.getByText(REVIEW_FLAG_LABEL.TRANSLATION_INCOMPLETE, { exact: true }))
      .toBeVisible();
    // 플래그 영문 코드는 화면에 두지 않는다(2026-11-03 사용자 지시).
    for (const hidden of [
      "TRANSLATION_INCOMPLETE",
      "MOCK_FALLBACK",
      "MODEL_RULE_DISAGREEMENT",
      "KEV_MANDATORY_RISK",
      REVIEW_FLAG_LABEL.MODEL_RULE_DISAGREEMENT,
      REVIEW_FLAG_LABEL.KEV_MANDATORY_RISK,
    ]) {
      expect(page.getByText(hidden).elements()).toHaveLength(0);
    }
    const right = host.getBoundingClientRect().right;
    const outside = Array.from(host.querySelectorAll<HTMLElement>("*")).filter(
      (el) => !el.closest(".sr-only") && el.getBoundingClientRect().right > right + 0.5,
    );
    expect(outside.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("결정 이력: 마지막 결정 줄과 담당자를 보인다", async () => {
    render(panel());
    await expect.element(page.getByRole("heading", { name: "결정 이력" })).toBeVisible();
    await expect.element(page.getByText(/마지막 결정: 추천 · 김영업/)).toBeVisible();
    await expect.element(page.getByText("담당 이분석")).toBeVisible();
  });

  it("권고와 다른 결정에 권고와 다름 배지를 붙인다", async () => {
    const differing: Review = {
      ...REVIEWS_FX01[0]!,
      decision: "WATCH",
      disagreementFlag: true,
    };
    render(panel({ reviews: [differing] }));
    await expect.element(page.getByText("권고와 다름")).toBeVisible();
  });

  it("2000자 사유는 3줄 말줄임이고 펼치기로 모두 보인다. 320px 에서 가로 넘침이 없다", async () => {
    const long: Review = { ...REVIEWS_FX01[0]!, reason: "가".repeat(2000) };
    const host = render(panel({ reviews: [long] }));
    const reasonLine = host.querySelector("p.line-clamp-3") as HTMLElement;
    await expect.element(page.getByRole("button", { name: "펼치기" })).toBeVisible();
    const lineHeight = parseFloat(getComputedStyle(reasonLine).lineHeight);
    expect(reasonLine.clientHeight).toBeLessThanOrEqual(lineHeight * 3 + 1);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    await userEvent.click(page.getByRole("button", { name: "펼치기" }));
    await expect.element(page.getByRole("button", { name: "접기" })).toBeVisible();
    expect(reasonLine.scrollHeight).toBeLessThanOrEqual(reasonLine.clientHeight + 1);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it("결정한 사람의 역할을 모르면(탈퇴한 사용자) 괄호를 그리지 않는다", async () => {
    const deleted: Review = {
      ...REVIEWS_FX01[0]!,
      id: "review-deleted",
      reviewer: { id: "deleted-user", name: "탈퇴한 사용자", role: null },
      decidedAt: "2026-10-15T01:00:00Z",
    };
    const host = render(panel({ reviews: [deleted, ...REVIEWS_FX01] }));
    await expect.element(page.getByText("· 탈퇴한 사용자 ·", { exact: false })).toBeVisible();
    expect(host.textContent).not.toContain("탈퇴한 사용자()");
    expect(host.textContent).not.toContain("()");
    expect(host.textContent).toContain("김영업(영업)");
    expect(host.textContent).not.toContain("(SALES)");
  });

  it("pending 이면 권고·점수 자리를 skeleton 으로 바꾸고 폼과 이력은 그대로 둔다", async () => {
    const host = render(panel({ pending: true }));
    expect(host.querySelector('[data-slot="decision-pending"]')).not.toBeNull();
    expect(page.getByRole("meter").elements()).toHaveLength(0);
    expect(page.getByText(FX01_VIEW.disclaimer).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "결정 기록" })).toBeEnabled();
    await expect.element(page.getByRole("heading", { name: "결정 이력" })).toBeVisible();
  });

  it("짧은 사유에는 펼치기가 없다", async () => {
    render(panel());
    expect(page.getByRole("button", { name: "펼치기" }).elements()).toHaveLength(0);
  });

  it("레일은 aside 이고 제목과 연결된다", async () => {
    render(panel());
    await expect.element(page.getByRole("complementary", { name: "참여 판단" })).toBeVisible();
  });
});

const DOCS: BidDocument[] = [];

function Opener() {
  return (
    <button
      type="button"
      onClick={() =>
        useEvidenceStore.getState().openWith({
          title: "소프트웨어사업자",
          evidence: [
            {
              kind: "TEXT",
              documentId: null,
              revisionId: "rev-1",
              charStart: 9,
              charEnd: 14,
              quotedText: "신고 업체",
              fetchedAt: "2026-10-16T01:00:00Z",
              match: "EXACT",
            },
          ],
        })
      }
    >
      근거 열기
    </button>
  );
}

describe("EvidenceDrawer", () => {
  const drawer = (
    <>
      <Opener />
      <EvidenceDrawer
        content={"소프트웨어사업자 신고 업체이어야 한다. 그 밖의 조건은 없다."}
        sourceUrl="https://example.com/notice"
        documents={DOCS}
      />
    </>
  );

  it("열면 dialog 가 생기고 폭이 480px 이다. Esc 로 닫으면 초점이 연 버튼으로 돌아간다", async () => {
    await page.viewport(1280, 800);
    render(drawer);
    const opener = page.getByRole("button", { name: "근거 열기" });
    await userEvent.click(opener);
    const dialog = page.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    await vi.waitFor(() =>
      expect(Math.round(dialog.element().getBoundingClientRect().width)).toBe(480),
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(page.getByRole("dialog").elements()).toHaveLength(0));
    await expect.element(opener).toHaveFocus();
  });

  it("본문 근거(documentId=null)는 mark 하나와 위치·대조·수집 시각을 보이고 문자 위치·시간대 표기는 없다", async () => {
    render(drawer);
    await userEvent.click(page.getByRole("button", { name: "근거 열기" }));
    const dialog = page.getByRole("dialog").element();
    await vi.waitFor(() => expect(dialog.querySelectorAll("mark")).toHaveLength(1));
    expect(dialog.querySelector("mark")?.textContent).toBe("신고 업체");
    expect(dialog.textContent).toContain("공고 본문");
    expect(dialog.textContent).toContain("원문과 일치");
    expect(dialog.textContent).toContain("수집 2026-10-16 10:00");
    expect(dialog.textContent).not.toMatch(/문자 9|KST|원문 대조/);
  });
});
