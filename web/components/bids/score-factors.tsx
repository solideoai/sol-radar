"use client";

import { CircleHelpIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/components/bids/format";
import { FACTOR_LABEL, FACTOR_ORDER, MISSING_REASON_LABEL } from "@/components/bids/labels";
import { MeterBar } from "@/components/bids/meter-bar";
import { StatusBadge } from "@/components/bids/status-badge";
import type { EvidenceContext } from "@/components/bids/evidence-store";
import type { ReviewFlag, ScoreFactorView } from "@/server/bids";

// SOL Score 분해(§5.4.5). 요소 5행은 점수표 순서로 고정이다.
// 점수 계산 버전·프로필 버전과 "합계 … (반올림)" 줄은 화면에 두지 않는다(2026-11-03 사용자 지시, ADR-080·081). 점수는 결정 패널이 보인다.
type ScoreFactorsProps = {
  factors: ScoreFactorView[];
  reviewFlags: ReviewFlag[];
  explanation: string | null;
  reference?: boolean;
  onOpenEvidence?: (ctx: EvidenceContext) => void;
};

// 설명이 이 길이를 넘으면 4줄로 접고 펼치기를 둔다.
const EXPLANATION_FOLD_LENGTH = 100;

// 저장된 설명(server/scoring/explanation.ts)의 끝 문장. 결정 패널 고지와 같은 말이라 화면에서만 빼고 읽는다(ADR-081). 저장 값은 그대로다.
const CLOSING_SENTENCE = "최종 참여 결정은 사람이 합니다.";
const readableExplanation = (text: string): string =>
  text.endsWith(CLOSING_SENTENCE) ? text.slice(0, -CLOSING_SENTENCE.length).trimEnd() : text;

function FactorRow({
  factor,
  scaleLimitExceeded,
  onOpenEvidence,
}: {
  factor: ScoreFactorView;
  scaleLimitExceeded: boolean;
  onOpenEvidence?: (ctx: EvidenceContext) => void;
}) {
  const label = FACTOR_LABEL[factor.factor];
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3">
        <span className="type-label text-foreground wrap-anywhere">{label}</span>
        <MeterBar
          value={factor.points}
          max={factor.maxPoints}
          label={label}
          valueText={`${formatPoints(factor.points)}점 / ${factor.maxPoints}점${factor.missing ? " (미확인)" : ""}`}
          tone={factor.missing ? "missing" : "brand"}
        />
        <span className="text-right type-label tabular-nums text-foreground">
          {formatPoints(factor.points)} / {factor.maxPoints}
        </span>
      </div>
      {(factor.missing || scaleLimitExceeded || factor.note !== null || onOpenEvidence) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {factor.missing && (
            <>
              <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-muted-foreground">
                <CircleHelpIcon aria-hidden="true" className="size-3.5 shrink-0" />
                미확인
              </span>
              {/* 사유 열이 없던 때의 저장 행은 사유가 null 이다(판단 7). 지어내지 않고 기록이 없다고 쓴다. */}
              <span className="type-caption text-muted-foreground">
                {factor.missingReason === null
                  ? "사유 기록 없음"
                  : MISSING_REASON_LABEL[factor.missingReason]}
              </span>
            </>
          )}
          {scaleLimitExceeded && <StatusBadge kind="flag" value="SCALE_LIMIT_EXCEEDED" />}
          {factor.note !== null && (
            <span className="type-caption text-muted-foreground">{factor.note}</span>
          )}
          {onOpenEvidence !== undefined && factor.evidence.length > 0 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              onClick={() => onOpenEvidence({ title: label, evidence: factor.evidence })}
            >
              근거 {factor.evidence.length}건
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function ScoreFactors({
  factors,
  reviewFlags,
  explanation,
  reference = false,
  onOpenEvidence,
}: ScoreFactorsProps) {
  const headingId = useId();
  const explanationId = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = FACTOR_ORDER.flatMap((key) => factors.filter((f) => f.factor === key));
  const shownExplanation = explanation === null ? null : readableExplanation(explanation);
  const foldable = shownExplanation !== null && shownExplanation.length > EXPLANATION_FOLD_LENGTH;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <h2 id={headingId} className="type-heading text-foreground">
          SOL Score 분해
        </h2>
        {reference && (
          <span className="rounded-sm border border-border px-1.5 type-caption text-muted-foreground">
            참고 점수
          </span>
        )}
      </div>
      {reference && (
        <p className="type-label text-muted-foreground">
          필수자격 미충족으로 권고에 쓰지 않은 점수입니다
        </p>
      )}
      {shownExplanation !== null && (
        <div className="flex flex-col items-start gap-1">
          <p
            id={explanationId}
            className={`type-body text-foreground ${foldable && !expanded ? "line-clamp-4" : ""}`}
          >
            {shownExplanation}
          </p>
          {foldable && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              aria-expanded={expanded}
              aria-controls={explanationId}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "접기" : "펼치기"}
            </Button>
          )}
        </div>
      )}
      <ul className="divide-y divide-border">
        {rows.map((factor) => (
          <FactorRow
            key={factor.factor}
            factor={factor}
            scaleLimitExceeded={
              factor.factor === "scaleFit" && reviewFlags.includes("SCALE_LIMIT_EXCEEDED")
            }
            onOpenEvidence={onOpenEvidence}
          />
        ))}
      </ul>
    </section>
  );
}

export { ScoreFactors };
