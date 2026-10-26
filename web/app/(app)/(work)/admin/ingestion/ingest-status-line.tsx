"use client";

import { LoaderCircleIcon, OctagonAlertIcon, RefreshCwIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { STATUS_ICON } from "@/components/bids/labels";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorCodeLabel, primaryFailureOf, QUOTA_CAUSE_TEXT, quotaCauseOf } from "./error-kind";
import { formatKstClock, shortRunId } from "./ingest-format";
import type { StatusLineModel } from "./ingest-runs";
import {
  ACCESS_LOST,
  LOGIN_PATH,
  REANALYZE_HINT,
  SESSION_EXPIRED,
  sourceWithBatch,
  type IngestRun,
} from "./ingestion-copy";
import { FAILURE_NOTICE_AFTER, type PollState } from "./use-ingest-polling";

// 실행 상태 줄(N8 스펙 §4.3, D13). 진행 중이거나 이 화면에서 방금 끝난 run 을 한 줄로 알린다. 토스트는 쓰지 않는다.
// 화면에서 상태 변화를 낭독하는 곳은 여기 하나다(role="status"). 낭독 영역은 내용이 없을 때도 같은 요소로 남겨 두고
// (처음 생기는 영역은 낭독기가 놓칠 수 있다), 단추는 그 형제로 둬 단추 이름까지 읽지 않게 한다.

const STALE_NOTICE = "30분 넘게 끝나지 않았습니다. worker 기록을 확인하세요.";
const DELAYED_NOTICE = "수집이 5분 넘게 끝나지 않아 자동 확인을 멈췄습니다.";
const FAILURES_NOTICE = "수집 상태를 확인하지 못했습니다. 다시 확인하는 중입니다.";
const WORKER_NOT_STARTED =
  "수집 작업이 아직 시작되지 않았습니다(1분 지남). worker가 실행 중인지 확인하세요.";

type Tone = "neutral" | "destructive";
type Icon = { icon: LucideIcon; className: string; spin?: boolean };
type Line = {
  tone: Tone;
  icon: Icon;
  text: string;
  /** 둘째 줄(바뀐 공고 재분석 안내). */
  hint?: string;
  /** 줄 오른쪽 단추. */
  action?: React.ReactNode;
};

const SPIN: Icon = { icon: LoaderCircleIcon, className: "text-muted-foreground", spin: true };
const ALERT: Icon = { icon: OctagonAlertIcon, className: "text-destructive" };

const counts = (run: IngestRun, withQuarantine: boolean): string => {
  const { created, changed, cancelled, skippedDuplicate, quarantined, retried } = run.summary;
  return [
    `신규 ${created}`,
    `변경 ${changed}`,
    `취소 ${cancelled}`,
    `중복 ${skippedDuplicate}`,
    withQuarantine ? `격리 ${quarantined}` : null,
    `재시도 ${retried}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

const othersSuffix = (others: number): string => (others > 0 ? ` 외 ${others}건` : "");

// 공공 API 를 부른 run(fixture 아님)은 호출량과 끝난 시각을 덧붙인다(10-26: 불러오기 결과가 상태 줄에서 바로 보이게).
// fixture 데모 문장은 바꾸지 않는다.
const liveSuffix = (run: IngestRun): string => {
  if (run.source === "fixture") return "";
  const finished = run.finishedAt === null ? "" : ` · ${formatKstClock(run.finishedAt)} 완료`;
  return ` · 공공 API 호출 ${run.quotaUsed}회${finished}`;
};

function finishedLine(run: IngestRun): Omit<Line, "action"> {
  const hint = run.summary.changed + run.summary.cancelled > 0 ? REANALYZE_HINT : undefined;
  switch (run.status) {
    case "SUCCEEDED":
      return {
        tone: "neutral",
        icon: STATUS_ICON.COMPLETED,
        text: `수집이 끝났습니다 · ${counts(run, true)}${liveSuffix(run)}`,
        hint,
      };
    case "PARTIAL":
      return {
        tone: "neutral",
        icon: STATUS_ICON.PARTIAL,
        text: `수집이 끝났지만 ${run.summary.quarantined}건을 격리했습니다 · ${counts(run, false)}${liveSuffix(run)}`,
        hint,
      };
    case "FAILED": {
      // 호출 한도·예산 저장소 때문에 멈췄으면 원인 문장을 그대로 보인다(코드는 서랍에 있다).
      const quota = quotaCauseOf(run.errors);
      if (quota !== null)
        return { tone: "destructive", icon: ALERT, text: QUOTA_CAUSE_TEXT[quota], hint };
      const cause = primaryFailureOf(run.errors);
      return {
        tone: "destructive",
        icon: ALERT,
        text:
          cause === null
            ? "수집이 실패했습니다"
            : `수집이 실패했습니다 · ${errorCodeLabel(cause.errorCode)} ${cause.errorCode}`,
        hint,
      };
    }
    case "RUNNING":
      // 끝난 run 만 오지만, 상태를 다시 읽는 사이 바뀌어도 진행 중 글자로 보인다.
      return { tone: "neutral", icon: SPIN, text: `수집 실행 중 · ${sourceWithBatch(run, true)}` };
  }
}

function modelLine(model: StatusLineModel): Omit<Line, "action"> {
  switch (model.kind) {
    case "pending": {
      const { run } = model.entry;
      return {
        tone: "neutral",
        icon: SPIN,
        text: model.overdue
          ? WORKER_NOT_STARTED
          : `수집을 요청했습니다 · ${sourceWithBatch(run, true)} · ${shortRunId(run.id)} · 작업 시작을 기다리는 중${othersSuffix(model.others)}`,
      };
    }
    case "running": {
      const { run } = model;
      const text = `수집 실행 중 · ${sourceWithBatch(run, true)} · ${shortRunId(run.id)} · ${formatKstClock(run.startedAt)} 시작${othersSuffix(model.others)}`;
      return {
        tone: "neutral",
        icon: SPIN,
        text: model.stale ? `${text}. ${STALE_NOTICE}` : text,
      };
    }
    case "finished":
      return finishedLine(model.run);
  }
}

const runIdOf = (model: StatusLineModel): string =>
  model.kind === "pending" ? model.entry.run.id : model.run.id;

export function IngestStatusLine({
  model,
  poll,
  onOpenRun,
  onRecheck,
  onReload,
}: {
  model: StatusLineModel | null;
  poll: PollState;
  onOpenRun: (id: string) => void;
  /** [다시 확인]: 폴링을 처음 주기로 다시 시작한다. */
  onRecheck: () => void;
  /** 권한이 바뀌었을 때 [새로 고침]: 서버가 화면을 다시 그린다. */
  onReload: () => void;
}) {
  const line = lineOf(model, poll, { onOpenRun, onRecheck, onReload });
  const Icon = line?.icon.icon;
  return (
    <div
      className={cn(
        line === null
          ? "sr-only"
          : "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-background px-4 py-3",
        line?.tone === "destructive" ? "border-destructive" : "border-border",
      )}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex min-w-0 flex-1 gap-2"
      >
        {line !== null && Icon !== undefined && (
          <>
            <Icon
              aria-hidden="true"
              className={cn(
                "mt-[3px] size-4 shrink-0",
                line.icon.className,
                line.icon.spin && "animate-spin motion-reduce:animate-none",
              )}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="type-body wrap-anywhere text-foreground">{line.text}</p>
              {line.hint !== undefined && (
                <p className="type-label text-muted-foreground">{line.hint}</p>
              )}
            </div>
          </>
        )}
      </div>
      {line?.action}
    </div>
  );
}

function lineOf(
  model: StatusLineModel | null,
  poll: PollState,
  handlers: { onOpenRun: (id: string) => void; onRecheck: () => void; onReload: () => void },
): Line | null {
  if (poll.phase === "denied")
    return poll.status === 401
      ? {
          tone: "destructive",
          icon: ALERT,
          text: SESSION_EXPIRED,
          action: (
            <Link
              href={LOGIN_PATH}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              로그인
            </Link>
          ),
        }
      : {
          tone: "destructive",
          icon: ALERT,
          text: ACCESS_LOST,
          action: (
            <Button type="button" variant="outline" size="sm" onClick={handlers.onReload}>
              <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
              새로 고침
            </Button>
          ),
        };
  if (model === null) return null;
  const detail = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-haspopup="dialog"
      onClick={() => handlers.onOpenRun(runIdOf(model))}
    >
      자세히
    </Button>
  );
  if (poll.phase === "delayed" && model.kind !== "finished")
    return {
      tone: "neutral",
      icon: STATUS_ICON.PARTIAL,
      text: DELAYED_NOTICE,
      action: (
        <>
          <Button type="button" variant="outline" size="sm" onClick={handlers.onRecheck}>
            <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
            다시 확인
          </Button>
          {detail}
        </>
      ),
    };
  if (poll.phase === "polling" && poll.failures >= FAILURE_NOTICE_AFTER)
    return { tone: "neutral", icon: STATUS_ICON.PARTIAL, text: FAILURES_NOTICE, action: detail };
  return { ...modelLine(model), action: detail };
}
