"use client";

import { Tabs } from "@base-ui/react/tabs";
import { ClockIcon, TriangleAlertIcon } from "lucide-react";
import { DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import {
  DemoBadge,
  EvidenceQuote,
  QualificationLabel,
  RecommendationBadge,
} from "@/components/landing/status-badges";

// 랜딩의 시각적 중심. 실제 화면이 아니라 가상 데이터(demo-bids.ts)로 그린 분석 화면이다.
// 왼쪽 목록에서 공고를 고르면 오른쪽 분석이 바뀐다. 목록과 분석의 관계가 탭과 같아 Base UI Tabs(세로)로 만든다.
// 패널을 그리는 데 시간이 들지 않아 방향키로 옮기면 바로 고른다(activateOnFocus).
// 판은 3단이다(목록 · 공고와 자격 검토 · 점수와 결재란). 패널이 뒤의 두 단을 차지해 공고를 바꾸면 두 단이 함께 바뀐다.
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-background text-left shadow-sm">
      <PreviewBar />
      <Tabs.Root
        defaultValue={DEMO_BIDS[0].id}
        orientation="vertical"
        className="grid grid-cols-[280px_minmax(0,1fr)_288px]"
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
              <BidTab key={bid.id} bid={bid} />
            ))}
          </Tabs.List>
        </div>
        {DEMO_BIDS.map((bid) => (
          <Tabs.Panel
            key={bid.id}
            value={bid.id}
            className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_288px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in"
          >
            <BidReview bid={bid} />
            <DecisionRail bid={bid} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

// 창 머리. 주소 칸 대신 화면 이름과 분석 기준을 적는다 — 실제 서비스 주소처럼 보이지 않게 한다.
function PreviewBar() {
  return (
    <div className="flex h-13 items-center gap-3.5 border-b border-border px-5">
      <p className="type-ui-lg font-semibold text-foreground">공고 분석</p>
      <span aria-hidden className="h-4 w-px bg-border" />
      <p className="type-label-lg text-muted-foreground">분석 기준: 가상 기업 프로필</p>
      <DemoBadge className="ml-auto" />
    </div>
  );
}

// 탭 안에는 글자 요소(span)만 둔다 — 버튼 안에 제목·블록 요소를 넣지 않는다.
function BidTab({ bid }: { bid: DemoBid }) {
  return (
    <Tabs.Tab
      value={bid.id}
      className="group/tab relative flex w-full flex-col items-start gap-1 rounded-[10px] border border-transparent px-4 py-3.5 text-left outline-none hover:bg-background/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-active:border-border data-active:bg-background data-active:shadow-xs motion-safe:transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-y-3 -left-px w-0.75 rounded-full bg-brand opacity-0 group-data-active/tab:opacity-100"
      />
      <span className="type-ui-lg font-semibold text-foreground">{bid.title}</span>
      <span className="type-label-lg text-muted-foreground">{bid.agency}</span>
      <span className="mt-1.5 flex items-center gap-2.5">
        <span className="type-label-lg text-muted-foreground">
          SOL Score <span className="font-semibold text-foreground tabular-nums">{bid.score}</span>
        </span>
        <RecommendationBadge value={bid.recommendation} />
      </span>
    </Tabs.Tab>
  );
}

// 가운데 단. 공고 사실과 참가 자격 검토를 상자 없이 선으로만 나눈다 — 상자 안에 상자를 두지 않는다.
function BidReview({ bid }: { bid: DemoBid }) {
  const [followUp] = bid.followUps;
  return (
    <div className="min-w-0 px-7 pt-6 pb-7">
      <p className="type-label-lg text-muted-foreground">입찰공고</p>
      <h3 id={`${bid.id}-title`} className="mt-3 type-heading-lg text-foreground">
        {bid.title}
      </h3>
      <dl className="mt-4 grid grid-cols-3 gap-6">
        <Fact term="기관명" value={bid.agency} />
        <Fact term="사업 예산" value={formatWon(bid.budgetWon)} />
        <Fact term="제안서 마감" value={formatDate(bid.proposalDue)} />
      </dl>
      <QualificationList bid={bid} />
      {followUp !== undefined && (
        <p className="mt-4 flex items-center gap-2.5 type-ui-lg text-foreground">
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
function QualificationList({ bid }: { bid: DemoBid }) {
  const { SATISFIED, NEEDS_REVIEW, NOT_SATISFIED } = bid.counts;
  return (
    <div className="mt-6 border-t border-foreground">
      <div className="flex items-center justify-between gap-4 py-3">
        <h4 className="type-ui-lg font-semibold text-foreground">참가 자격 검토</h4>
        <p className="type-label-lg text-muted-foreground">
          충족 {SATISFIED} · 확인 필요 {NEEDS_REVIEW} · 미충족 {NOT_SATISFIED}
        </p>
      </div>
      <ul className="border-b border-border">
        {bid.checks.map((check) => (
          <li
            key={check.requirement}
            className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3 border-t border-border py-3.5"
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
function DecisionRail({ bid }: { bid: DemoBid }) {
  const noteId = `${bid.id}-score-note`;
  return (
    <div className="flex min-w-0 flex-col gap-5.5 border-l border-border px-6 pt-6 pb-7">
      <div>
        <h4 className="type-label-lg font-medium text-muted-foreground">SOL Score</h4>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="type-headline text-foreground tabular-nums">{bid.score}</span>
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
          <div className="h-full rounded-full bg-brand" style={{ width: `${bid.score}%` }} />
        </div>
        <p id={noteId} className="mt-2.5 type-label-lg text-balance text-muted-foreground">
          SOL Score는 사업 적합도이며 수주 확률이 아닙니다.
        </p>
      </div>
      <hr className="border-border" />
      <div>
        <h4 className="type-label-lg font-medium text-muted-foreground">권고와 결정</h4>
        <dl className="mt-2.5 grid grid-cols-2 rounded-[10px] border border-input">
          <div className="min-w-0 px-3 pt-2.5 pb-3">
            <dt className="type-body font-semibold text-muted-foreground">시스템 권고</dt>
            <dd className="mt-2 flex min-h-7.5 items-center">
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
        <p className="mt-3 type-ui-lg text-foreground">{bid.recommendationReason}</p>
        <p className="mt-2.5 type-label-lg text-muted-foreground">
          권고는 참고 의견입니다. 최종 참여 여부는 담당자가 결정합니다.
        </p>
      </div>
    </div>
  );
}
