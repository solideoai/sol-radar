"use client";

import { CircleCheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "cn";
import {
  INSIGHT_NOTICE,
  InsightNotice,
  InsightResult,
  type InsightRunFacts,
} from "@/components/bids/recommendation-insight-sections";
import { StatusBadge } from "@/components/bids/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InsightView } from "@/server/insight";

// 추천 분석 팝업(디자인 스펙 2026-11-03-recommendation-insight-detail-design §4·6·7·9, ADR-078).
// 머리(제목·닫기·권고·점수·고지)는 늘 고정이고 본문만 스크롤된다. 768px 이상은 가운데 672px·높이 고정, 767px 이하는 전체 화면이다.
// 요청·묻기 상태는 상세 화면 구역(recommendation-insight.tsx)이 갖는다. Base UI 팝업은 닫히면 내용을 내리므로,
// 상태를 여기 두면 닫는 순간 묻기가 끊긴다. 그래서 닫아도 분석은 이어지고 다시 열면 같은 진행률에서 이어진다.
// 공용 dialog.tsx 는 고치지 않는다(계획 Q8). 기본 닫기 버튼(영어 "Close")은 끄고 머리에 [닫기]를 직접 둔다.

/** waiting: 요청·묻는 중. delayed: 3분이 지나 묻기를 멈췄다. finishing: DONE 을 받고 100% 를 잠깐 보인다. settled: 그 밖. */
export type InsightStage = "waiting" | "delayed" | "finishing" | "settled";

const MAKING_TEXT = "추천 분석을 만들고 있습니다.";
const DONE_TEXT = "추천 분석이 끝났습니다.";
const DELAYED_TEXT = "응답이 늦어지고 있습니다. 잠시 뒤 다시 확인하세요.";
const FAILED_TEXT = "추천 분석을 만들지 못했습니다.";
const PROGRESS_HELP =
  "공고와 회사 자료를 읽고 정리하고 있습니다. 진행률은 걸린 시간으로 어림한 값이고, 창을 닫아도 분석은 계속됩니다.";

// 폭별 형태(디자인 스펙 4.1). 공용 부품의 grid·p-6·sm:max-w-sm·내부 스크롤을 덮고, 767px 이하는 이동 없이 화면을 채운다.
// 움직임 줄이기에서는 열고 닫는 움직임을 끈다(계획 Q7). 뒷막은 공용 부품 그대로다(className 을 넘길 수 없다).
const POPUP_CLASS = cn(
  "flex flex-col gap-0 overflow-hidden p-0 sm:max-w-none",
  "md:h-[min(48rem,calc(100dvh-2rem))] md:max-w-2xl",
  "max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:ring-0",
  "max-md:data-open:zoom-in-100 max-md:data-closed:zoom-out-100 motion-reduce:animate-none!",
);

type RecommendationInsightDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 닫으면 초점을 돌려줄 구역 버튼. 상태가 바뀌어도 같은 요소다. */
  returnFocus: React.RefObject<HTMLButtonElement | null>;
  bidTitle: string;
  run: InsightRunFacts;
  canRequest: boolean;
  currentPromptVersion: string;
  insight: InsightView | null;
  previous: InsightView | null;
  stage: InsightStage;
  /** 진행 표시 숫자(0~100). waiting·delayed·finishing 에서만 쓴다. */
  progress: number;
  onRequest: () => void;
  onRecheck: () => void;
};

function RecommendationInsightDialog({
  open,
  onOpenChange,
  returnFocus,
  bidTitle,
  run,
  canRequest,
  currentPromptVersion,
  insight,
  previous,
  stage,
  progress,
  onRequest,
  onRecheck,
}: RecommendationInsightDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // 누른 버튼은 상태가 바뀌며 사라지므로 초점을 본문 영역으로 옮기고 맨 위로 돌린다(디자인 스펙 9절).
  const focusBody = () => {
    const body = bodyRef.current;
    if (body === null) return;
    body.scrollTop = 0;
    body.focus();
  };
  const requestAgain = () => {
    onRequest();
    focusBody();
  };
  const recheckNow = () => {
    onRecheck();
    focusBody();
  };
  const announcement =
    stage === "waiting"
      ? MAKING_TEXT
      : stage === "delayed"
        ? DELAYED_TEXT
        : stage === "finishing" || insight?.status === "DONE"
          ? DONE_TEXT
          : insight?.status === "FAILED"
            ? FAILED_TEXT
            : "";

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        initialFocus={bodyRef}
        finalFocus={returnFocus}
        className={POPUP_CLASS}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-6 pt-6 pb-4 max-md:px-4 max-md:pt-4 max-md:pb-3">
          {/* 전체 화면에서는 어느 공고인지 보이지 않아 공고명 한 줄을 더한다(계획 Q6). */}
          <p className="truncate type-caption text-muted-foreground md:hidden">{bidTitle}</p>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-foreground">추천 분석</DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="닫기"
                  className="-mr-2 shrink-0"
                />
              }
            >
              <XIcon aria-hidden="true" />
            </DialogClose>
          </div>
          <RunSummary run={run} />
          <DialogDescription>{INSIGHT_NOTICE}</DialogDescription>
        </div>
        <div
          ref={bodyRef}
          role="region"
          aria-label="추천 분석 내용"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset max-md:px-4 max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          {/* 상태가 바뀔 때만 읽는다. 매초 바뀌는 숫자는 넣지 않는다(진행 막대 값으로 물을 수 있다). */}
          <p role="status" className="sr-only">
            {announcement}
          </p>
          {stage === "delayed" && (
            <InsightNotice
              lines={[DELAYED_TEXT]}
              strong
              action={{ label: "다시 확인", onClick: recheckNow }}
            />
          )}
          {stage === "settled" ? (
            <SettledBody
              insight={insight}
              previous={previous}
              run={run}
              currentPromptVersion={currentPromptVersion}
              onRequest={canRequest ? requestAgain : null}
            />
          ) : (
            <ProgressBlock value={progress} stage={stage} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 머리 둘째 줄: 권고 배지 · SOL Score · 참고. 모두 규칙 값이다.
function RunSummary({ run }: { run: InsightRunFacts }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {run.recommendation !== null && (
        <StatusBadge kind="recommendation" value={run.recommendation} />
      )}
      <span className="flex items-baseline gap-1.5">
        <span className="type-label text-muted-foreground">SOL Score</span>
        <span className="type-label tabular-nums text-foreground">
          {run.solScore === null ? "—" : `${Math.round(run.solScore)} / 100`}
        </span>
      </span>
      {run.referenceScore && (
        <span className="shrink-0 rounded-sm border border-border px-1.5 type-caption text-muted-foreground">
          참고
        </span>
      )}
    </div>
  );
}

// 진행 표시(디자인 스펙 7.1). 글자·숫자·막대가 함께 있다. 채움은 foreground 다(이 화면에서 brand 막대는 규칙 점수를 뜻한다).
// `%` 는 이 블록 안에서만 쓴다(ADR-078 3번).
function ProgressBlock({
  value,
  stage,
}: {
  value: number;
  stage: Exclude<InsightStage, "settled">;
}) {
  const Icon = stage === "finishing" ? CircleCheckIcon : LoaderCircleIcon;
  return (
    <div data-slot="insight-progress" className="pt-6">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            stage === "waiting" && "animate-spin motion-reduce:animate-none",
          )}
        />
        {/* 화면 낭독기는 위 알림 영역과 진행 막대로 듣는다. 같은 문장을 두 번 읽지 않게 숨긴다. */}
        <p aria-hidden="true" className="min-w-0 type-body text-foreground">
          {stage === "finishing" ? DONE_TEXT : MAKING_TEXT}
        </p>
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 type-heading tabular-nums text-foreground"
        >
          {value}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="추천 분석 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="mt-2 type-label text-muted-foreground">{PROGRESS_HELP}</p>
    </div>
  );
}

// 끝난 상태의 본문. 실패면 안내와 [다시 요청] 아래에 그 run 의 이전 모델 결과를 그대로 그린다(계획 Q2).
function SettledBody({
  insight,
  previous,
  run,
  currentPromptVersion,
  onRequest,
}: {
  insight: InsightView | null;
  previous: InsightView | null;
  run: InsightRunFacts;
  currentPromptVersion: string;
  onRequest: (() => void) | null;
}) {
  if (insight === null) {
    // POST 가 429·503·네트워크 오류로 실패해도 팝업 안에서 다시 누를 수 있게 요청 가능 역할에게 버튼을 둔다(사전 리뷰 CS-W1).
    // 401·403·404 는 다시 눌러도 같은 알림이 뜰 뿐 행을 만들지 않는다.
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-6">
        <p className="type-body text-muted-foreground">아직 추천 분석이 없습니다.</p>
        {onRequest !== null && (
          <Button type="button" variant="outline" size="sm" onClick={onRequest}>
            추천 분석
          </Button>
        )}
      </div>
    );
  }
  if (insight.status !== "DONE" || insight.payload === null) {
    return (
      <>
        <InsightNotice
          lines={[FAILED_TEXT]}
          code={insight.errorCode}
          strong
          action={onRequest === null ? null : { label: "다시 요청", onClick: onRequest }}
        />
        {previous !== null && previous.payload !== null && (
          <InsightResult
            view={previous}
            payload={previous.payload}
            run={run}
            currentPromptVersion={currentPromptVersion}
            onRequest={null}
          />
        )}
      </>
    );
  }
  return (
    <InsightResult
      view={insight}
      payload={insight.payload}
      run={run}
      currentPromptVersion={currentPromptVersion}
      onRequest={onRequest}
    />
  );
}

export { RecommendationInsightDialog };
