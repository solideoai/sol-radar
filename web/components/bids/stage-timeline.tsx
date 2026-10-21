import Link from "next/link";
import { cn } from "cn";
import { STAGE_LABEL } from "@/components/bids/labels";
import type { BidStage } from "@/server/bids";

// 단계 이력 한 줄(§5.4.3). 지금 단계는 채운 원, 나머지는 빈 원. 누를 수 있는 것은 지금 단계의 r{N}(변경 이력) 하나뿐이다.
type StageTimelineProps = {
  stage: BidStage;
  stageLinks: { planRef: string | null; preSpecRef: string | null };
  latestRevision: number;
  // 변경 이력 화면 주소. revision 이 둘 이상일 때만 넘기고, 없으면 r{N} 은 글자다.
  revisionsHref: string | null;
};

const STEPS = ["PLAN", "PRE_SPEC", "NOTICE"] as const satisfies readonly BidStage[];

function StageTimeline({ stage, stageLinks, latestRevision, revisionsHref }: StageTimelineProps) {
  const refs: Record<BidStage, string | null> = {
    PLAN: stageLinks.planRef,
    PRE_SPEC: stageLinks.preSpecRef,
    NOTICE: null,
  };
  return (
    <ol
      aria-label="단계 이력"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 type-label text-foreground"
    >
      {STEPS.map((step) => {
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
              {current ? (
                revisionsHref === null ? (
                  `r${latestRevision}`
                ) : (
                  <Link
                    href={revisionsHref}
                    className="rounded-sm underline decoration-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    r{latestRevision}
                    <span className="sr-only"> 변경 이력 보기</span>
                  </Link>
                )
              ) : (
                (refs[step] ?? "—")
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export { StageTimeline };
