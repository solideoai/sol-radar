"use client";

import { DatabaseIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppPage } from "@/components/app-page";
import { refreshTopbarStatus } from "@/components/topbar-status";
import { Button } from "@/components/ui/button";
import type { RunMode } from "@/server/bids";
import type { SourceSummary } from "@/server/opportunities";
import { IngestionServices } from "./ingestion-services";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { LoadMoreFooter, useLoadMore } from "@/app/(app)/(work)/load-more";
import { IngestRunDrawer } from "./ingest-run-drawer";
import { IngestRunTable, toTableRows } from "./ingest-run-table";
import {
  isRunBlocked,
  isRunning,
  isSettled,
  mergeRuns,
  pendingRuns,
  statusLineOf,
  upsertRuns,
  watchRunning,
  type AcceptedRun,
} from "./ingest-runs";
import { IngestStatusLine } from "./ingest-status-line";
import {
  ACCESS_LOST,
  EMPTY_DESCRIPTION,
  EMPTY_TITLE,
  GATE_CHECKING_LABEL,
  GATE_UNKNOWN_NOTICE,
  INGESTION_DESCRIPTION,
  INGESTION_PATH,
  INGESTION_TITLE,
  RUN_BUTTON_BUSY_HINT,
  RUN_BUTTON_LABEL,
  RUNS_ENDPOINT,
  SESSION_EXPIRED,
  type IngestRun,
} from "./ingestion-copy";
import { LiveIngestControl } from "./live-ingest-control";
import { liveControlViewOf } from "./manual-gate";
import { RunIngestDialog } from "./run-ingest-dialog";
import { useIngestPolling } from "./use-ingest-polling";
import { useManualGate, type GateState } from "./use-manual-gate";

// /admin/ingestion 본문(N8 스펙 §4.1): 머리 → 실행 상태 줄 → 실행 이력 표 + 더 보기. 실행 상세는 오른쪽 서랍(?run=<id>).
// 소스별 카드(§4.4, D3)는 이번 단계에 넣지 않는다.
// 행은 세 곳에서 온다: 서버가 그린 첫 쪽 + 더 보기(useLoadMore), 폴링으로 읽은 run(polled), 이 화면이 접수한 run(accepted).
// 머리 단추(10-26): 판정(GET manual-gate)의 수집 모드가 live 면 [지금 불러오기] 한 번 클릭, 아니면(fixture·mock 데모,
// 판정 403·503·없음) 지금까지의 [수동 수집 실행] 대화상자다. 판정을 읽는 동안은 막아 둔다.

const RUN_PARAM = "run";

type IngestionViewProps = {
  runMode: RunMode;
  initialItems: IngestRun[];
  initialNextCursor: string | null;
  /** 서버가 첫 쪽을 읽은 시각(ISO). 상태 줄 시간 계산의 첫 기준이다. */
  now: string;
  sources: SourceSummary;
};

export function IngestionView({
  runMode,
  initialItems,
  initialNextCursor,
  now,
  sources,
}: IngestionViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const more = useLoadMore({ endpoint: RUNS_ENDPOINT, initialItems, initialNextCursor });

  // 폴링으로 읽은 run(최신 값). 첫 쪽에서 밀려나도 버리지 않는다. 서버가 첫 쪽을 새로 주면(router.refresh) 비운다.
  const [polled, setPolled] = useState<IngestRun[]>([]);
  const [accepted, setAccepted] = useState<AcceptedRun[]>([]);
  // 이 화면이 지켜본 run(실행 중으로 봤거나 접수한 것). 끝나면 상태 줄이 결과를 알린다.
  const [watched, setWatched] = useState<ReadonlySet<string>>(
    () => new Set(initialItems.filter(isRunning).map((run) => run.id)),
  );
  const [firstPage, setFirstPage] = useState(initialItems);
  if (firstPage !== initialItems) {
    setFirstPage(initialItems);
    setPolled([]);
    setWatched((prev) => watchRunning(prev, initialItems));
  }

  const rows = useMemo(() => mergeRuns(polled, more.items), [polled, more.items]);
  const pending = useMemo(() => pendingRuns(accepted, rows), [accepted, rows]);
  const tableRows = useMemo(() => toTableRows(pending, rows), [pending, rows]);

  // 수동 불러오기 판정. 실수집인지는 화면의 runMode(웹의 SOL_RUN_MODE)가 아니라 판정의 수집 모드로 안다.
  const gate = useManualGate();
  const liveGate =
    gate.state.phase === "ready" && gate.state.gate.ingestMode === "live" ? gate.state : null;
  const isLive = liveGate !== null;
  const ingestMode: RunMode = isLive ? "live" : runMode;
  // 지켜본 수집이 끝날 때마다 오른다. [지금 불러오기] 곁의 지난 거절 문구를 지운다.
  const [settledCount, setSettledCount] = useState(0);

  const polling = useIngestPolling({
    active: initialItems.some(isRunning),
    initialCheckedAt: now,
    onPage: (items) => {
      setPolled((prev) => upsertRuns(prev, items));
      setWatched((prev) => watchRunning(prev, items));
    },
    isSettled: (items) =>
      isSettled(
        items,
        pending.map((entry) => entry.run.id),
      ),
    // 상단바 "수집 N분 전"과 판정(다음 불러오기 가능 시각)을 바로 다시 읽는다.
    // 실수집이면 서비스별 수집 현황도 서버가 다시 그린다(더 보기로 붙인 행은 첫 쪽부터 다시 시작한다).
    // 데모(fixture)는 다시 그릴 것이 없어 그리지 않는다(더 보기로 붙인 행을 지킨다).
    onSettled: () => {
      void refreshTopbarStatus();
      gate.refresh();
      setSettledCount((value) => value + 1);
      if (isLive) router.refresh();
    },
  });

  // ── 서랍: 주소 ?run=<id> 가 정본이다. 열 때는 기록을 더해(뒤로 가기로 닫힌다) 서버를 다시 부르지 않는다. ──
  const drawerRunId = searchParams.get(RUN_PARAM);
  // 닫히는 동안 내용이 사라지지 않게 마지막으로 연 id 를 남긴다.
  const [shownRunId, setShownRunId] = useState(drawerRunId);
  if (drawerRunId !== null && drawerRunId !== shownRunId) setShownRunId(drawerRunId);
  // 이 화면에서 기록을 더해 열었으면 닫을 때 그 기록을 되돌린다. 주소로 바로 들어왔으면 지금 기록에서 run 만 지운다.
  const pushedRef = useRef(false);

  const searchWith = (runId: string | null): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (runId === null) params.delete(RUN_PARAM);
    else params.set(RUN_PARAM, runId);
    const search = params.toString();
    return search === "" ? INGESTION_PATH : `${INGESTION_PATH}?${search}`;
  };
  const openRun = (runId: string) => {
    window.history.pushState(null, "", searchWith(runId));
    pushedRef.current = true;
  };
  const closeRun = () => {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", searchWith(null));
  };
  const acceptedRun =
    shownRunId === null
      ? null
      : (accepted.find((entry) => entry.run.id === shownRunId)?.run ?? null);

  // ── 수동 수집 ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const blocked = isRunBlocked(rows, pending, ingestMode);
  const busyHintId = useId();
  const ownRunIds = useMemo(() => new Set(accepted.map((entry) => entry.run.id)), [accepted]);
  const liveView =
    liveGate === null
      ? null
      : liveControlViewOf({
          gate: liveGate.gate,
          checkedAt: liveGate.checkedAt,
          inProgress: blocked,
          ownRunIds,
          rows,
        });

  const onAccepted = (run: IngestRun) => {
    const acceptedAt = Date.now();
    // 같은 키를 다시 보내 같은 run 을 돌려받으면(멱등 재현) 행을 하나만 둔다.
    setAccepted((prev) =>
      prev.some((entry) => entry.run.id === run.id) ? prev : [...prev, { run, acceptedAt }],
    );
    setWatched((prev) => new Set([...prev, run.id]));
    polling.start();
  };
  const watchRun = (runId: string) => {
    setWatched((prev) => new Set([...prev, runId]));
    polling.start();
  };
  const showRunning = (runId: string) => {
    watchRun(runId);
    openRun(runId);
  };

  // 다음 쪽을 붙이면 초점을 새로 붙은 첫 행의 시작 단추로 옮긴다(bid-list-more 와 같다).
  // 폴링으로 행이 다시 그려질 때는 옮기지 않는다. 쪽이 붙은 때 한 번만이다.
  const tableRef = useRef<HTMLDivElement>(null);
  const focusedAppend = useRef<string | null>(null);
  const appendedId =
    more.appendedFrom === null ? null : (more.items[more.appendedFrom]?.id ?? null);
  useEffect(() => {
    if (appendedId === null || focusedAppend.current === appendedId) return;
    focusedAppend.current = appendedId;
    const index = tableRows.findIndex((item) => item.run.id === appendedId);
    const row = tableRef.current?.querySelectorAll<HTMLElement>("tbody tr")[index];
    row?.querySelector<HTMLElement>("button")?.focus();
  }, [appendedId, tableRows]);

  const statusModel = statusLineOf({ rows, pending, watched, now: polling.checkedAt });
  const isEmpty = tableRows.length === 0;

  return (
    <AppPage
      title={INGESTION_TITLE}
      description={INGESTION_DESCRIPTION}
      contentClassName="max-w-360"
      actions={
        gate.state.phase === "loading" ? (
          // 판정을 읽는 동안은 어느 흐름인지 몰라 막아 둔다.
          // focusableWhenDisabled 는 native disabled 가 없어 Button 의 disabled: 흐림이 안 걸린다. data-disabled 로 흐린다.
          <Button type="button" className="data-disabled:opacity-50" disabled focusableWhenDisabled>
            {GATE_CHECKING_LABEL}
          </Button>
        ) : liveGate !== null && liveView !== null ? (
          <LiveIngestControl
            view={liveView}
            gateCheckedAt={liveGate.checkedAt}
            buttonRef={runButtonRef}
            settledCount={settledCount}
            onAccepted={onAccepted}
            onWatchRun={watchRun}
            onShowRun={showRunning}
            onGateRefresh={gate.refresh}
            onReload={() => router.refresh()}
          />
        ) : (
          <div className="flex flex-col items-end gap-1">
            {/* 실행 중에도 초점을 잃지 않게 disabled 대신 focusableWhenDisabled 로 막는다(대화상자가 닫힌 뒤 초점이 돌아온다). */}
            <Button
              ref={runButtonRef}
              type="button"
              className="data-disabled:opacity-50"
              disabled={blocked}
              focusableWhenDisabled
              aria-haspopup="dialog"
              aria-describedby={blocked ? busyHintId : undefined}
              onClick={() => {
                if (!blocked) setDialogOpen(true);
              }}
            >
              {RUN_BUTTON_LABEL}
            </Button>
            {blocked && (
              <p id={busyHintId} className="type-caption text-muted-foreground">
                {RUN_BUTTON_BUSY_HINT}
              </p>
            )}
            <GateFallbackNotice state={gate.state} />
          </div>
        )
      }
    >
      <IngestStatusLine
        model={statusModel}
        poll={polling.state}
        onOpenRun={openRun}
        onRecheck={polling.start}
        onReload={() => router.refresh()}
      />

      <IngestionServices summary={sources} runMode={runMode} onAccepted={onAccepted} />
      <section aria-labelledby="ingest-history-title" className="flex flex-col gap-3">
        <h2 id="ingest-history-title" className="type-heading text-foreground">
          실행 이력
        </h2>
        {/* 쪽이 붙거나 접수 행이 생긴 것을 건수로만 알린다. 상태 변화는 위 상태 줄이 알린다. */}
        <p role="status" className="type-label text-muted-foreground">
          수집 실행 {tableRows.length}건 표시
        </p>
        {isEmpty ? (
          <EmptyState
            icon={DatabaseIcon}
            title={EMPTY_TITLE}
            description={EMPTY_DESCRIPTION}
            action={
              // 실수집은 머리 [지금 불러오기] 하나로 부른다(같은 일을 하는 단추를 둘 두지 않는다).
              isLive || gate.state.phase === "loading" ? undefined : (
                <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
                  {RUN_BUTTON_LABEL}
                </Button>
              )
            }
          />
        ) : (
          <div ref={tableRef}>
            <IngestRunTable
              items={tableRows}
              onOpen={openRun}
              footer={
                <LoadMoreFooter
                  status={more.status}
                  hasNext={more.hasNext}
                  onLoadMore={() => void more.loadMore()}
                  onRestart={() => router.push(INGESTION_PATH)}
                />
              }
            />
          </div>
        )}
      </section>

      <RunIngestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        runMode={runMode}
        finalFocus={runButtonRef}
        onAccepted={onAccepted}
        onShowRun={showRunning}
      />
      <IngestRunDrawer
        open={drawerRunId !== null}
        runId={shownRunId}
        acceptedRun={acceptedRun}
        tick={polling.tick}
        onClose={closeRun}
        onReload={() => router.refresh()}
      />
    </AppPage>
  );
}

// 판정을 읽지 못해 대화상자 흐름으로 돌아왔을 때의 한 줄. 데모(수집 모드 fixture·mock)나 판정 주소가 없는 서버는 조용히 둔다.
function GateFallbackNotice({ state }: { state: GateState }) {
  const text =
    state.phase === "denied"
      ? state.status === 401
        ? SESSION_EXPIRED
        : ACCESS_LOST
      : state.phase === "unavailable" || state.phase === "failed"
        ? GATE_UNKNOWN_NOTICE
        : null;
  if (text === null) return null;
  return <p className="type-caption text-muted-foreground">{text}</p>;
}
