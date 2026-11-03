import { useId } from "react";
import { formatPercent, formatSignal } from "@/components/bids/format";
import { KEV_RISK_LABEL, RECOMMENDATION_LABEL } from "@/components/bids/labels";
import { MeterBar } from "@/components/bids/meter-bar";
import { StatusBadge } from "@/components/bids/status-badge";
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
// 확률이 아니라는 고지는 분포 제목 "(충족·수주 확률 아님)" 한 곳이다(09 고정. 겹치던 고지 줄 넷은 2026-11-03 사용자 지시로 지웠다, ADR-081).
// 신호 값·기준값·적합도 의견·보정 상태 같은 내부 숫자는 보이지 않고, 신호가 기준 이상일 때만 문장 한 줄을 보인다. 값은 분석 기록에 남는다.
// 모델명·질문 세트·공급자도 화면에 두지 않는다(ADR-080).
// provider 가 mock 이면 실제 모델처럼 보이면 안 되므로(ADR-034 15번) "Mock 응답(데모 데이터)"를 밝힌다.
// 공고 상세의 분석 요약 띠가 같은 글자를 이미 보이면(mockShownAbove) 여기서 되풀이하지 않는다.
// 식별자(KevView·kev 필드·KEV_* 플래그·파일명)는 API·DB 호환 레이어라 바꾸지 않는다.
type KevOpinionProps = {
  kev: KevView;
  reviewFlags: ReviewFlag[];
  recommendation: Recommendation | null;
  ruleReason: string | null;
  // 항목 라벨은 화면이 extraction 의 itemId 경로로 풀어 넘긴다. 부품은 경로 조회를 하지 않는다.
  assessments?: { assessment: RequirementAssessmentView; label: string }[];
  // 결정 모델을 썼는데 저장된 결과가 없는 run(kevRecordMissing). 꺼진 것과 구분해 "기록 없음"이라고 쓴다.
  notRecorded?: boolean;
  // 분석 요약 띠가 이 run 의 "Mock 응답(데모 데이터)"를 이미 보이는지.
  mockShownAbove?: boolean;
};

const SIGNAL_THRESHOLD = 0.7;
const OPTIONS = ["BID", "WATCH", "NO_BID"] as const satisfies readonly Recommendation[];
const MOCK_MODEL_TEXT = "Mock 응답(데모 데이터)";

// 받침 없음 또는 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로".
function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  if (last < 0 || last > 11171) return `${word}로`;
  const jong = last % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

// 결정 모델을 쓰지 못한 run 의 상태 한 줄. 오류 코드는 공고 상세의 분석 배너 "오류 상세"가 보인다.
function Fallback({ children }: { children: React.ReactNode }) {
  return <p className="type-body text-foreground">{children}</p>;
}

function Body({
  kev,
  reviewFlags,
  recommendation,
  ruleReason,
  assessments,
  mockShownAbove = false,
}: KevOpinionProps) {
  const probabilities = kev.probabilities;
  const suggested = kev.suggestedOption;
  const disagree =
    reviewFlags.includes("MODEL_RULE_DISAGREEMENT") ||
    (suggested !== null && recommendation !== null && suggested !== recommendation);
  const threshold = kev.calibration?.threshold ?? SIGNAL_THRESHOLD;
  const mandatoryOver = kev.mandatoryRisk !== null && kev.mandatoryRisk >= threshold;
  const reviewOver = kev.needsHumanReview !== null && kev.needsHumanReview >= threshold;
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
      {(mandatoryOver || reviewOver) && (
        <div className="flex flex-col gap-0.5 type-label text-warning">
          {mandatoryOver && <p>필수자격 위험 신호가 기준 이상입니다</p>}
          {reviewOver && <p>사람 검토가 필요하다는 신호가 기준 이상입니다</p>}
        </div>
      )}
      <V02 kev={kev} assessments={assessments} />
      {kev.provider === "mock" && !mockShownAbove && (
        <p className="type-caption text-muted-foreground">{MOCK_MODEL_TEXT}</p>
      )}
    </div>
  );
}

// v0.2 필드 중 수행 리스크와 항목별 분포만 더 그린다. 적합 의견(n/5)·보정 상태는 내부 값이라 보이지 않는다(ADR-081).
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
  const { risks } = kev;
  const showAssessments =
    kev.questionSetVersion === "kev-qs/v0.2" && assessments !== undefined && assessments.length > 0;
  if (risks === null && !showAssessments) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
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
  const { kev, reviewFlags, notRecorded = false } = props;
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
        <Fallback>사용 불가</Fallback>
      ) : reviewFlags.includes("KEV_UNAVAILABLE") ? (
        <div className="flex flex-col gap-1">
          {/* KEV_UNAVAILABLE 은 미접속과 응답 형식 오류를 함께 뜻한다(ADR-031 C6·ADR-032 D9).
              상태 줄은 "사용 불가" 하나로 두고, 사유는 그 아래 문장으로 쓴다(e8 Ruling 11). */}
          <p className="type-body text-foreground">사용 불가</p>
          <p className="type-label text-muted-foreground">
            결정 모델 응답을 받지 못했거나 응답을 쓸 수 없습니다.
          </p>
          <p className="type-label text-muted-foreground">
            결정 모델 없이 규칙만으로 판정했습니다.
          </p>
        </div>
      ) : notRecorded ? (
        <Fallback>기록 없음</Fallback>
      ) : (
        <Fallback>사용 안 함</Fallback>
      )}
    </section>
  );
}

export { KevOpinion, MOCK_MODEL_TEXT };
