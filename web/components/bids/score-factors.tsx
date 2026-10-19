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

// SOL Score 분해(§5.4.5). 요소 5행은 점수표 순서로 고정이고 합계는 받은 points 의 합이다.
type ScoreFactorsProps = {
  factors: ScoreFactorView[];
  reviewFlags: ReviewFlag[];
  explanation: string | null;
  algorithmVersion: string;
  profileRevision: number;
  reference?: boolean;
  onOpenEvidence?: (ctx: EvidenceContext) => void;
};

// 설명이 이 길이를 넘으면 4줄로 접고 펼치기를 둔다.
const EXPLANATION_FOLD_LENGTH = 100;

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
              {factor.missingReason !== null && (
                <span className="type-caption text-muted-foreground">
                  {MISSING_REASON_LABEL[factor.missingReason]}
                </span>
              )}
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
  algorithmVersion,
  profileRevision,
  reference = false,
  onOpenEvidence,
}: ScoreFactorsProps) {
  const headingId = useId();
  const explanationId = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = FACTOR_ORDER.flatMap((key) => factors.filter((f) => f.factor === key));
  const sum = rows.reduce((total, f) => total + f.points, 0);
  const foldable = explanation !== null && explanation.length > EXPLANATION_FOLD_LENGTH;
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
      {explanation !== null && (
        <div className="flex flex-col items-start gap-1">
          <p
            id={explanationId}
            className={`type-body text-foreground ${foldable && !expanded ? "line-clamp-4" : ""}`}
          >
            {explanation}
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
      <p className="type-caption text-muted-foreground">
        <span className="tabular-nums">
          합계 {formatPoints(sum)} → SOL Score {Math.round(sum)} (반올림)
        </span>
        {" · "}알고리즘 {algorithmVersion} · 프로필 rev {profileRevision}
      </p>
    </section>
  );
}

export { ScoreFactors };
