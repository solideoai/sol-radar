"use client";

import { Tabs } from "@base-ui/react/tabs";
import { cn } from "cn";
import { ClockIcon, TriangleAlertIcon } from "lucide-react";
import type { Shown } from "@/components/landing/analysis-demo-data";
import { DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import {
  DemoBadge,
  EvidenceQuote,
  QualificationLabel,
  RecommendationBadge,
} from "@/components/landing/status-badges";
import styles from "@/components/landing/work-demo.module.css";

// 랜딩의 시각적 중심. 실제 화면이 아니라 가상 데이터(demo-bids.ts)로 그린 분석 화면이다.
// 왼쪽 목록에서 공고를 고르면 오른쪽 분석이 바뀐다. 목록과 분석의 관계가 탭과 같아 Base UI Tabs(세로)로 만든다.
// 패널을 그리는 데 시간이 들지 않아 방향키로 옮기면 바로 고른다(activateOnFocus).
// 판은 3단이다(목록 · 공고와 자격 검토 · 점수와 결재란). 패널이 뒤의 두 단을 차지해 공고를 바꾸면 두 단이 함께 바뀐다.
// 고른 공고와 보이는 만큼은 자동 재생(analysis-demo.tsx)이 정한다(controlled). 사람이 고르면 onSelect 로 알린다.
// 판 본문 높이는 세 공고 중 가장 긴 것(631px, 1265·1280·1440px 에서 같다)에 맞춰 고정한다 — 공고가 바뀔 때 판이 흔들리지 않는다.
// 숨김은 투명도와 약간의 위치만 바꾼다. 글은 DOM 에 그대로 두어 화면 낭독기가 늘 다 읽는다.
type ProductPreviewProps = {
  value: DemoBid["id"];
  onSelect: (value: DemoBid["id"]) => void;
  shown: Shown;
  /** 가짜 커서가 올라가 있는 목록 줄(공고 id). 그 줄에 hover 바탕을 깐다. */
  pointing?: DemoBid["id"];
  pressed: boolean;
};

export function ProductPreview({ value, onSelect, shown, pointing, pressed }: ProductPreviewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-left">
      <PreviewBar />
      <Tabs.Root
        value={value}
        onValueChange={(next) => {
          const bid = DEMO_BIDS.find((candidate) => candidate.id === next);
          if (bid !== undefined) onSelect(bid.id);
        }}
        orientation="vertical"
        className="grid min-h-158 grid-cols-[260px_minmax(0,1fr)_288px]"
      >
        <div className="border-r border-border bg-muted/50 p-3">
          <p
            id="demo-list-title"
            className="px-2.5 pt-1 pb-2.5 type-label-lg text-muted-foreground"
          >
            예시 공고 {DEMO_BIDS.length}건
          </p>
          <Tabs.List
            activateOnFocus
            aria-labelledby="demo-list-title"
            className="flex flex-col gap-1"
          >
            {DEMO_BIDS.map((bid) => (
              <BidTab
                key={bid.id}
                bid={bid}
                pointed={bid.id === pointing}
                pressed={bid.id === pointing && pressed}
              />
            ))}
          </Tabs.List>
        </div>
        {DEMO_BIDS.map((bid) => (
          <Tabs.Panel
            key={bid.id}
            value={bid.id}
            className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_288px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BidReview bid={bid} shown={shown} />
            <DecisionRail bid={bid} shown={shown} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

// 나타나기: 아래에서 살짝 올라오며 보인다(업무 데모와 같은 움직임).
const REVEAL = "transition-[opacity,translate] duration-400 ease-out motion-reduce:transition-none";
const reveal = (on: boolean) =>
  cn(REVEAL, on ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0");

// 판 머리. 위 업무 데모의 머리 줄처럼 경로를 적고, 오른쪽에 분석 기준과 예시 표시를 둔다.
// 주소 칸·브라우저 창 흉내(창 점·큰 그림자)는 두지 않는다 — 실제 서비스 주소처럼 보이지 않게 한다. 판은 1px 선으로만 나눈다.
function PreviewBar() {
  return (
    <div className="flex h-12 items-center gap-3 border-b border-border px-5">
      <p className="type-label-lg text-muted-foreground">
        업무 / 입찰 공고 / <span className="font-semibold text-foreground">공고 분석</span>
      </p>
      <p className="ml-auto type-label-lg text-muted-foreground">분석 기준: 가상 기업 프로필</p>
      <span aria-hidden className="h-4 w-px bg-border" />
      <DemoBadge />
    </div>
  );
}

// 탭 안에는 글자 요소(span)만 둔다 — 버튼 안에 제목·블록 요소를 넣지 않는다.
// 가짜 커서가 올라간 줄은 마우스 hover 와 같은 바탕이고, 누르는 단계에서 살짝 눌린다.
// 커서는 줄의 제목 글자를 가리킨다(data-demo-target). 줄 가운데를 가리키면 꼬리표가 권고 배지를 가린다.
function BidTab({ bid, pointed, pressed }: { bid: DemoBid; pointed: boolean; pressed: boolean }) {
  return (
    <Tabs.Tab
      value={bid.id}
      className={cn(
        "group/tab flex w-full flex-col items-start gap-1 rounded-lg px-4 py-3.5 text-left outline-none hover:bg-background/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-active:bg-selected data-active:hover:bg-selected motion-safe:transition-[background-color,scale] motion-safe:duration-150",
        pointed && "bg-background/70",
        pressed && "scale-98",
      )}
    >
      {/* 고른 공고는 앱 사이드바와 같은 선택색이다: 연한 파랑 바탕 + 제목 파란 글자(2026-10-28 화면 개편). */}
      <span
        data-demo-target={bid.id}
        className="type-ui-lg font-semibold text-foreground group-data-active/tab:text-selected-foreground"
      >
        {bid.title}
      </span>
      <span className="type-label-lg text-muted-foreground">{bid.agency}</span>
      <span className="mt-1.5 flex items-center gap-2.5">
        <span className="type-label-lg whitespace-nowrap text-muted-foreground">
          SOL Score <span className="font-semibold text-foreground tabular-nums">{bid.score}</span>
        </span>
        <RecommendationBadge value={bid.recommendation} />
      </span>
    </Tabs.Tab>
  );
}

// 가운데 단. 공고 사실과 참가 자격 검토를 상자 없이 선으로만 나눈다 — 상자 안에 상자를 두지 않는다.
// 공고가 바뀌면 패널을 새로 그린다. 제목은 그때 한 번 떠오르고, 나머지는 shown 에 따라 차례로 나타난다.
function BidReview({ bid, shown }: { bid: DemoBid; shown: Shown }) {
  const [followUp] = bid.followUps;
  const allChecks = shown.checks >= bid.checks.length;
  return (
    <div className="min-w-0 px-6 pt-6 pb-7">
      <p className="type-label-lg text-muted-foreground">입찰공고</p>
      <h3
        id={`${bid.id}-title`}
        className="mt-3 type-heading-lg text-foreground motion-safe:animate-in motion-safe:duration-400 motion-safe:fade-in motion-safe:slide-in-from-bottom-1.5"
      >
        {bid.title}
      </h3>
      <dl className={cn("mt-4 grid grid-cols-3 gap-6", reveal(shown.facts))}>
        <Fact term="기관명" value={bid.agency} />
        <Fact term="사업 예산" value={formatWon(bid.budgetWon)} />
        <Fact term="제안서 마감" value={formatDate(bid.proposalDue)} />
      </dl>
      <QualificationList bid={bid} shown={shown} />
      {followUp !== undefined && (
        <p
          className={cn(
            "mt-4 flex items-center gap-2.5 type-ui-lg text-foreground",
            reveal(allChecks),
          )}
        >
          <TriangleAlertIcon aria-hidden className="size-5 shrink-0 text-warning" />
          추가 확인: {followUp}
        </p>
      )}
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="type-label-lg text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 type-ui-lg font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

// 항목마다 판단(상태)과 그 근거(공고문 쪽수·인용)를 한 줄에 붙인다. 판단만 따로 보이지 않게 한다.
// 머리 줄은 첫 항목과, 개수 줄은 마지막 항목과 함께 나온다. 아래 선도 마지막 항목에 붙여 함께 나오게 한다.
function QualificationList({ bid, shown }: { bid: DemoBid; shown: Shown }) {
  const { SATISFIED, NEEDS_REVIEW, NOT_SATISFIED } = bid.counts;
  return (
    <div className={cn("mt-6 border-t border-foreground", reveal(shown.checks >= 1))}>
      <div className="flex items-center justify-between gap-4 py-3">
        <h4 className="type-ui-lg font-semibold text-foreground">참가 자격 검토</h4>
        <p
          className={cn(
            "type-label-lg text-muted-foreground",
            reveal(shown.checks >= bid.checks.length),
          )}
        >
          충족 {SATISFIED} · 확인 필요 {NEEDS_REVIEW} · 미충족 {NOT_SATISFIED}
        </p>
      </div>
      <ul>
        {bid.checks.map((check, index) => (
          <li
            key={check.requirement}
            className={cn(
              "grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3 border-t border-border py-3.5 last:border-b",
              reveal(index < shown.checks),
            )}
          >
            <QualificationLabel status={check.status} />
            <div className="min-w-0">
              <p className="type-ui-lg font-semibold text-foreground">{check.requirement}</p>
              <p className="mt-0.5 type-label-lg text-muted-foreground">{check.note}</p>
              <p className="mt-2">
                <EvidenceQuote evidence={check.evidence} />
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 오른쪽 단. 점수와 그 고지를 붙여 두고, 시스템 권고와 담당자 결정을 결재란처럼 나란히 둔다.
// 결정 칸은 비어 있지 않고 "대기"다 — 권고가 곧 결정으로 읽히지 않게 한다.
// 결재란은 판 안에 있으므로 상자로 감싸지 않고 위아래 선과 칸 사이 선으로만 나눈다(판 안에 상자를 두지 않는다).
// 점수 고지·담당자 결정 "대기"·권고 안내 문장은 늘 보인다. 점수는 0 에서 오르고(막대도 함께), 권고 배지와 이유는 맨 뒤에 나온다.
// 오르는 숫자는 CSS 카운터로 그려 aria-hidden 이고, 실제 점수는 sr-only 글자와 meter 의 aria-valuenow(늘 최종 점수)로 읽힌다.
function DecisionRail({ bid, shown }: { bid: DemoBid; shown: Shown }) {
  const noteId = `${bid.id}-score-note`;
  return (
    <div className="flex min-w-0 flex-col gap-5.5 border-l border-border px-6 pt-6 pb-7">
      <div>
        <h4 className="type-label-lg font-medium text-muted-foreground">SOL Score</h4>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="type-headline text-foreground tabular-nums">
            <span className="sr-only">{bid.score}</span>
            <span
              aria-hidden
              className={styles.count}
              style={
                {
                  "--work-demo-count": shown.score ? bid.score : 0,
                  transitionDuration: "1200ms",
                } as React.CSSProperties
              }
            />
          </span>
          <span className="type-body-lg text-muted-foreground">/ 100</span>
        </p>
        <div
          role="meter"
          aria-label="SOL Score"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={bid.score}
          aria-describedby={noteId}
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-1200 ease-out motion-reduce:transition-none"
            style={{ width: shown.score ? `${bid.score}%` : "0%" }}
          />
        </div>
        <p id={noteId} className="mt-2.5 type-label-lg text-balance text-muted-foreground">
          SOL Score는 사업 적합도이며 수주 확률이 아닙니다.
        </p>
      </div>
      <hr className="border-border" />
      <div>
        <h4 className="type-label-lg font-medium text-muted-foreground">권고와 결정</h4>
        <dl className="mt-2.5 grid grid-cols-2 border-y border-input">
          <div className="min-w-0 pt-2.5 pr-3 pb-3">
            <dt className="type-body font-semibold text-muted-foreground">시스템 권고</dt>
            <dd className={cn("mt-2 flex min-h-7.5 items-center", reveal(shown.verdict))}>
              <RecommendationBadge value={bid.recommendation} />
            </dd>
          </div>
          <div className="min-w-0 border-l border-input px-3 pt-2.5 pb-3">
            <dt className="type-body font-semibold text-muted-foreground">담당자 결정</dt>
            <dd className="mt-2 flex min-h-7.5 items-center gap-1.5 type-ui-lg font-semibold text-muted-foreground">
              <ClockIcon aria-hidden className="size-4.5 shrink-0" />
              대기
            </dd>
          </div>
        </dl>
        <p className={cn("mt-3 type-ui-lg text-foreground", reveal(shown.verdict))}>
          {bid.recommendationReason}
        </p>
        <p className="mt-2.5 type-label-lg text-muted-foreground">
          권고는 참고 의견입니다. 최종 참여 여부는 담당자가 결정합니다.
        </p>
      </div>
    </div>
  );
}
