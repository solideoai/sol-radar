"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Link2OffIcon, RadarIcon } from "lucide-react";
import { DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import {
  DemoBadge,
  QualificationLabel,
  RecommendationBadge,
} from "@/components/landing/status-badges";

// 랜딩의 시각적 중심. 실제 화면이 아니라 가상 데이터(demo-bids.ts)로 그린 분석 화면이다.
// 왼쪽 목록에서 공고를 고르면 오른쪽 분석이 바뀐다. 목록과 분석의 관계가 탭과 같아 Base UI Tabs(세로)로 만든다.
// 패널을 그리는 데 시간이 들지 않아 방향키로 옮기면 바로 고른다(activateOnFocus).
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-left shadow-sm">
      <PreviewBar />
      <Tabs.Root
        defaultValue={DEMO_BIDS[0].id}
        orientation="vertical"
        className="grid grid-cols-[18rem_minmax(0,1fr)]"
      >
        <div className="border-r border-border bg-muted/40">
          <p
            id="demo-list-title"
            className="px-4 pt-4 pb-2 type-caption font-medium text-muted-foreground"
          >
            예시 공고 {DEMO_BIDS.length}건
          </p>
          <Tabs.List
            activateOnFocus
            aria-labelledby="demo-list-title"
            className="flex flex-col gap-1 px-2 pb-3"
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
            className="min-w-0 p-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in"
          >
            <BidAnalysis bid={bid} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
}

// 창 머리. 주소 칸 대신 화면 이름과 분석 기준을 적는다 — 실제 서비스 주소처럼 보이지 않게 한다.
function PreviewBar() {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2.5">
      <RadarIcon aria-hidden className="size-4 text-brand" />
      <p className="type-label font-medium text-foreground">공고 분석</p>
      <span aria-hidden className="h-4 w-px bg-border" />
      <p className="type-caption text-muted-foreground">분석 기준: 가상 기업 프로필</p>
      <DemoBadge className="ml-auto" />
    </div>
  );
}

// 탭 안에는 글자 요소(span)만 둔다 — 버튼 안에 제목·블록 요소를 넣지 않는다.
function BidTab({ bid }: { bid: DemoBid }) {
  return (
    <Tabs.Tab
      value={bid.id}
      className="group/tab relative flex w-full flex-col items-start gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none hover:bg-background/70 focus-visible:ring-3 focus-visible:ring-ring/50 data-active:border-border data-active:bg-background data-active:shadow-xs motion-safe:transition-colors"
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand opacity-0 group-data-active/tab:opacity-100"
      />
      <span className="type-label font-medium text-foreground">{bid.title}</span>
      <span className="type-caption text-muted-foreground">{bid.agency}</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="type-caption text-muted-foreground">
          SOL Score <span className="font-semibold text-foreground tabular-nums">{bid.score}</span>
        </span>
        <RecommendationBadge value={bid.recommendation} />
      </span>
    </Tabs.Tab>
  );
}

function BidAnalysis({ bid }: { bid: DemoBid }) {
  return (
    <article aria-labelledby={`${bid.id}-title`} className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <DemoBadge />
          <span className="type-caption text-muted-foreground">입찰공고</span>
        </div>
        <h3 id={`${bid.id}-title`} className="type-lead font-semibold text-foreground">
          {bid.title}
        </h3>
        <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border px-4 py-3">
          <Fact term="기관명" value={bid.agency} />
          <Fact term="사업 예산" value={formatWon(bid.budgetWon)} />
          <Fact term="제안서 마감" value={formatDate(bid.proposalDue)} />
        </dl>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <ScoreBlock bid={bid} />
        <RecommendationBlock bid={bid} />
      </div>
      <QualificationBlock bid={bid} />
      <div className="grid grid-cols-2 gap-4">
        <ListBlock title="주요 판단 근거" items={bid.reasons} empty="적힌 근거가 없습니다." />
        <ListBlock
          title="추가 확인 사항"
          items={bid.followUps}
          empty="추가로 확인할 사항이 없습니다."
        />
      </div>
      <SourceBlock />
    </article>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="type-caption text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 type-label font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function ScoreBlock({ bid }: { bid: DemoBid }) {
  const noteId = `${bid.id}-score-note`;
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-muted-foreground">SOL Score</h4>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="type-headline text-foreground tabular-nums">{bid.score}</span>
        <span className="type-label text-muted-foreground">/ 100</span>
      </p>
      <div
        role="meter"
        aria-label="SOL Score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bid.score}
        aria-describedby={noteId}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${bid.score}%` }} />
      </div>
      <p id={noteId} className="mt-3 type-caption text-muted-foreground">
        SOL Score는 사업 적합도이며 수주 확률이 아닙니다.
      </p>
    </div>
  );
}

function RecommendationBlock({ bid }: { bid: DemoBid }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-muted-foreground">참여 권고</h4>
      <RecommendationBadge value={bid.recommendation} size="md" className="mt-2" />
      <p className="mt-3 type-body text-foreground">{bid.recommendationReason}</p>
      <p className="mt-2 type-caption text-muted-foreground">
        권고는 참고 의견입니다. 최종 참여 여부는 담당자가 결정합니다.
      </p>
    </div>
  );
}

function QualificationBlock({ bid }: { bid: DemoBid }) {
  const { SATISFIED, NEEDS_REVIEW, NOT_SATISFIED } = bid.counts;
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h4 className="type-label font-medium text-foreground">참가 자격 검토</h4>
        <p className="type-caption text-muted-foreground">
          충족 {SATISFIED} · 확인 필요 {NEEDS_REVIEW} · 미충족 {NOT_SATISFIED}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {bid.checks.map((check) => (
          <li
            key={check.requirement}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-2.5"
          >
            <QualificationLabel status={check.status} />
            <div>
              <p className="type-label font-medium text-foreground">{check.requirement}</p>
              <p className="type-caption text-muted-foreground">{check.note}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="type-label font-medium text-foreground">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 type-body text-foreground marker:text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 type-body text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

// 원문 연결 자리. 예시 공고에는 원문이 없어 링크를 만들지 않는다(가짜 주소·href="#" 금지).
function SourceBlock() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <Link2OffIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="type-caption text-muted-foreground">
        <span className="font-medium text-foreground">공고 원문</span> · 예시 공고라 연결할 원문이
        없습니다. 실제 서비스에서는 이 자리에 공고 원문과 첨부문서를 연결할 예정입니다.
      </p>
    </div>
  );
}
