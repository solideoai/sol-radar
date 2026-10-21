import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AnalysisBanner } from "@/components/bids/analysis-banner";
import { AnalysisStatus } from "@/components/bids/analysis-status";
import { FACTOR_ORDER, MISSING_REASON_LABEL, ruleReasonOf } from "@/components/bids/labels";
import { KevOpinion } from "@/components/bids/kev-opinion";
import { QualificationChecklist } from "@/components/bids/qualification-checklist";
import { ScoreFactors } from "@/components/bids/score-factors";
import { ScoreGauge } from "@/components/bids/score-gauge";
import { StageTimeline } from "@/components/bids/stage-timeline";
import { StatusBadge } from "@/components/bids/status-badge";
import {
  BOSUN_MODEL_ID,
  FX01_LIVE_VIEW,
  FX01_PARTIAL_VIEW,
  FX01_VIEW,
  FX02_VIEW,
  FX03_VIEW,
} from "@/components/bids/test-data";
import type { AnalysisView, KevView, RequirementAssessmentView } from "@/server/bids";

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
    expect(missingMeter?.getAttribute("aria-valuetext")).toBe("0.0점 / 10점 (미확인)");
  });

  it("missing 인데 사유가 기록되지 않은 행은 '사유 기록 없음'을 보인다(판단 7)", () => {
    const factors = factorsOf(FX02_VIEW).map((factor) =>
      factor.factor === "scaleFit"
        ? { ...factor, missing: true, missingReason: null, points: 0 }
        : factor,
    );
    const host = render(
      <ScoreFactors
        factors={factors}
        reviewFlags={[]}
        explanation={null}
        algorithmVersion="sol-v0.1.0"
        profileRevision={2}
      />,
    );
    const rows = Array.from(host.querySelectorAll("li"));
    const scaleRow = rows.find((row) => row.textContent?.startsWith("규모 적합성"));
    expect(scaleRow?.textContent).toContain("미확인");
    expect(scaleRow?.textContent).toContain("사유 기록 없음");
    // 사유가 있는 행이나 missing 이 아닌 행에는 붙지 않는다.
    expect(text(host).match(/사유 기록 없음/g)).toHaveLength(1);
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

describe("ScoreFactors 동작", () => {
  const longText = "설명".repeat(60);
  const withText = (explanation: string, onOpenEvidence?: (ctx: unknown) => void) => (
    <ScoreFactors
      factors={FX02_VIEW.scoreBreakdown.map((f) =>
        f.factor === "skillMatch"
          ? { ...f, evidence: [FX03_VIEW.qualification.checks[1]!.evidence[0]!] }
          : f,
      )}
      reviewFlags={[]}
      explanation={explanation}
      algorithmVersion="sol-v0.1.0"
      profileRevision={2}
      onOpenEvidence={onOpenEvidence}
    />
  );

  it("100자를 넘는 설명은 접힌 채 시작해 펼치기로 풀린다", async () => {
    const host = render(withText(longText));
    const button = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const para = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(para.className).toContain("line-clamp-4");
    await userEvent.click(page.getByRole("button", { name: "펼치기" }));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(para.className).not.toContain("line-clamp-4");
  });

  it("100자 이하면 펼치기 버튼이 없다", () => {
    const host = render(withText("짧은 설명"));
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
  });

  it("근거 버튼은 요소 라벨과 근거로 핸들러를 1회 부른다", async () => {
    const onOpenEvidence = vi.fn();
    render(withText("짧은 설명", onOpenEvidence));
    await userEvent.click(page.getByRole("button", { name: "근거 1건" }));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
    const ctx = onOpenEvidence.mock.calls[0]?.[0] as { title: string; evidence: unknown[] };
    expect(ctx.title).toBe("기술 스택 적합");
    expect(ctx.evidence).toHaveLength(1);
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

  it("해당 없음(STAGE_NOT_APPLICABLE) 행은 INSUFFICIENT_DATA 문장 없이 해당 없음만 보인다", () => {
    const notApplicable: AnalysisView["qualification"] = {
      status: "NEEDS_REVIEW",
      checks: [
        {
          ...noEvidenceView.checks[0]!,
          reasonCode: "STAGE_NOT_APPLICABLE",
          reason: "발주계획 단계라 자격 요건이 없습니다",
        },
      ],
    };
    const host = render(<QualificationChecklist qualification={notApplicable} />);
    expect(text(host)).toContain("해당 없음");
    expect(text(host)).not.toContain("INSUFFICIENT_DATA로 표시합니다");
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
    expect(text(host)).toContain("결정 모델 참고 지표");
    expect(text(host)).toContain("모델 참고 지표 (점수 미반영)");
    expect(text(host)).toContain("모델 선택지 신뢰 분포 (충족·수주 확률 아님)");
    expect(text(host)).toContain("결정 모델 선택지: BID");
    expect(text(host)).toContain(
      "이 의견은 결정 모델이 BID / WATCH / NO-BID 선택지에 매긴 확률 분포입니다.",
    );
    expect(text(host)).toContain(
      "충족 확률·낙찰 확률이 아니며, 규칙 기반 자격 판정과 SOL Score를 뒤집지 않습니다.",
    );
    // mock 응답은 실제 모델처럼 보이면 안 된다(ADR-034 15번). 모델명 자리에 "Mock 응답(데모 데이터)".
    expect(text(host)).toContain(
      "최종 결정은 담당자가 기록합니다. Mock 응답(데모 데이터) · 질문 세트: kev-qs/v0.1 · 공급자: mock",
    );
    expect(text(host)).not.toContain("kev-mock");
    expect(text(host)).not.toContain("모델: ");
    // 고지 끝줄은 API 의 KEV_DISCLAIMER literal 대신 모델 중립 문구를 보인다(미결정 30-2(a)). 화면 어디에도 "Kev" 가 없다.
    expect(text(host)).toContain(
      "결정 모델 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.",
    );
    expect(text(host)).not.toContain(FX01_VIEW.kev.disclaimer);
    expect(text(host)).not.toMatch(/Kev/);
    const meters = host.querySelectorAll('[role="meter"]');
    expect(meters).toHaveLength(3);
    expect(meters[0]?.getAttribute("aria-valuetext")).toBe("BID 선택지 71%");
    expect(meters[0]?.firstElementChild?.className).toContain("bg-muted-foreground");
    expect(text(host)).toContain("0.05");
    expect(text(host)).toContain("기준 0.70 이상");
  });

  it("실모델(local) 응답은 받은 식별자를 그대로 보이고 Mock 문구를 쓰지 않는다", () => {
    const host = render(kevOpinion(FX01_LIVE_VIEW));
    expect(text(host)).toContain(
      `최종 결정은 담당자가 기록합니다. 모델: ${BOSUN_MODEL_ID} · 질문 세트: kev-qs/v0.2 · 공급자: local`,
    );
    expect(text(host)).not.toContain("Mock 응답");
    // 표시 이름 대응표를 두지 않는다(06 §7 D12). "Bosun v3.1" 같은 가공 이름이 없다.
    expect(text(host)).not.toMatch(/Bosun v3\.1/);
  });

  it("FX-03 은 규칙 우선 배지와 06 고정 문장을 보인다", () => {
    const host = render(kevOpinion(FX03_VIEW, "필수자격 미충족"));
    expect(text(host)).toContain("규칙 우선(결정 모델 의견 상이)");
    expect(text(host)).toContain(
      "결정 모델은 BID를 제시했지만 필수자격 미충족으로 규칙 판정이 우선합니다",
    );
    expect(text(host)).not.toContain("규칙 권고와 같음");
  });

  it("ruleReasonOf(FX03_VIEW) 로 06 고정 문장이 그대로 나온다", () => {
    const host = render(kevOpinion(FX03_VIEW, ruleReasonOf(FX03_VIEW)));
    expect(text(host)).toContain(
      "결정 모델은 BID를 제시했지만 필수자격 미충족으로 규칙 판정이 우선합니다",
    );
  });

  it("규칙 권고가 없으면 '규칙 권고와 같음'을 쓰지 않는다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_VIEW.kev}
        reviewFlags={[]}
        recommendation={null}
        ruleReason={null}
        errorCode={null}
      />,
    );
    expect(text(host)).toContain("결정 모델 선택지: BID");
    expect(text(host)).not.toContain("규칙 권고와 같음");
  });

  it("PARTIAL 은 사용 불가를 보이고 고지 3줄은 없다", () => {
    const host = render(kevOpinion(FX01_PARTIAL_VIEW));
    expect(text(host)).toContain("사용 불가");
    expect(text(host)).not.toContain("이 의견은 결정 모델이");
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(0);
  });

  it("KEV_UNAVAILABLE(미접속·응답 형식 오류)은 '사용 불가'와 규칙만 판정 문장을 보인다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_PARTIAL_VIEW.kev}
        reviewFlags={["KEV_UNAVAILABLE"]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
      />,
    );
    // ADR-031 C6·ADR-032 D9: 이 플래그는 미접속과 응답 형식 오류를 함께 뜻하므로 "서버 미접속"이라 쓰지 않는다.
    // 상태 줄은 "사용 불가" 하나이고, 사유는 그 아래 문장으로 둔다(e8 Ruling 11, 같은 말 되풀이 금지).
    const lines = Array.from(host.querySelectorAll("p")).map((p) => p.textContent);
    expect(lines).toContain("사용 불가");
    expect(lines.indexOf("결정 모델 응답을 받지 못했거나 응답을 쓸 수 없습니다.")).toBe(
      lines.indexOf("사용 불가") + 1,
    );
    expect(text(host)).not.toContain("(결정 모델 사용 불가)");
    expect(text(host)).not.toContain("서버 미접속");
    expect(text(host)).toContain("결정 모델 없이 규칙만으로 판정했습니다.");
    expect(text(host)).not.toMatch(/Kev/);
  });

  it("KEV_UNAVAILABLE 플래그 배지는 '결정 모델 사용 불가'다", () => {
    const host = render(<StatusBadge kind="flag" value="KEV_UNAVAILABLE" showCode />);
    expect(text(host)).toBe("결정 모델 사용 불가KEV_UNAVAILABLE");
  });

  it("notRecorded 면 '기록 없음'을 보이고 '사용 안 함'은 없다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_PARTIAL_VIEW.kev}
        reviewFlags={[]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
        notRecorded
      />,
    );
    expect(text(host)).toContain("기록 없음");
    expect(text(host)).not.toContain("사용 안 함");
  });

  it("notRecorded 여도 결정 모델 불가 플래그가 있으면 불가 문장이 우선한다", () => {
    const host = render(
      <KevOpinion
        kev={FX01_PARTIAL_VIEW.kev}
        reviewFlags={["KEV_UNAVAILABLE"]}
        recommendation="BID"
        ruleReason={null}
        errorCode={null}
        notRecorded
      />,
    );
    expect(text(host)).toContain("결정 모델 응답을 받지 못했거나 응답을 쓸 수 없습니다.");
    expect(text(host)).not.toContain("기록 없음");
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

describe("KevOpinion 항목별 분포", () => {
  const base = FX01_VIEW.requirementAssessments[0]!;
  const assessmentList: { assessment: RequirementAssessmentView; label: string }[] = [
    { assessment: base, label: "소프트웨어사업자 신고" },
    {
      assessment: {
        ...base,
        itemId: "qualifications[1]",
        ruleStatus: "NOT_SATISFIED",
        flags: ["KEV_REQUIREMENT_DISAGREEMENT"],
      },
      label: "정보통신공사업 등록",
    },
  ];
  const v02 = (qs: "kev-qs/v0.1" | "kev-qs/v0.2", assessments?: typeof assessmentList) => (
    <KevOpinion
      kev={{ ...FX01_VIEW.kev, questionSetVersion: qs }}
      reviewFlags={[]}
      recommendation="BID"
      ruleReason={null}
      errorCode={null}
      assessments={assessments}
    />
  );

  it("v0.2 이고 항목이 있으면 접힌 details 를 그리고 열면 행과 분포가 보인다", () => {
    const host = render(v02("kev-qs/v0.2", assessmentList));
    const details = host.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("항목별 분포 2건");
    details.querySelector("summary")!.click();
    expect(details.open).toBe(true);
    expect(details.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(details.querySelector("thead")?.textContent).toContain("결정 모델 분포");
    expect(text(details)).toContain("충족 86% · 미충족 4% · 확인 필요 10%");
    expect(text(details)).toContain("소프트웨어사업자 신고");
    expect(text(details).match(/항목 판정 상이/g)).toHaveLength(1);
    expect(text(details)).toContain("미충족");
  });

  it("kev 분포가 없는 항목은 —를 보인다", () => {
    const host = render(
      v02("kev-qs/v0.2", [{ assessment: { ...base, kev: null }, label: "항목" }]),
    );
    expect(host.querySelector("tbody td:last-child")?.textContent).toBe("—");
  });

  it("v0.1 이거나 항목이 없으면 details 가 없다", () => {
    expect(render(v02("kev-qs/v0.1", assessmentList)).querySelector("details")).toBeNull();
    expect(render(v02("kev-qs/v0.2")).querySelector("details")).toBeNull();
    expect(render(v02("kev-qs/v0.2", [])).querySelector("details")).toBeNull();
  });
});

describe("AnalysisBanner", () => {
  it("실패 배너의 재분석과 지연 배너의 새로고침은 핸들러가 있을 때만 그려지고 1회 불린다", async () => {
    const onReanalyze = vi.fn();
    const onRefresh = vi.fn();
    const failed = { ...FX01_VIEW, status: "FAILED" as const, errorCode: "ANALYSIS_TIMEOUT" };
    render(
      <AnalysisBanner
        analysis={failed}
        bidStatus="OPEN"
        delayed
        onReanalyze={onReanalyze}
        onRefresh={onRefresh}
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "재분석" }));
    await userEvent.click(page.getByRole("button", { name: "새로고침" }));
    expect(onReanalyze).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    const bare = render(<AnalysisBanner analysis={failed} bidStatus="OPEN" delayed />);
    expect(bare.querySelectorAll("button")).toHaveLength(0);
  });

  it("PARTIAL 은 09 고정 문장과 코드를 role=status 안에 보인다", () => {
    const host = render(<AnalysisBanner analysis={FX01_PARTIAL_VIEW} bidStatus="OPEN" />);
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)",
    );
    expect(status?.textContent).toContain("AI_UNAVAILABLE");
    expect(status?.textContent).toContain("RULES_ONLY");
  });

  it("늦은 마감 실패(ANALYSIS_RUN_SUPERSEDED)는 일반 실패 문장과 코드 글꼴의 코드를 보인다", () => {
    const host = render(
      <AnalysisBanner
        analysis={{ ...FX01_VIEW, status: "FAILED", errorCode: "ANALYSIS_RUN_SUPERSEDED" }}
        bidStatus="OPEN"
      />,
    );
    expect(text(host)).toContain("분석에 실패했습니다.");
    const code = Array.from(host.querySelectorAll(".font-mono span")).find(
      (el) => el.textContent === "ANALYSIS_RUN_SUPERSEDED",
    );
    expect(code).toBeDefined();
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
