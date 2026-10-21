"use client";

import Link from "next/link";
import { isHttpUrl } from "@/components/bids/external-url";
import { SOURCE_LABELS, SourceBadge } from "@/components/bids/source-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OPPORTUNITY_SERVICES, opportunityHref } from "@/components/work/opportunities-copy";
import type { OpportunityItem } from "@/server/opportunities";

export function OpportunitySourcesDialog({
  item,
  listQuery,
}: {
  item: Pick<OpportunityItem, "title" | "bidId" | "sourceCount" | "sources">;
  listQuery?: string;
}) {
  if (item.sourceCount < 2) return null;
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" className="h-6 px-1 type-caption" />}
        aria-label={`${item.title}의 원본 출처 ${item.sourceCount}개 보기`}
      >
        외 {item.sourceCount - 1}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>원본 출처</DialogTitle>
          <DialogDescription>
            같은 사업기회로 연결된 공고입니다. 분석과 최종 결정은 각 공고 입력에 연결됩니다.
          </DialogDescription>
        </DialogHeader>
        <p className="type-body font-medium wrap-anywhere">{item.title}</p>
        <ul className="divide-y divide-border">
          {item.sources.map((source) => (
            <li key={source.bidId} className="flex flex-wrap items-center gap-3 py-3">
              <SourceBadge family={source.sourceFamily} />
              <div className="min-w-0 flex-1">
                <p className="type-label wrap-anywhere">
                  {OPPORTUNITY_SERVICES[source.source] ??
                    (source.sourceFamily === null
                      ? "예시 공고"
                      : `${SOURCE_LABELS[source.sourceFamily]} 공고`)}
                </p>
                {source.bidId === item.bidId && (
                  <p className="type-caption text-muted-foreground">대표 공고</p>
                )}
              </div>
              <Link
                href={opportunityHref(source.bidId, listQuery)}
                className="rounded-sm type-label outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                공고 상세
              </Link>
              {isHttpUrl(source.url) && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm type-label outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`${source.urlKind === "SERVICE_DOCUMENTATION" ? "서비스 안내" : "공식 원문"}, 새 탭에서 열림`}
                >
                  {source.urlKind === "SERVICE_DOCUMENTATION" ? "서비스 안내" : "공식 원문"}
                </a>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
