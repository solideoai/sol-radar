import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AnalysisBanner } from "@/components/bids/analysis-banner";
import { AnalysisStatus } from "@/components/bids/analysis-status";
import { FACTOR_ORDER, MISSING_REASON_LABEL } from "@/components/bids/labels";
import { KevOpinion } from "@/components/bids/kev-opinion";
import { QualificationChecklist } from "@/components/bids/qualification-checklist";
import { ScoreFactors } from "@/components/bids/score-factors";
import { ScoreGauge } from "@/components/bids/score-gauge";
import { StageTimeline } from "@/components/bids/stage-timeline";
import { FX01_PARTIAL_VIEW, FX01_VIEW, FX02_VIEW, FX03_VIEW } from "@/components/bids/test-data";
import type { AnalysisView, KevView } from "@/server/bids";

// 분석 표시 부품을 진짜 브라우저로 잰다. 컨테이너 폭은 상세 주 영역(1280 = 616px)과 776px(1440)이다.

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 616) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const text = (host: HTMLElement) => host.textContent ?? "";

function factorsOf(view: AnalysisView) {
  return view.scoreBreakdown;
}

const MISSING_VIEW_FACTORS = factorsOf(FX02_VIEW).map((factor) =>
  factor.factor === "strategicPreference"
    ? { ...factor, missing: true, missingReason: "BID_DOMAIN_UNKNOWN" as const, points: 0 }
    : factor,
);

const noEvidenceView: AnalysisView["qualification"] = {
  status: "NEEDS_REVIEW",
  checks: [
    {
      ...FX03_VIEW.qualification.checks[1]!,
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
      reason: "공고 본문에서 찾지 못했습니다",
      evidence: [],
      profileEvidence: [],
    },
  ],
};

const scoreFactors = (view: AnalysisView, extra: { reference?: boolean } = {}) => (
  <ScoreFactors
    factors={view.scoreBreakdown}
    reviewFlags={view.reviewFlags}
    explanation={view.explanation}
    algorithmVersion={view.model.algorithmVersion}
    profileRevision={view.profileRevision}
    {...extra}
  />
);

const kevOpinion = (view: AnalysisView, ruleReason: string | null = null) => (
  <KevOpinion
    kev={view.kev}
    reviewFlags={view.reviewFlags}
    recommendation={view.recommendation}
    ruleReason={ruleReason}
    errorCode={view.errorCode}
  />
);

describe("ScoreFactors", () => {
  it("FX-02 는 요소 5행을 점수표 순서로 그리고 막대 값과 바닥 줄이 맞다", () => {
    const host = render(scoreFactors(FX02_VIEW));
    const meters = Array.from(host.querySelectorAll<HTMLElement>('[role="meter"]'));
    expect(meters).toHaveLength(5);
    expect(meters.map((m) => m.getAttribute("aria-valuenow"))).toEqual([
      "15",
      "18.3",
      "14",
      "15",
      "10",
    ]);
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual([
      "기술 스택 적합",
      "유사 수행 실적",
      "인력 가용성",
      "규모 적합성",
      "전략적 선호",
    ]);
    expect(FACTOR_ORDER).toHaveLength(5);
    expect(meters[0]?.getAttribute("aria-valuetext")).toBe("15.0점 / 30점");
    expect(meters[0]?.getAttribute("aria-valuemax")).toBe("30");
    expect(text(host).match(/\d+\.\d \/ \d+/g)).toEqual([
      "15.0 / 30",
      "18.3 / 25",
      "14.0 / 20",
      "15.0 / 15",
      "10.0 / 10",
    ]);
    expect(text(host)).toContain("합계 72.3");
    expect(text(host)).toContain("SOL Score 72");
    expect(text(host)).toContain("알고리즘 sol-v0.1.0 · 프로필 rev 2");
    expect(text(host)).toContain("마감 촉박 일정 계수 0.7");
    // 규칙 점수 막대는 brand 색이다.
    expect(host.querySelector('[role="meter"] > div')?.className).toContain("bg-brand");
  });

  it("missing 행은 미확인 배지와 사유 글자를 보인다", () => {
    const host = render(
      <ScoreFactors
        factors={MISSING_VIEW_FACTORS}
        reviewFlags={[]}
        explanation={null}
        algorithmVersion="sol-v0.1.0"
        profileRevision={2}
      />,
    );
    expect(text(host)).toContain("미확인");
    expect(text(host)).toContain(MISSING_REASON_LABEL.BID_DOMAIN_UNKNOWN);
    const missingMeter = host.querySelectorAll('[role="meter"]')[4];
    expect(missingMeter?.firstElementChild?.className).toContain("bg-muted-foreground/40");
  });

  it("참고 점수면 꼬리표와 설명을 보인다", () => {
    const host = render(scoreFactors(FX03_VIEW, { reference: true }));
    expect(text(host)).toContain("참고 점수");
    expect(text(host)).toContain("필수자격 미충족으로 권고에 쓰지 않은 점수입니다");
  });

  it("수행 상한 초과 플래그는 규모 적합성 행에 붙는다", () => {
    const host = render(
      <ScoreFactors
        factors={FX02_VIEW.scoreBreakdown}
        reviewFlags={["SCALE_LIMIT_EXCEEDED"]}
        explanation={null}
        algorithmVersion="sol-v0.1.0"
        profileRevision={2}
      />,
    );
    expect(text(host)).toContain("수행 상한 초과");
  });
});

describe("ScoreGauge", () => {
  it("점수와 meter 값을 보이고 참고면 참고 글자가 붙는다", () => {
    const host = render(
      <>
        <ScoreGauge score={68} reference />
        <ScoreGauge score={null} />
      </>,
    );
    const meter = host.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("68");
    expect(meter?.getAttribute("aria-valuemax")).toBe("100");
    expect(text(host)).toContain("참고");
    expect(text(host)).toContain("—");
  });
});

describe("QualificationChecklist", () => {
  it("FX-03 은 미충족 1 요약과 회사 근거 라벨을 보인다", () => {
    const host = render(<QualificationChecklist qualification={FX03_VIEW.qualification} />);
    expect(text(host)).toContain("필수자격");
    expect(text(host)).toContain("2건 · 미충족 1");
    expect(text(host)).toContain("회사:");
    expect(text(host)).toContain("정보통신공사업(보유하지 않음)");
    expect(text(host)).toContain("필수");
    expect(text(host)).toContain("AI 추출");
  });

  it("모두 충족이면 요약이 모두 충족이다", () => {
    const host = render(<QualificationChecklist qualification={FX01_VIEW.qualification} />);
    expect(text(host)).toContain("3건 · 모두 충족");
  });

  it("증거가 빈 확인 필요 행은 09 고정 INSUFFICIENT_DATA 문장과 사유 라벨을 보인다", () => {
    const host = render(<QualificationChecklist qualification={noEvidenceView} />);
    expect(text(host)).toContain(
      "근거를 확인할 수 없어 INSUFFICIENT_DATA로 표시합니다. 이 항목은 점수에 반영하지 않았습니다.",
    );
    expect(text(host)).toContain("공고에서 요구를 찾지 못함");
    expect(text(host)).toContain("NOTICE_INFO_MISSING");
  });

  it("근거 버튼은 제목과 근거 목록으로 핸들러를 부른다", async () => {
    const onOpenEvidence = vi.fn();
    render(
      <QualificationChecklist
        qualification={FX03_VIEW.qualification}
        onOpenEvidence={onOpenEvidence}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "근거 p.5" }));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
    const ctx = onOpenEvidence.mock.calls[0]?.[0] as { title: string; evidence: unknown[] };
    expect(ctx.title).toBe("정보통신공사업 등록");
    expect(ctx.evidence).toHaveLength(1);
  });

  it("핸들러가 없으면 근거는 버튼이 아니라 글자다", () => {
    const host = render(<QualificationChecklist qualification={FX03_VIEW.qualification} />);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(text(host)).toContain("근거 p.5");
  });
});

describe("KevOpinion", () => {
  it("FX-01 은 분포 정수 %, 규칙 권고와 같음, 적합도 4/5, 고지 3줄을 보인다", () => {
    const host = render(kevOpinion(FX01_VIEW));
    for (const t of ["71%", "24%", "5%", "규칙 권고와 같음", "적합도 의견 4/5"]) {
      expect(text(host)).toContain(t);
    }
    expect(text(host)).toContain("Kev 참고 지표");
    expect(text(host)).toContain("모델 참고 지표 (점수 미반영)");
    expect(text(host)).toContain("모델 선택지 신뢰 분포 (충족·수주 확률 아님)");
    expect(text(host)).toContain("Kev 선택지: BID");
    expect(text(host)).toContain(
      "이 의견은 Kev 모델이 BID / WATCH / NO-BID 선택지에 매긴 확률 분포입니다.",
    );
    expect(text(host)).toContain(
      "충족 확률·낙찰 확률이 아니며, 규칙 기반 자격 판정과 SOL Score를 뒤집지 않습니다.",
    );
    expect(text(host)).toContain(
      "최종 결정은 담당자가 기록합니다. 모델: kev-mock · 질문 세트: kev-qs/v0.1 · 공급자: mock",
    );
    expect(text(host)).toContain(FX01_VIEW.kev.disclaimer);
    const meters = host.querySelectorAll('[role="meter"]');
    expect(meters).toHaveLength(3);
    expect(meters[0]?.getAttribute("aria-valuetext")).toBe("BID 선택지 71%");
    expect(meters[0]?.firstElementChild?.className).toContain("bg-muted-foreground");
    expect(text(host)).toContain("0.05");
    expect(text(host)).toContain("기준 0.70 이상");
  });

  it("FX-03 은 규칙 우선 배지와 06 고정 문장을 보인다", () => {
    const host = render(kevOpinion(FX03_VIEW, "필수자격 미충족"));
    expect(text(host)).toContain("규칙 우선");
    expect(text(host)).toContain(
      "Kev는 BID를 제시했지만 필수자격 미충족으로 규칙 판정이 우선합니다",
    );
    expect(text(host)).not.toContain("규칙 권고와 같음");
  });

  it("PARTIAL 은 사용 불가를 보이고 고지 3줄은 없다", () => {
    const host = render(kevOpinion(FX01_PARTIAL_VIEW));
    expect(text(host)).toContain("사용 불가");
    expect(text(host)).not.toContain("이 의견은 Kev 모델이");
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(0);
  });

  it("Kev 서버 미접속은 규칙만 판정 문장을 보인다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_PARTIAL_VIEW.kev}
        reviewFlags={["KEV_UNAVAILABLE"]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
      />,
    );
    expect(text(host)).toContain("사용 불가 (Kev 서버 미접속)");
    expect(text(host)).toContain("Kev 없이 규칙만으로 판정했습니다.");
  });

  it("꺼져 있고 플래그가 없으면 사용 안 함이다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_PARTIAL_VIEW.kev}
        reviewFlags={[]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
      />,
    );
    expect(text(host)).toContain("사용 안 함");
  });

  it("v0.2 필드가 있으면 보정 상태·점수 의견·리스크를 그린다", () => {
    const legend = { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" };
    const kev: KevView = {
      ...FX01_VIEW.kev,
      questionSetVersion: "kev-qs/v0.2",
      scores: { techFit: { score: 3, legend }, perfRelevance: { score: 0, legend } },
      risks: [
        { qid: "risk.schedule", probability: 0.82, overThreshold: true },
        { qid: "risk.staffing", probability: 0.1, overThreshold: false },
      ],
      calibration: {
        status: "UNCALIBRATED",
        datasetVersion: null,
        threshold: 0.7,
        thresholdsVersion: "t1",
      },
    };
    const host = render(
      <KevOpinion
        kev={kev}
        reviewFlags={[]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
      />,
    );
    expect(text(host)).toContain("미보정 · 기준 τ 0.70");
    expect(text(host)).toContain("기술 적합 의견 4/5");
    expect(text(host)).toContain("실적 연관 의견 1/5");
    expect(text(host)).toContain("SOL Score에 더하지 않음");
    expect(text(host)).toContain("일정");
    expect(text(host)).toContain("0.82");
    expect(text(host)).toContain("기준 이상");
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(5);
  });
});

describe("AnalysisBanner", () => {
  it("PARTIAL 은 09 고정 문장과 코드를 role=status 안에 보인다", () => {
    const host = render(<AnalysisBanner analysis={FX01_PARTIAL_VIEW} bidStatus="OPEN" />);
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)",
    );
    expect(status?.textContent).toContain("AI_UNAVAILABLE");
    expect(status?.textContent).toContain("RULES_ONLY");
  });

  it("취소 공고는 취소 문장을 보인다", () => {
    const host = render(<AnalysisBanner analysis={null} bidStatus="CANCELLED" />);
    expect(text(host)).toContain("이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다");
  });

  it("MOCK_FALLBACK 은 09 고정 Mock 대체 문장과 사유를 보인다", () => {
    const host = render(
      <AnalysisBanner
        analysis={{
          ...FX01_VIEW,
          reviewFlags: ["MOCK_FALLBACK"],
          fallbackReason: "QWEN_UNAVAILABLE",
        }}
        bidStatus="OPEN"
      />,
    );
    expect(text(host)).toContain(
      "모델 서버에 연결하지 못해 Mock 결과를 표시합니다. (실제 모델 결과 아님)",
    );
    expect(text(host)).toContain("QWEN_UNAVAILABLE");
  });

  it("실패와 지연을 보이고, 해당 없으면 아무것도 그리지 않는다", () => {
    const failed = render(
      <AnalysisBanner
        analysis={{ ...FX01_VIEW, status: "FAILED", errorCode: "ANALYSIS_TIMEOUT" }}
        bidStatus="OPEN"
      />,
    );
    expect(text(failed)).toContain("분석에 실패했습니다.");
    expect(text(failed)).toContain("ANALYSIS_TIMEOUT");
    const delayed = render(<AnalysisBanner analysis={null} bidStatus="OPEN" delayed />);
    expect(text(delayed)).toContain("분석이 지연되고 있습니다.");
    const none = render(<AnalysisBanner analysis={null} bidStatus="OPEN" />);
    expect(none.innerHTML).toBe("");
    const ok = render(<AnalysisBanner analysis={FX01_VIEW} bidStatus="OPEN" />);
    expect(ok.innerHTML).toBe("");
  });
});

describe("AnalysisStatus", () => {
  it("상태와 끝난 시각을 KST 로 보이고, 없으면 미분석이다", () => {
    const host = render(
      <>
        <AnalysisStatus status="PARTIAL" at="2026-10-16T00:00:02Z" />
        <AnalysisStatus status={null} />
        <AnalysisStatus status="PARTIAL" short />
      </>,
    );
    expect(text(host)).toContain("부분 완료 (규칙만)");
    expect(text(host)).toContain("2026-10-16 09:00");
    expect(text(host)).toContain("미분석");
    expect(text(host)).toContain("부분 완료");
  });
});

describe("StageTimeline", () => {
  it("지금 단계에 revision 을 붙이고 나머지는 참조 또는 —를 보인다", () => {
    const host = render(
      <StageTimeline
        stage="NOTICE"
        stageLinks={{ planRef: "PLAN-77", preSpecRef: null }}
        latestRevision={3}
      />,
    );
    expect(text(host)).toContain("발주계획PLAN-77");
    expect(text(host)).toContain("사전규격—");
    expect(text(host)).toContain("입찰공고r3");
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("입찰공고");
  });
});

describe("공통", () => {
  const all = (width: number) =>
    render(
      <div className="flex flex-col gap-4">
        <AnalysisStatus status="PARTIAL" at="2026-10-16T00:00:02Z" />
        <ScoreGauge score={72} />
        {scoreFactors(FX02_VIEW)}
        <QualificationChecklist qualification={FX03_VIEW.qualification} onOpenEvidence={() => {}} />
        <QualificationChecklist qualification={noEvidenceView} />
        {kevOpinion(FX03_VIEW, "필수자격 미충족")}
        {kevOpinion(FX01_PARTIAL_VIEW)}
        <AnalysisBanner analysis={FX01_PARTIAL_VIEW} bidStatus="CANCELLED" delayed />
        <StageTimeline
          stage="NOTICE"
          stageLinks={{ planRef: "PLAN-2026-000123", preSpecRef: "PRESPEC-2026-000456" }}
          latestRevision={12}
        />
      </div>,
      width,
    );

  it.each([616, 776])("%ipx 에서 가로로 넘치지 않는다", (width) => {
    const host = all(width);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    for (const el of host.querySelectorAll<HTMLElement>("*")) {
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
    }
  });

  it("수주 확률은 아님 문장 안에서만 나온다", () => {
    const host = all(616);
    expect(text(host)).not.toMatch(/수주\s?확률(?!.{0,20}아)/);
    expect(text(host)).not.toMatch(/낙찰\s?확률(?!.{0,20}아)/);
  });
});
