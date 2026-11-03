import { useId } from "react";
import { cn } from "cn";
import { fitOutOfFive, formatPercent, formatSignal } from "@/components/bids/format";
import { KEV_RISK_LABEL, RECOMMENDATION_LABEL } from "@/components/bids/labels";
import { MeterBar } from "@/components/bids/meter-bar";
import { StatusBadge } from "@/components/bids/status-badge";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KevView, Recommendation, RequirementAssessmentView, ReviewFlag } from "@/server/bids";
import { recommendationWithObject } from "@/server/shared";

// 결정 모델 참고 지표(§5.4.7, ADR-034 로 "Kev" 문구를 모델 중립으로 개정). 점수에 더하지 않는 보조 신호라 구역 테두리에 색을 더하지 않는다.
// 고지 3줄은 09 고정이고 셋째 줄만 {kev.model}·{kev.questionSetVersion}·{kev.provider} 로 바뀐다.
// provider 가 mock 이면 실제 모델처럼 보이면 안 되므로(ADR-034 15번) 모델명 대신 "Mock 응답(데모 데이터)" 를 쓴다.
// 식별자(KevView·kev 필드·KEV_* 플래그·파일명)는 API·DB 호환 레이어라 바꾸지 않는다.
type KevOpinionProps = {
  kev: KevView;
  reviewFlags: ReviewFlag[];
  recommendation: Recommendation | null;
  ruleReason: string | null;
  errorCode: string | null;
  // 항목 라벨은 화면이 extraction 의 itemId 경로로 풀어 넘긴다. 부품은 경로 조회를 하지 않는다.
  assessments?: { assessment: RequirementAssessmentView; label: string }[];
  // 결정 모델을 썼는데 저장된 결과가 없는 run(kevRecordMissing). 꺼진 것과 구분해 "기록 없음"이라고 쓴다.
  notRecorded?: boolean;
};

const SIGNAL_THRESHOLD = 0.7;
const OPTIONS = ["BID", "WATCH", "NO_BID"] as const satisfies readonly Recommendation[];
const MOCK_MODEL_TEXT = "Mock 응답(데모 데이터)";

// 고지 셋째 줄의 모델 정보. mock 은 모델명을 쓰지 않고, 실모델은 받은 식별자(레지스트리 run 값)를 그대로 보인다.
function modelInfoText(kev: Pick<KevView, "provider" | "model" | "questionSetVersion">): string {
  const modelPart = kev.provider === "mock" ? MOCK_MODEL_TEXT : `모델: ${kev.model ?? "—"}`;
  return `${modelPart} · 질문 세트: ${kev.questionSetVersion ?? "—"} · 공급자: ${kev.provider ?? "—"}`;
}

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
            결정 모델 선택지: {RECOMMENDATION_LABEL[suggested]}
          </p>
          {/* 의견이 다를 때 "규칙 우선(결정 모델 의견 상이)" 배지는 두지 않고 문장만 보인다(2026-11-03 사용자 결정). */}
          {disagree ? (
            <p className="type-label text-foreground">
              결정 모델은 {recommendationWithObject(suggested)} 제시했지만{" "}
              {withRo(ruleReason ?? "규칙 결과")} 규칙 판정이 우선합니다
            </p>
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
        <p>
          이 의견은 결정 모델이 {OPTIONS.map((option) => RECOMMENDATION_LABEL[option]).join(" / ")}{" "}
          선택지에 매긴 확률 분포입니다.
        </p>
        <p>충족 확률·낙찰 확률이 아니며, 규칙 기반 자격 판정과 SOL Score를 뒤집지 않습니다.</p>
        <p>최종 결정은 담당자가 기록합니다.</p>
        {kev.provider === "mock" && <p>{MOCK_MODEL_TEXT}</p>}
        <details>
          <summary className="w-fit min-h-8 cursor-pointer content-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            모델 상세 정보
          </summary>
          <p className="mt-2 wrap-anywhere">{modelInfoText(kev)}</p>
        </details>
        <p>{"결정 모델 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다."}</p>
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
      {/* 기본 펼침 표시(▶)를 숨기고 ▾ 하나만 둔다. 펼치면 뒤집는다. */}
      <summary className="w-fit cursor-pointer list-none rounded-sm type-label text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        항목별 분포 {assessments.length}건{" "}
        <span aria-hidden="true" className="inline-block group-open:rotate-180">
          ▾
        </span>
      </summary>
      <Table containerClassName="mt-2">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">항목</TableHead>
            <TableHead scope="col">규칙 판정</TableHead>
            <TableHead scope="col">결정 모델 분포</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assessments.map(({ assessment, label }) => (
            <TableRow key={assessment.itemId}>
              <TableCell className="align-top whitespace-normal wrap-anywhere">{label}</TableCell>
              <TableCell className="align-top">
                <StatusBadge
                  kind="qualification"
                  value={assessment.ruleStatus}
                  reasonCode={assessment.ruleReason}
                  variant="inline"
                />
              </TableCell>
              <TableCell className="align-top whitespace-normal tabular-nums">
                {assessment.kev === null
                  ? "—"
                  : DISTRIBUTION_LABEL.map(
                      ([key, name]) =>
                        `${name} ${formatPercent(assessment.kev?.distribution[key] ?? 0)}`,
                    ).join(" · ")}
                {assessment.flags.includes("KEV_REQUIREMENT_DISAGREEMENT") && (
                  <span className="ml-2 text-warning">항목 판정 상이</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
        <Chip size="sm" className="self-start">
          {calibration.status === "CALIBRATED"
            ? `보정됨 · ${calibration.datasetVersion ?? "—"}`
            : `미보정 · 기준 τ ${formatSignal(calibration.threshold)}`}
        </Chip>
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
  const { kev, reviewFlags, errorCode, notRecorded = false } = props;
  const headingId = useId();
  const unavailableFlag = reviewFlags.includes("AI_UNAVAILABLE");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 id={headingId} className="type-heading text-foreground">
          결정 모델 참고 지표
        </h2>
        <p className="type-caption text-muted-foreground">모델 참고 지표 (점수 미반영)</p>
      </div>
      {kev.enabled ? (
        <Body {...props} />
      ) : unavailableFlag ? (
        <Fallback errorCode={errorCode}>사용 불가</Fallback>
      ) : reviewFlags.includes("KEV_UNAVAILABLE") ? (
        <div className="flex flex-col gap-1">
          {/* KEV_UNAVAILABLE 은 미접속과 응답 형식 오류를 함께 뜻한다(ADR-031 C6·ADR-032 D9).
              상태 줄은 "사용 불가" 하나로 두고, 사유는 그 아래 문장으로 쓴다(e8 Ruling 11). */}
          <p className="type-body text-foreground">사용 불가</p>
          <p className="type-label text-muted-foreground">
            결정 모델 응답을 받지 못했거나 응답을 쓸 수 없습니다.
          </p>
          <p className="font-mono type-caption text-muted-foreground">
            recommendationBasis: RULES_ONLY
          </p>
          <p className="type-label text-muted-foreground">
            결정 모델 없이 규칙만으로 판정했습니다.
          </p>
        </div>
      ) : notRecorded ? (
        <Fallback errorCode={null}>기록 없음</Fallback>
      ) : (
        <Fallback errorCode={null}>사용 안 함</Fallback>
      )}
    </section>
  );
}

export { KevOpinion, MOCK_MODEL_TEXT };
