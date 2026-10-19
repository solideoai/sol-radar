import { useId } from "react";
import { cn } from "cn";
import { fitOutOfFive, formatPercent, formatSignal } from "@/components/bids/format";
import { KEV_RISK_LABEL, RECOMMENDATION_LABEL } from "@/components/bids/labels";
import { MeterBar } from "@/components/bids/meter-bar";
import { StatusBadge } from "@/components/bids/status-badge";
import type { KevView, Recommendation, RequirementAssessmentView, ReviewFlag } from "@/server/bids";

// Kev 참고 지표(§5.4.7). 점수에 더하지 않는 보조 신호라 구역 테두리에 색을 더하지 않는다.
// 고지 3줄은 09 고정이고 셋째 줄만 {kev.model}·{kev.questionSetVersion}·{kev.provider} 로 바뀐다.
type KevOpinionProps = {
  kev: KevView;
  reviewFlags: ReviewFlag[];
  recommendation: Recommendation | null;
  ruleReason: string | null;
  errorCode: string | null;
  // 항목 라벨은 화면이 extraction 의 itemId 경로로 풀어 넘긴다. 부품은 경로 조회를 하지 않는다.
  assessments?: { assessment: RequirementAssessmentView; label: string }[];
};

const SIGNAL_THRESHOLD = 0.7;
const OPTIONS = ["BID", "WATCH", "NO_BID"] as const satisfies readonly Recommendation[];

// 받침 없음 또는 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로".
function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  if (last < 0 || last > 11171) return `${word}로`;
  const jong = last % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

function Fallback({
  children,
  errorCode,
}: {
  children: React.ReactNode;
  errorCode: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-body text-foreground">{children}</p>
      {errorCode !== null && (
        <p className="font-mono type-caption text-muted-foreground">{errorCode}</p>
      )}
    </div>
  );
}

function Signal({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const over = value >= threshold;
  return (
    <p className={cn("type-label tabular-nums", over ? "text-warning" : "text-foreground")}>
      {label} {formatSignal(value)}
      <span className="text-muted-foreground"> · 기준 {formatSignal(threshold)} 이상</span>
    </p>
  );
}

function Body({ kev, reviewFlags, recommendation, ruleReason, assessments }: KevOpinionProps) {
  const probabilities = kev.probabilities;
  const suggested = kev.suggestedOption;
  const disagree =
    reviewFlags.includes("MODEL_RULE_DISAGREEMENT") ||
    (suggested !== null && recommendation !== null && suggested !== recommendation);
  const threshold = kev.calibration?.threshold ?? SIGNAL_THRESHOLD;
  return (
    <div className="flex flex-col gap-3">
      {probabilities !== null && (
        <div className="flex flex-col gap-2">
          <h3 className="type-label text-foreground">
            모델 선택지 신뢰 분포 (충족·수주 확률 아님)
          </h3>
          <ul className="flex flex-col gap-1.5">
            {OPTIONS.map((option) => {
              const p = probabilities[option] ?? 0;
              return (
                <li
                  key={option}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-3"
                >
                  <span className="type-label text-foreground">{RECOMMENDATION_LABEL[option]}</span>
                  <MeterBar
                    value={p}
                    max={1}
                    label={`${RECOMMENDATION_LABEL[option]} 선택지`}
                    valueText={`${RECOMMENDATION_LABEL[option]} 선택지 ${formatPercent(p)}`}
                    tone="muted"
                  />
                  <span className="text-right type-label tabular-nums text-foreground">
                    {formatPercent(p)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {suggested !== null && (
        <div className="flex flex-col gap-1">
          <p className="type-label text-foreground">
            Kev 선택지: {RECOMMENDATION_LABEL[suggested]}
          </p>
          {disagree ? (
            <>
              <span className="self-start">
                <StatusBadge kind="flag" value="MODEL_RULE_DISAGREEMENT" />
              </span>
              <p className="type-label text-foreground">
                Kev는 {RECOMMENDATION_LABEL[suggested]}를 제시했지만{" "}
                {withRo(ruleReason ?? "규칙 결과")} 규칙 판정이 우선합니다
              </p>
            </>
          ) : (
            recommendation !== null && (
              <p className="type-label text-muted-foreground">규칙 권고와 같음</p>
            )
          )}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {kev.mandatoryRisk !== null && (
          <Signal label="필수자격 위험 신호" value={kev.mandatoryRisk} threshold={threshold} />
        )}
        {kev.needsHumanReview !== null && (
          <Signal label="사람 검토 필요 신호" value={kev.needsHumanReview} threshold={threshold} />
        )}
        {kev.fit !== null && (
          <p className="type-label tabular-nums text-foreground">
            적합도 의견 {fitOutOfFive(kev.fit.score)}/5
          </p>
        )}
      </div>
      <V02 kev={kev} assessments={assessments} />
      <div className="flex flex-col gap-0.5 type-caption text-muted-foreground">
        <p>이 의견은 Kev 모델이 BID / WATCH / NO-BID 선택지에 매긴 확률 분포입니다.</p>
        <p>충족 확률·낙찰 확률이 아니며, 규칙 기반 자격 판정과 SOL Score를 뒤집지 않습니다.</p>
        <p className="wrap-anywhere">
          최종 결정은 담당자가 기록합니다. 모델: {kev.model ?? "—"} · 질문 세트:{" "}
          {kev.questionSetVersion ?? "—"} · 공급자: {kev.provider ?? "—"}
        </p>
        <p>{kev.disclaimer}</p>
      </div>
    </div>
  );
}

// v0.2 필드(scores·risks·calibration)가 null 이 아니면 더 그린다.
const DISTRIBUTION_LABEL = [
  ["SATISFIED", "충족"],
  ["NOT_SATISFIED", "미충족"],
  ["NEEDS_REVIEW", "확인 필요"],
] as const;

function AssessmentTable({
  assessments,
}: {
  assessments: NonNullable<KevOpinionProps["assessments"]>;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer rounded-sm type-label text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        항목별 분포 {assessments.length}건 <span aria-hidden="true">▾</span>
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-0 text-left type-caption">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">
                항목
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                규칙 판정
              </th>
              <th scope="col" className="py-1 font-normal">
                Kev 분포
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assessments.map(({ assessment, label }) => (
              <tr key={assessment.itemId} className="align-top">
                <td className="py-2 pr-3 text-foreground wrap-anywhere">{label}</td>
                <td className="py-2 pr-3">
                  <StatusBadge
                    kind="qualification"
                    value={assessment.ruleStatus}
                    reasonCode={assessment.ruleReason}
                    variant="inline"
                  />
                </td>
                <td className="py-2 tabular-nums text-foreground">
                  {assessment.kev === null
                    ? "—"
                    : DISTRIBUTION_LABEL.map(
                        ([key, name]) =>
                          `${name} ${formatPercent(assessment.kev?.distribution[key] ?? 0)}`,
                      ).join(" · ")}
                  {assessment.flags.includes("KEV_REQUIREMENT_DISAGREEMENT") && (
                    <span className="ml-2 text-warning">항목 판정 상이</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function V02({ kev, assessments }: { kev: KevView; assessments?: KevOpinionProps["assessments"] }) {
  const { calibration, scores, risks } = kev;
  const showAssessments =
    kev.questionSetVersion === "kev-qs/v0.2" && assessments !== undefined && assessments.length > 0;
  if (calibration === null && scores === null && risks === null && !showAssessments) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {calibration !== null && (
        <span className="self-start rounded-sm border border-border px-1.5 type-caption text-muted-foreground">
          {calibration.status === "CALIBRATED"
            ? `보정됨 · ${calibration.datasetVersion ?? "—"}`
            : `미보정 · 기준 τ ${formatSignal(calibration.threshold)}`}
        </span>
      )}
      {scores !== null && (
        <div className="flex flex-col gap-0.5">
          <p className="type-label tabular-nums text-foreground">
            기술 적합 의견 {fitOutOfFive(scores.techFit.score)}/5
          </p>
          <p className="type-label tabular-nums text-foreground">
            실적 연관 의견 {fitOutOfFive(scores.perfRelevance.score)}/5
          </p>
          <p className="type-caption text-muted-foreground">SOL Score에 더하지 않음</p>
        </div>
      )}
      {risks !== null && (
        <div className="flex flex-col gap-2">
          <h3 className="type-label text-foreground">수행 리스크</h3>
          <ul className="flex flex-col gap-1.5">
            {risks.map((risk) => (
              <li
                key={risk.qid}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3"
              >
                <span className="type-label text-foreground">{KEV_RISK_LABEL[risk.qid]}</span>
                <MeterBar
                  value={risk.probability}
                  max={1}
                  label={`${KEV_RISK_LABEL[risk.qid]} 리스크`}
                  valueText={`${KEV_RISK_LABEL[risk.qid]} 리스크 ${formatSignal(risk.probability)}`}
                  tone="muted"
                />
                <span className="flex items-center gap-2 text-right type-label tabular-nums text-foreground">
                  {formatSignal(risk.probability)}
                  {risk.overThreshold && <span className="text-warning">기준 이상</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showAssessments && <AssessmentTable assessments={assessments} />}
    </div>
  );
}

function KevOpinion(props: KevOpinionProps) {
  const { kev, reviewFlags, errorCode } = props;
  const headingId = useId();
  const unavailableFlag = reviewFlags.includes("AI_UNAVAILABLE");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 id={headingId} className="type-heading text-foreground">
          Kev 참고 지표
        </h2>
        <p className="type-caption text-muted-foreground">모델 참고 지표 (점수 미반영)</p>
      </div>
      {kev.enabled ? (
        <Body {...props} />
      ) : unavailableFlag ? (
        <Fallback errorCode={errorCode}>사용 불가</Fallback>
      ) : reviewFlags.includes("KEV_UNAVAILABLE") ? (
        <div className="flex flex-col gap-1">
          <p className="type-body text-foreground">사용 불가 (Kev 서버 미접속)</p>
          <p className="font-mono type-caption text-muted-foreground">
            recommendationBasis: RULES_ONLY
          </p>
          <p className="type-label text-muted-foreground">Kev 없이 규칙만으로 판정했습니다.</p>
        </div>
      ) : (
        <Fallback errorCode={null}>사용 안 함</Fallback>
      )}
    </section>
  );
}

export { KevOpinion };
