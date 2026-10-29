import { cn } from "cn";
import { InboxIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { SolRole } from "@/server/organization";
import { INGESTION_PATH } from "@/app/(app)/(work)/admin/ingestion/ingestion-copy";

// 업무 화면의 빈 상태(스펙 §5.2·§5.3 상태표). 대시보드와 공고 목록이 같은 모양을 쓴다.
// 아이콘은 장식이라 숨기고, 제목 글자가 상태를 말한다.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="type-body font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 type-label text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

// IT 공고가 한 건도 없을 때(대시보드·목록 같은 문구, 06 §5.3·§5.4, 미결정 26-6).
// 목록·집계는 IT 범위만 세므로(ADR-069) IT 밖 공고가 저장돼 있어도 0건일 수 있다. 그래서 "수집된 공고가 없다"고 하지 않고 범위를 밝힌다.
// ADMIN 은 [수집 실행] 단추로 /admin/ingestion 에 간다(그 화면의 [수동 수집 실행] 대화상자로 돌린다). 새 IT 공고도 수집으로만 들어온다.
// 다른 역할은 그 화면에 들어갈 수 없으므로 단추 없이 요청 안내만 본다.
export const NO_BIDS_TITLE = "아직 IT 공고가 없습니다";
const NO_BIDS_SCOPE = "IT 분야가 아닌 공고는 목록과 집계에서 뺍니다.";
export const NO_BIDS_HINT = "관리자에게 수집을 요청하세요";
export const NO_BIDS_ACTION_LABEL = "수집 실행";

/** 수집을 돌릴 수 있는 업무 역할인지. /admin/ingestion 화면(page.tsx)이 들여보내는 역할과 같다. */
export const canRunIngestion = (role: SolRole): boolean => role === "ADMIN";

export function NoBidsEmptyState({ canRun }: { canRun: boolean }) {
  if (!canRun)
    return (
      <EmptyState
        icon={InboxIcon}
        title={NO_BIDS_TITLE}
        description={`${NO_BIDS_SCOPE} ${NO_BIDS_HINT}`}
      />
    );
  return (
    <EmptyState
      icon={InboxIcon}
      title={NO_BIDS_TITLE}
      description={NO_BIDS_SCOPE}
      action={
        <Link href={INGESTION_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
          {NO_BIDS_ACTION_LABEL}
        </Link>
      }
    />
  );
}
