"use client";

import {
  CircleAlertIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { StatusBadge } from "@/components/bids/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  errorCodeLabel,
  groupErrorsByKind,
  QUOTA_CAUSE_TEXT,
  quotaCauseOf,
  type IngestErrorKind,
  type IngestRunError,
} from "./error-kind";
import { formatDuration, formatKstSeconds, shortRunId } from "./ingest-format";
import { isUuid } from "./ingest-runs";
import { readIngestionRun, type RunOutcome } from "./ingestion-api";
import {
  ACCESS_LOST,
  LOGIN_PATH,
  REANALYZE_HINT,
  runModeLabel,
  SESSION_EXPIRED,
  sourceWithBatch,
  triggerLabel,
  type IngestRun,
} from "./ingestion-copy";

// 실행 상세 서랍(N8 스펙 §4.7·§4.12, D1·D2). 같은 화면 오른쪽 480px 서랍이고 주소 ?run=<id> 가 연다(화면이 관리한다).
// 열면 GET /runs/:id 를 읽고, 그 run 이 실행 중이거나 아직 시작 전이면 목록 폴링과 같은 주기(tick)에 다시 읽는다.
// 오류는 errorCode 표(error-kind)로 중단 원인·격리·경고·기타 무리로 나눈다. 재시도는 횟수만 보인다(D4).

const PAGE_SIZE = 50;

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; run: IngestRun }
  | { kind: "not-started" }
  | { kind: "not-found" }
  | { kind: "error"; requestId?: string }
  | { kind: "denied"; status: 401 | 403 };

// 다시 읽은 결과를 지금 상태에 반영한다. 이미 보이는 내용이 있으면 일시 실패(5xx·네트워크)로 지우지 않는다.
function nextState(prev: DetailState, outcome: RunOutcome, accepted: boolean): DetailState {
  switch (outcome.kind) {
    case "ok":
      return { kind: "ready", run: outcome.run };
    case "not-found":
      return accepted ? { kind: "not-started" } : { kind: "not-found" };
    case "denied":
      return { kind: "denied", status: outcome.status };
    case "failed":
      if (prev.kind === "ready" || prev.kind === "not-started") return prev;
      return outcome.requestId === undefined
        ? { kind: "error" }
        : { kind: "error", requestId: outcome.requestId };
  }
}

const isFollowing = (state: DetailState): boolean =>
  state.kind === "not-started" || (state.kind === "ready" && state.run.status === "RUNNING");

export function IngestRunDrawer({
  open,
  runId,
  acceptedRun,
  tick,
  onClose,
  onReload,
}: {
  open: boolean;
  /** 보이는 run id(주소 값). 닫히는 동안에도 마지막 값을 넘겨 내용이 사라지지 않게 한다. */
  runId: string | null;
  /** 이 화면에서 접수한 run 이면 202 본문. 404 를 "아직 시작 전"으로 읽는다. */
  acceptedRun: IngestRun | null;
  /** 목록 폴링이 첫 쪽을 읽은 횟수. 바뀔 때 실행 중·시작 전 run 을 다시 읽는다. */
  tick: number;
  onClose: () => void;
  onReload: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* 근거 서랍(EvidenceDrawer)과 같은 폭 덮어쓰기. 지원 폭(1280 이상)에서 480px 이다. */}
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:max-w-full data-[side=right]:md:w-[480px] data-[side=right]:md:max-w-[480px]"
      >
        {runId !== null && (
          <RunDetail
            key={runId}
            runId={runId}
            acceptedRun={acceptedRun}
            tick={tick}
            onReload={onReload}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function RunDetail({
  runId,
  acceptedRun,
  tick,
  onReload,
}: {
  runId: string;
  acceptedRun: IngestRun | null;
  tick: number;
  onReload: () => void;
}) {
  const valid = isUuid(runId);
  const [state, setState] = useState<DetailState>(() =>
    valid ? { kind: "loading" } : { kind: "not-found" },
  );
  const [attempt, setAttempt] = useState(0);
  const accepted = acceptedRun !== null;

  // 처음 열 때와 [다시 시도]. UUID 모양이 아니면 요청하지 않는다(찾을 수 없음).
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    void readIngestionRun(runId, controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setState((prev) => nextState(prev, outcome, accepted));
    });
    return () => controller.abort();
  }, [runId, valid, attempt, accepted]);

  // 목록 폴링과 같은 주기에 다시 읽는다. 끝난 run 은 다시 읽지 않는다(따로 타이머를 두지 않는다).
  const following = isFollowing(state);
  const lastTick = useRef(tick);
  useEffect(() => {
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    if (!following) return;
    const controller = new AbortController();
    void readIngestionRun(runId, controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setState((prev) => nextState(prev, outcome, accepted));
    });
    return () => controller.abort();
  }, [tick, following, runId, accepted]);

  const run = state.kind === "ready" ? state.run : null;
  const title = valid ? `수집 실행 ${shortRunId(runId)}` : "수집 실행";
  const description =
    run !== null
      ? `${sourceWithBatch(run)} · ${runModeLabel(run.runMode)}`
      : acceptedRun !== null
        ? `${sourceWithBatch(acceptedRun)} · ${runModeLabel(acceptedRun.runMode)}`
        : "수집 실행 기록";

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-4 pb-4">
        <DetailBody
          state={state}
          acceptedRun={acceptedRun}
          onRetry={() => {
            setState({ kind: "loading" });
            setAttempt((value) => value + 1);
          }}
          onReload={onReload}
        />
      </div>
    </>
  );
}

function DetailBody({
  state,
  acceptedRun,
  onRetry,
  onReload,
}: {
  state: DetailState;
  acceptedRun: IngestRun | null;
  onRetry: () => void;
  onReload: () => void;
}) {
  switch (state.kind) {
    case "loading":
      return <DetailSkeleton />;
    case "ready":
      return <RunDetailView run={state.run} />;
    case "not-started":
      return <NotStarted run={acceptedRun} />;
    case "not-found":
      return (
        <p role="alert" className="type-body text-foreground">
          수집 실행을 찾을 수 없습니다. 주소가 맞는지 확인하세요.
        </p>
      );
    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="type-body text-foreground">불러오지 못했습니다</p>
          {state.requestId !== undefined && (
            <p className="font-mono type-caption wrap-anywhere text-muted-foreground">
              요청 ID {state.requestId}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
            다시 시도
          </Button>
        </div>
      );
    case "denied":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="type-body text-foreground">
            {state.status === 401 ? SESSION_EXPIRED : ACCESS_LOST}
          </p>
          {state.status === 401 ? (
            <Link
              href={LOGIN_PATH}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              로그인
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              새로 고침
            </Button>
          )}
        </div>
      );
  }
}

function DetailSkeleton() {
  const pulse = "motion-reduce:animate-none";
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">수집 실행을 불러오는 중…</span>
      <div aria-hidden className="contents">
        <Skeleton className={`h-5 w-28 ${pulse}`} />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, key) => (
            <Skeleton key={key} className={`h-5 w-full ${pulse}`} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, key) => (
            <Skeleton key={key} className={`h-12 ${pulse}`} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, key) => (
            <Skeleton key={key} className={`h-10 w-full ${pulse}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NotStarted({ run }: { run: IngestRun | null }) {
  return (
    <div className="flex flex-col gap-4">
      <StatusBadge kind="ingestRun" value="PENDING" />
      <p className="type-body text-foreground">
        수집 작업이 아직 시작되지 않았습니다. 시작되면 여기에 표시됩니다.
      </p>
      {run !== null && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="type-label text-muted-foreground">요청 시각</dt>
          <dd className="type-body tabular-nums">
            <time dateTime={run.startedAt} title={run.startedAt}>
              {formatKstSeconds(run.startedAt)}
            </time>
          </dd>
          <dt className="type-label text-muted-foreground">방식</dt>
          <dd className="type-body">{triggerLabel(run, true)}</dd>
        </dl>
      )}
    </div>
  );
}

const quotaText = (run: IngestRun): string =>
  run.source === "fixture"
    ? `${run.quotaUsed}회 (fixture는 공공 API를 부르지 않습니다)`
    : `${run.quotaUsed}회`;

function RunDetailView({ run }: { run: IngestRun }) {
  const groups = groupErrorsByKind(run.errors);
  const duration = formatDuration(run.startedAt, run.finishedAt);
  const quota = quotaCauseOf(run.errors);
  const { summary } = run;
  return (
    <>
      <div className="flex flex-col items-start gap-2">
        <StatusBadge kind="ingestRun" value={run.status} quarantined={summary.quarantined} />
        {quota !== null && <p className="type-body text-destructive">{QUOTA_CAUSE_TEXT[quota]}</p>}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="type-label text-muted-foreground">시작</dt>
        <dd className="type-body tabular-nums">
          <time dateTime={run.startedAt} title={run.startedAt}>
            {formatKstSeconds(run.startedAt)}
          </time>
        </dd>
        <dt className="type-label text-muted-foreground">종료</dt>
        <dd className="type-body tabular-nums">
          {run.finishedAt === null || run.status === "RUNNING" ? (
            "실행 중"
          ) : (
            <>
              <time dateTime={run.finishedAt} title={run.finishedAt}>
                {formatKstSeconds(run.finishedAt)}
              </time>
              {duration !== null && ` (${duration})`}
            </>
          )}
        </dd>
        <dt className="type-label text-muted-foreground">방식</dt>
        <dd className="type-body wrap-anywhere">{triggerLabel(run, true)}</dd>
        <dt className="type-label text-muted-foreground">공공 API 호출</dt>
        <dd className="type-body tabular-nums">{quotaText(run)}</dd>
      </dl>

      <dl className="grid grid-cols-2 gap-x-4 md:grid-cols-3 gap-y-4 rounded-lg border border-border p-4">
        <SummaryCell label="신규" value={summary.created} />
        <SummaryCell label="변경" value={summary.changed} note="새 revision" />
        <SummaryCell label="취소" value={summary.cancelled} />
        <SummaryCell
          label="중복"
          value={summary.skippedDuplicate}
          note="같은 내용 재수신, 저장 안 함"
        />
        <SummaryCell label="격리" value={summary.quarantined} />
        <SummaryCell label="재시도" value={summary.retried} />
      </dl>

      {summary.changed + summary.cancelled > 0 && (
        <p className="type-label text-muted-foreground">{REANALYZE_HINT}</p>
      )}

      {groups.FAILURE.length > 0 && (
        <ErrorGroup
          kind="FAILURE"
          title="수집 중단 원인"
          description="이 오류로 수집을 멈췄습니다. 이미 적재한 공고는 그대로 둡니다."
          errors={groups.FAILURE}
        />
      )}
      <ErrorGroup
        kind="QUARANTINE"
        title={`격리 ${groups.QUARANTINE.length}건`}
        description="필수 정보가 없거나 형식이 틀려 적재하지 않았습니다. 공고 목록에 나오지 않습니다."
        errors={groups.QUARANTINE}
        empty="격리한 레코드가 없습니다"
      />
      {summary.retried > 0 && (
        <section className="flex flex-col gap-2">
          <GroupHeading icon={RefreshCwIcon} tone="text-muted-foreground">
            재시도 {summary.retried}회
          </GroupHeading>
          <p className="type-label text-muted-foreground">
            429 응답은 서버가 정한 대기 시간(Retry-After)을 지킨 뒤 다시 요청합니다.
          </p>
        </section>
      )}
      {groups.WARNING.length > 0 && (
        <ErrorGroup
          kind="WARNING"
          title={`경고 ${groups.WARNING.length}건 · 적재함`}
          description="일부 값을 읽지 못했지만 공고는 적재했습니다. 해당 값은 비어 있습니다."
          errors={groups.WARNING}
        />
      )}
      {groups.OTHER.length > 0 && (
        <ErrorGroup
          kind="OTHER"
          title={`그 밖의 오류 ${groups.OTHER.length}건`}
          description="분류하지 않은 수집 오류입니다. 코드와 상세를 확인하세요."
          errors={groups.OTHER}
        />
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-border pt-4 font-mono type-caption text-muted-foreground">
        <dt>실행 id</dt>
        <dd className="wrap-anywhere">{run.id}</dd>
        <dt>체크포인트</dt>
        <dd className="wrap-anywhere">{run.cursor ?? "—"}</dd>
      </dl>
    </>
  );
}

function SummaryCell({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className={cn("type-heading tabular-nums", value === 0 && "text-muted-foreground")}>
        {value.toLocaleString("ko-KR")}
      </dd>
      {note !== undefined && <dd className="type-caption text-muted-foreground">{note}</dd>}
    </div>
  );
}

const GROUP_ICON = {
  FAILURE: { icon: OctagonAlertIcon, tone: "text-destructive" },
  QUARANTINE: { icon: TriangleAlertIcon, tone: "text-warning" },
  WARNING: { icon: CircleAlertIcon, tone: "text-muted-foreground" },
  OTHER: { icon: CircleAlertIcon, tone: "text-muted-foreground" },
} as const satisfies Record<IngestErrorKind, { icon: LucideIcon; tone: string }>;

function GroupHeading({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-2 type-heading text-foreground">
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone)} />
      {children}
    </h3>
  );
}

function ErrorGroup({
  kind,
  title,
  description,
  errors,
  empty,
}: {
  kind: IngestErrorKind;
  title: string;
  description: string;
  errors: IngestRunError[];
  /** 0건일 때 목록 대신 보일 글자. 없으면 쓰는 쪽이 무리를 그리지 않는다. */
  empty?: string;
}) {
  // live run 의 경고가 수백 건일 수 있다. 응답은 이미 다 받았으므로 그리는 줄 수만 50개씩 늘린다.
  const [shown, setShown] = useState(PAGE_SIZE);
  const { icon, tone } = GROUP_ICON[kind];
  const rest = errors.length - shown;
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading icon={icon} tone={tone}>
        {title}
      </GroupHeading>
      {errors.length === 0 && empty !== undefined ? (
        <p className="type-body text-muted-foreground">{empty}</p>
      ) : (
        <>
          <p className="type-label text-muted-foreground">{description}</p>
          <ul className="divide-y divide-border border-y border-border">
            {errors.slice(0, shown).map((error, index) => (
              <ErrorRow
                key={`${error.sourceKey}-${error.errorCode}-${index}`}
                kind={kind}
                error={error}
              />
            ))}
          </ul>
          {rest > 0 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => setShown((value) => value + PAGE_SIZE)}
            >
              {rest.toLocaleString("ko-KR")}건 더 보기
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// 중단·기타는 원인(라벨 + 코드)이 먼저, 격리·경고는 공고 식별(sourceKey)이 먼저다(§4.7 행 모양).
// detail·sourceKey 는 글자로만 그린다(HTML 로 해석하지 않는다). 서비스키는 서버가 이미 가렸다.
function ErrorRow({ kind, error }: { kind: IngestErrorKind; error: IngestRunError }) {
  const label = errorCodeLabel(error.errorCode);
  const cause = (
    <p className={cn("type-body", kind === "FAILURE" ? "text-destructive" : "text-foreground")}>
      {label} <span className="font-mono">{error.errorCode}</span>
      {error.resultCode !== null && (
        <span className="text-muted-foreground"> · 결과 코드 {error.resultCode}</span>
      )}
    </p>
  );
  const sourceKey = (
    <p className="font-mono type-label wrap-anywhere text-foreground">{error.sourceKey}</p>
  );
  const recordFirst = kind === "QUARANTINE" || kind === "WARNING";
  return (
    <li className="flex flex-col gap-0.5 py-2.5">
      {recordFirst ? sourceKey : cause}
      {recordFirst ? cause : sourceKey}
      {error.detail !== "" && (
        <p className="font-mono type-caption wrap-anywhere text-muted-foreground">{error.detail}</p>
      )}
    </li>
  );
}
