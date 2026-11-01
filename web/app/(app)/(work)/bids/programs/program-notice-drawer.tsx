"use client";

import { cn } from "cn";
import { ExternalLinkIcon, InfoIcon } from "lucide-react";
import { SourceLink } from "@/components/bids/source-link";
import { DemoBadge } from "@/components/bids/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProgramNoticeListItem } from "@/server/program-notices";
import { kstDate, periodText } from "./program-format";
import { DRAWER_COPY, NO_AGENCY, SOURCE_LABEL } from "./programs-copy";

// 부처 공고 상세 서랍(디자인 스펙 §4.6·§4.8). 목록 항목이 상세 필드를 모두 가져 따로 읽지 않는다.
// 글자는 서버가 평문으로 남긴 것을 글자 노드로만 그린다(HTML 해석 없음). 여러 줄 필드는 줄바꿈(\n)을 지킨다.
// 점수·권고·분석·결정·관심 공고 단추, 문의처, 수집 시각은 두지 않는다(부처 공고는 분석 대상이 아니다).

// 배지 상자는 status-badge 의 BADGE_BOX 와 같다. 출처는 색이 아니라 글자로 나눈다(중립색 하나).
const BADGE_BOX =
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-muted-foreground";

/** 출처 배지(기업마당·중기부). 표와 서랍이 같이 쓴다. 초점을 받지 않는다. */
export function SourceBadge({ source }: { source: ProgramNoticeListItem["source"] }) {
  return <span className={BADGE_BOX}>{SOURCE_LABEL[source]}</span>;
}

export function ProgramNoticeDrawer({
  item,
  open,
  today,
  onClose,
  returnFocus,
}: {
  /** 보이는 공고. 닫히는 동안에도 마지막 값을 넘겨 내용이 사라지지 않게 한다. */
  item: ProgramNoticeListItem | null;
  open: boolean;
  /** 서울 오늘(YYYY-MM-DD). 서버가 목록을 거른 값과 같다. */
  today: string;
  onClose: () => void;
  /** 닫을 때 초점을 돌려줄 요소(연 공고명 단추). 없어졌으면 본문. */
  returnFocus: () => HTMLElement | null;
}) {
  return (
    <Sheet
      open={open && item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* 근거 서랍·실행 상세 서랍과 같은 폭 덮어쓰기. 지원 폭(1280 이상)에서 480px 이다. */}
      <SheetContent
        side="right"
        finalFocus={returnFocus}
        className="data-[side=right]:w-full data-[side=right]:max-w-full data-[side=right]:md:w-[480px] data-[side=right]:md:max-w-[480px] motion-reduce:transition-none"
      >
        {item !== null && <NoticeDetail item={item} today={today} />}
      </SheetContent>
    </Sheet>
  );
}

function NoticeDetail({ item, today }: { item: ProgramNoticeListItem; today: string }) {
  const sections = [
    { key: "summary", title: DRAWER_COPY.summary, text: item.summary },
    { key: "applyMethod", title: DRAWER_COPY.applyMethod, text: item.applyMethod },
    { key: "target", title: DRAWER_COPY.target, text: item.target },
  ].filter((section) => section.text !== null);
  const hasContent = sections.length > 0 || item.tags.length > 0;

  return (
    <>
      {/* 긴 개요에 밀려 화면 밖으로 내려가지 않게 원문 보기를 머리에 둔다. 닫기 단추 자리는 pr-12. */}
      <SheetHeader className="gap-3 pr-12">
        <div className="flex flex-wrap items-center gap-1">
          <SourceBadge source={item.source} />
          {item.isDemo && <DemoBadge />}
        </div>
        <div className="flex flex-col gap-0.5">
          <SheetTitle className="wrap-anywhere">{item.title}</SheetTitle>
          <SheetDescription className="wrap-anywhere">{item.agency ?? NO_AGENCY}</SheetDescription>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="type-label text-muted-foreground">{DRAWER_COPY.period}</dt>
          <dd className="type-body text-foreground tabular-nums">
            {periodText(item.applyStartOn, item.applyEndOn, today, item.source)}
          </dd>
          <dt className="type-label text-muted-foreground">{DRAWER_COPY.published}</dt>
          <dd className="type-body text-foreground tabular-nums">
            {item.publishedAt === null ? (
              kstDate(null)
            ) : (
              <time dateTime={item.publishedAt}>{kstDate(item.publishedAt)}</time>
            )}
          </dd>
        </dl>
        <div className="flex flex-col gap-2">
          <SourceLink
            href={item.sourceUrl}
            ariaLabel={`${DRAWER_COPY.source}: ${item.title} (새 창)`}
            className={cn(buttonVariants({ variant: "outline" }), "self-start")}
          >
            <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
            {DRAWER_COPY.source}
          </SourceLink>
          <p className="flex items-center gap-2 type-label text-muted-foreground">
            <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
            {DRAWER_COPY.contact}
          </p>
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-4 border-t border-border px-4 pt-4 pb-4">
        {hasContent ? (
          <>
            {sections.map((section) => (
              <DetailSection key={section.key} title={section.title}>
                <p className="type-body whitespace-pre-line wrap-anywhere text-foreground">
                  {section.text}
                </p>
              </DetailSection>
            ))}
            {item.tags.length > 0 && (
              <DetailSection title={DRAWER_COPY.tags}>
                <ul className="flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <li key={tag} className="flex max-w-full">
                      <Chip className="max-w-full" title={tag}>
                        <span className="min-w-0 truncate">{tag}</span>
                      </Chip>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
          </>
        ) : (
          // 중기부 RSS·과기정통부처럼 제목·등록일·주소만 주는 출처(계획 "이름과 값").
          <p className="type-body text-muted-foreground">
            {item.source === "msit" ? DRAWER_COPY.titleOnlyMsit : DRAWER_COPY.titleOnly}
          </p>
        )}
      </div>
    </>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-heading type-label text-foreground">{title}</h3>
      {children}
    </section>
  );
}
