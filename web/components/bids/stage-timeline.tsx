import Link from "next/link";
import { cn } from "cn";
import { STAGE_LABEL } from "@/components/bids/labels";
import type { BidStage } from "@/server/bids";

// 단계 이력 한 줄(§5.4.3). 지금 단계는 채운 원, 나머지는 빈 원. 누를 수 있는 것은 없다.
type StageTimelineProps = {
  stage: BidStage;
  stageLinks: { planRef: string | null; preSpecRef: string | null };
  latestRevision: number;
  revisionsHref?: string | null;
};

const STEPS = [
  "PLAN",
  "PROCUREMENT_REQUEST",
  "PRE_SPEC",
  "NOTICE",
  "OPENING",
  "AWARD",
  "CONTRACT",
] as const satisfies readonly BidStage[];

function StageTimeline({
  stage,
  stageLinks,
  latestRevision,
  revisionsHref = null,
}: StageTimelineProps) {
  const refs: Record<BidStage, string | null> = {
    PLAN: stageLinks.planRef,
    PROCUREMENT_REQUEST: null,
    PRE_SPEC: stageLinks.preSpecRef,
    NOTICE: null,
    OPENING: null,
    AWARD: null,
    CONTRACT: null,
  };
  return (
    <ol
      aria-label="단계 이력"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 type-label text-foreground"
    >
      {STEPS.filter((step) => ["PLAN", "PRE_SPEC", "NOTICE"].includes(step) || step === stage).map(
        (step) => {
          const current = step === stage;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full border",
                  current ? "border-foreground bg-foreground" : "border-muted-foreground",
                )}
              />
              <span className={cn(!current && "text-muted-foreground")}>{STAGE_LABEL[step]}</span>
              <span className="min-w-0 wrap-anywhere tabular-nums text-muted-foreground">
                {current && revisionsHref !== null ? (
                  <Link
                    href={revisionsHref}
                    aria-label={`현재 r${latestRevision}, 변경 이력 보기`}
                    className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    r{latestRevision}
                  </Link>
                ) : current ? (
                  `r${latestRevision}`
                ) : (
                  (refs[step] ?? "—")
                )}
              </span>
            </li>
          );
        },
      )}
    </ol>
  );
}

export { StageTimeline };
