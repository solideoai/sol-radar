import type { RunMode } from "@/server/bids";
import { acceptsSource, type IngestRun } from "./ingestion-copy";

// 이력 표·상태 줄·머리 단추가 함께 쓰는 계산(N8 스펙 §4.3·§4.5·§4.8, D9·D15). 상태를 바꾸지 않는 순수 함수만 둔다.

// worker 가 행을 만들기를 기다리는 시간(§4.3 "접수 뒤 60초"), 오래 걸리는 run 경고(§4.10 "시작 30분")
export const WORKER_START_GRACE_MS = 60_000;
export const STALE_RUN_MS = 30 * 60_000;

/** 이 화면에서 POST 202 로 접수한 run. 행은 worker 가 만든다. 목록에 나타나기 전까지는 "접수됨" 행으로 보인다. */
export type AcceptedRun = { run: IngestRun; acceptedAt: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export const isRunning = (run: IngestRun): boolean => run.status === "RUNNING";

// 목록 순서는 서버 keyset 과 같다(started_at desc, id desc).
const byNewest = (a: IngestRun, b: IngestRun): number =>
  Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * 새로 읽은 run(fresh)을 갖고 있던 run(known)에 반영한다. 같은 id 는 새 값으로 바꾸고, 새 id 는 더하고,
 * fresh 에 없는 known 은 버리지 않는다. 결과는 최근 것이 위다.
 */
export function upsertRuns(known: readonly IngestRun[], fresh: readonly IngestRun[]): IngestRun[] {
  const freshIds = new Set(fresh.map((run) => run.id));
  return [...fresh, ...known.filter((run) => !freshIds.has(run.id))].toSorted(byNewest);
}

/**
 * 표에 보일 행: 화면이 들고 있는 행(서버 첫 쪽 + 더 보기)에 폴링으로 읽은 run 을 겹친다(폴링 값이 이긴다).
 * 폴링 첫 쪽에서 밀려난 행·더 보기로 붙인 행도 버리지 않는다(§4.5).
 */
export const mergeRuns = (polled: readonly IngestRun[], rows: readonly IngestRun[]): IngestRun[] =>
  polled.length === 0 ? [...rows] : upsertRuns(rows, polled);

const byStartedDesc = (a: { startedAt: string }, b: { startedAt: string }): number =>
  Date.parse(b.startedAt) - Date.parse(a.startedAt);

/** 접수했지만 아직 목록에 없는 run(최근 것이 위). 같은 id 가 목록에 나타나면 그 행으로 바뀐다. */
export function pendingRuns(
  accepted: readonly AcceptedRun[],
  rows: readonly IngestRun[],
): AcceptedRun[] {
  const listed = new Set(rows.map((run) => run.id));
  return accepted
    .filter((entry) => !listed.has(entry.run.id))
    .toSorted((a, b) => byStartedDesc(a.run, b.run));
}

/**
 * 머리 [수동 수집 실행]을 막을지(D9). 지금 실행 모드에서 돌릴 수 있는 소스의 run 이 실행 중이거나 접수 행이 있으면 막는다.
 * 다른 소스의 RUNNING(모드가 바뀌기 전에 남은 run)은 새 요청을 막지 않는다. 최종 판정은 서버 409 INGESTION_IN_PROGRESS 다.
 */
export function isRunBlocked(
  rows: readonly IngestRun[],
  pending: readonly AcceptedRun[],
  runMode: RunMode,
): boolean {
  return (
    pending.length > 0 || rows.some((run) => isRunning(run) && acceptsSource(runMode, run.source))
  );
}

/** 폴링을 멈춰도 되는지: 첫 쪽에 실행 중이 없고, 접수한 run 이 모두 목록에 나타났다. */
export function isSettled(firstPage: readonly IngestRun[], unseenAccepted: readonly string[]) {
  const listed = new Set(firstPage.map((run) => run.id));
  return !firstPage.some(isRunning) && unseenAccepted.every((id) => listed.has(id));
}

export type StatusLineModel =
  | { kind: "pending"; entry: AcceptedRun; others: number; overdue: boolean }
  | { kind: "running"; run: IngestRun; others: number; stale: boolean }
  | { kind: "finished"; run: IngestRun };

type Active =
  | { kind: "pending"; entry: AcceptedRun; startedAt: string }
  | { kind: "running"; run: IngestRun; startedAt: string };

/**
 * 상태 줄에 보일 run(§4.3). 진행 중(접수 행 + 실행 중)이 있으면 가장 최근 것과 나머지 수,
 * 없으면 이 화면이 지켜보던(접수했거나 실행 중으로 본) run 중 끝난 가장 최근 것. 둘 다 없으면 null 이다.
 * now 는 마지막으로 상태를 확인한 시각이다(렌더 중에 시계를 읽지 않는다).
 */
export function statusLineOf({
  rows,
  pending,
  watched,
  now,
}: {
  rows: readonly IngestRun[];
  pending: readonly AcceptedRun[];
  watched: ReadonlySet<string>;
  now: number;
}): StatusLineModel | null {
  const active: Active[] = [
    ...pending.map((entry) => ({
      kind: "pending" as const,
      entry,
      startedAt: entry.run.startedAt,
    })),
    ...rows
      .filter(isRunning)
      .map((run) => ({ kind: "running" as const, run, startedAt: run.startedAt })),
  ].toSorted(byStartedDesc);
  const [latest] = active;
  const others = active.length - 1;
  if (latest?.kind === "pending")
    return {
      kind: "pending",
      entry: latest.entry,
      others,
      overdue: now - latest.entry.acceptedAt >= WORKER_START_GRACE_MS,
    };
  if (latest?.kind === "running")
    return {
      kind: "running",
      run: latest.run,
      others,
      stale: now - Date.parse(latest.run.startedAt) > STALE_RUN_MS,
    };
  const finished = rows.find((run) => watched.has(run.id) && !isRunning(run));
  return finished === undefined ? null : { kind: "finished", run: finished };
}

/** 지켜볼 run id 에 이번에 실행 중으로 본 run 을 더한다. 바뀐 것이 없으면 같은 집합을 돌려준다(다시 그리지 않게). */
export function watchRunning(
  watched: ReadonlySet<string>,
  runs: readonly IngestRun[],
): ReadonlySet<string> {
  const fresh = runs.filter((run) => isRunning(run) && !watched.has(run.id)).map((run) => run.id);
  return fresh.length === 0 ? watched : new Set([...watched, ...fresh]);
}
