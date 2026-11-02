import type { AwardReference, Quartiles } from "@/server/award-reference";
import {
  AWARD_CARD_SUBTITLE,
  AWARD_CARD_TITLE,
  AWARD_DISCLAIMER,
  AWARD_RANGE_NOTE,
  AWARD_TOO_FEW,
  BASE_LABEL,
  barAxisOf,
  basisLine,
  formatEokMan,
  formatRatioPercent,
  medianParts,
  priceTermLine,
  sourceLine,
} from "./award-reference-copy";

// 공고 상세의 참고 낙찰가 범위 카드(스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md §2 A안).
// 지난 낙찰률의 가운데 절반을 이번 공고 기준금액에 곱한 금액으로 보여 준다. 카드를 그릴지는 서버가 정한다(null 이면 부르지 않는다).

type RangeReference = Extract<AwardReference, { kind: "RANGE" }>;

const TITLE_ID = "award-reference-title";

export function AwardReferenceCard({ reference }: { reference: AwardReference }) {
  const priceTerm = priceTermLine(reference);
  return (
    <section
      aria-labelledby={TITLE_ID}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={TITLE_ID} className="type-heading text-foreground">
          {AWARD_CARD_TITLE}
          <span className="type-label text-muted-foreground"> · {AWARD_CARD_SUBTITLE}</span>
        </h2>
        <p className="type-caption tabular-nums text-muted-foreground">
          {sourceLine(reference.dataAsOf)}
        </p>
      </div>
      {reference.kind === "RANGE" ? (
        <RangeBody reference={reference} />
      ) : (
        <p className="type-body text-foreground">{AWARD_TOO_FEW}</p>
      )}
      <p className="type-label tabular-nums text-muted-foreground">{basisLine(reference)}</p>
      {priceTerm !== null && <p className="type-body text-foreground">{priceTerm}</p>}
      {reference.kind === "RANGE" && (
        <p className="type-caption text-muted-foreground">{AWARD_DISCLAIMER}</p>
      )}
    </section>
  );
}

function RangeBody({ reference }: { reference: RangeReference }) {
  const { amountKrw } = reference;
  const median = medianParts(reference);
  return (
    <div className="flex flex-col gap-2">
      {/* 좁은 화면에서는 "~" 뒤에서만 줄을 바꾼다. 금액 한 덩어리가 중간에서 갈라지지 않게 한다. */}
      <p className="type-title tabular-nums text-foreground" data-slot="award-range">
        <span className="whitespace-nowrap">{formatEokMan(amountKrw.q1)} ~</span>{" "}
        <span className="whitespace-nowrap">{formatEokMan(amountKrw.q3)} 원</span>
      </p>
      <p className="type-body tabular-nums text-foreground">
        {AWARD_RANGE_NOTE} · <span className="whitespace-nowrap">{median.amount}</span>{" "}
        <span className="whitespace-nowrap">{median.share}</span>
      </p>
      <RangeBar ratio={reference.ratio} baseLabel={BASE_LABEL[reference.base.kind]} />
    </div>
  );
}

// 차트 라이브러리 없이 그린 막대 하나. 가운데 절반 띠와 중간값 선만 둔다(스펙 §2).
function RangeBar({ ratio, baseLabel }: { ratio: Quartiles; baseLabel: string }) {
  const axis = barAxisOf(ratio);
  const at = (value: number) =>
    Math.min(100, Math.max(0, ((value - axis.min) / (axis.max - axis.min)) * 100));
  const left = at(ratio.q1);
  const right = at(ratio.q3);
  const label =
    `${baseLabel} 대비 낙찰률 가운데 절반 ${formatRatioPercent(ratio.q1)}~${formatRatioPercent(ratio.q3)}, ` +
    `중간값 ${formatRatioPercent(ratio.median)}`;
  return (
    <div className="flex flex-col gap-1 pt-1">
      <div role="img" aria-label={label} className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-brand/25"
          style={{ left: `${left}%`, width: `${right - left}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand"
          style={{ left: `${at(ratio.median)}%` }}
        />
      </div>
      <div aria-hidden className="relative h-4 type-caption tabular-nums text-muted-foreground">
        <span className="absolute left-0">{formatRatioPercent(axis.min)}</span>
        <span className="absolute left-1/2 -translate-x-1/2">
          {formatRatioPercent((axis.min + axis.max) / 2)}
        </span>
        <span className="absolute right-0">{formatRatioPercent(axis.max)}</span>
      </div>
    </div>
  );
}
