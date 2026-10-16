import { cn } from "cn";
import { BellRingIcon, MessageSquareTextIcon, SearchIcon, UserCheckIcon } from "lucide-react";
import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { formatDate } from "@/components/landing/format";
import { QualificationLabel } from "@/components/landing/status-badges";

// 주요 기능 카드 아래의 작은 제품 그림. 화면 낭독기에서 숨기고(aria-hidden) 초점을 막는다(inert) — 쓰는 쪽이 감싼다.
// 숫자와 공고는 미리보기와 같은 예시 데이터(demo-bids.ts)에서 가져온다. 따로 적으면 미리보기와 어긋난다.

const STAGES = ["발주계획", "사전규격", "입찰공고"];
const [FEATURED] = DEMO_BIDS;

export function CollectPreview() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 type-label text-muted-foreground">
          <SearchIcon className="size-3.5" />
          공고명·기관 검색
        </div>
        {STAGES.map((stage) => (
          <span
            key={stage}
            className={cn(
              "rounded-md border bg-background px-2 py-1 type-caption",
              stage === "입찰공고"
                ? "border-brand/40 text-brand"
                : "border-border text-muted-foreground",
            )}
          >
            {stage}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {DEMO_BIDS.map((bid) => (
          <li key={bid.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate type-label font-medium text-foreground">
                {bid.title}
              </span>
              <span className="type-caption text-muted-foreground">{bid.agency}</span>
            </span>
            <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
              마감 {formatDate(bid.proposalDue)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 세 상태를 한 번씩 보여 준다. 예시 공고의 자격 항목에서 상태마다 첫 항목을 고른다.
const SAMPLE_CHECKS = (["SATISFIED", "NEEDS_REVIEW", "NOT_SATISFIED"] as const)
  .map((status) => DEMO_BIDS.flatMap((bid) => bid.checks).find((check) => check.status === status))
  .filter((check) => check !== undefined);

export function QualifyPreview() {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-background">
      {SAMPLE_CHECKS.map((check) => (
        <li
          key={check.requirement}
          className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3 px-3 py-2.5"
        >
          <QualificationLabel status={check.status} />
          <span>
            <span className="block type-label font-medium text-foreground">
              {check.requirement}
            </span>
            <span className="type-caption text-muted-foreground">{check.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScorePreview() {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate type-label font-medium text-foreground">{FEATURED.title}</span>
        <span className="shrink-0 type-heading text-foreground tabular-nums">
          {FEATURED.score}
          <span className="ml-1 type-caption font-normal text-muted-foreground">/ 100</span>
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {FEATURED.factors.map((factor) => (
          <li
            key={factor.label}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3 type-caption"
          >
            <span className="text-muted-foreground">{factor.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${(factor.points / factor.max) * 100}%` }}
              />
            </span>
            <span className="text-right text-foreground tabular-nums">
              {factor.points}/{factor.max}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 type-caption text-muted-foreground">적합도 지표 · 수주 확률 아님</p>
    </div>
  );
}

// 대표 예시(WATCH)의 이력이다. 사람이 아직 결정하지 않았다는 것까지 보여 준다.
const EVENTS = [
  {
    icon: BellRingIcon,
    kind: "변경 알림",
    text: "첨부문서 1건이 추가되었습니다.",
    time: "10. 16. 09:12",
  },
  {
    icon: MessageSquareTextIcon,
    kind: "검토 의견",
    text: "필수 증빙의 유효기간을 발급기관에 확인하고 있습니다.",
    time: "10. 16. 14:20",
  },
  { icon: UserCheckIcon, kind: "참여 결정", text: "권고 WATCH · 담당자 결정 전", time: "대기" },
];

export function HistoryPreview() {
  return (
    <div className="rounded-lg border border-border bg-background">
      <p className="truncate border-b border-border px-4 py-2.5 type-label font-medium text-foreground">
        {FEATURED.title}
      </p>
      <ol className="flex flex-col gap-3 px-4 py-3">
        {EVENTS.map((event) => (
          <li key={event.kind} className="flex items-start gap-3">
            <event.icon className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block type-caption font-medium text-foreground">{event.kind}</span>
              <span className="type-caption text-muted-foreground">{event.text}</span>
            </span>
            <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
              {event.time}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
