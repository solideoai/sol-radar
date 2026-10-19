"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { refreshTopbarStatus } from "@/components/topbar-status";
import type { Recommendation } from "@/server/bids";
import {
  failureOf,
  isRecord,
  JSON_HEADERS,
  NETWORK_ERROR,
  NETWORK_MESSAGE,
  readJson,
  type ApiFailure,
} from "./api-envelope";

// 분석 실행과 결과 polling(스펙 §5.4.2 분석 실행 흐름, 06 §7).
// - 클릭마다 새 Idempotency-Key(UUID)를 만든다. 네트워크 오류는 같은 키로 한 번만 다시 보낸다(서버가 같은 요청으로 알아본다).
// - 202 면 pollUrl 을 60초 동안 2초, 그 뒤 5초 간격으로 읽고, 300초가 지나면 지연(delayed)으로 멈춘다.
// - 끝나면(COMPLETED·PARTIAL·FAILED) 서버가 다시 그리게 한다. PARTIAL·FAILED 면 상단바 AI 지표도 바로 다시 읽는다(D4).
// - 401·403·404 는 다시 읽어도 같으므로 멈추고 오류로 둔다. 진행 중에는 start 를 무시하고, 화면을 떠나면 모두 멈춘다.

export const POLL_FAST_MS = 2_000;
export const POLL_SLOW_MS = 5_000;
export const POLL_FAST_WINDOW_MS = 60_000;
export const POLL_LIMIT_MS = 300_000;

type ActiveStatus = "QUEUED" | "RUNNING";
type FinalStatus = "COMPLETED" | "PARTIAL" | "FAILED";

/** 서버가 그린 최신 분석이 아직 진행 중이면 그 run. 화면을 열거나 새로 고친 뒤 이어서 읽는다. */
export type ActiveRun = { id: string; status: ActiveStatus };

/** 방금 끝난 run 의 요약. 상태 안내 문장("분석이 끝났습니다. SOL Score 72, 권고 WATCH")에 쓴다. */
export type FinishedRun = {
  status: FinalStatus;
  solScore: number | null;
  recommendation: Recommendation | null;
};

export type RunState =
  | { phase: "idle"; finished?: FinishedRun }
  | { phase: "requesting" }
  | { phase: "polling"; status: ActiveStatus; delayed: boolean }
  | { phase: "error"; code: string; message: string; requestId?: string };

export const DEDUPLICATED_TOAST = "같은 입력으로 끝난 분석을 보여 줍니다";

// 다시 읽어도 결과가 바뀌지 않는 응답. 그 밖의 실패(429·5xx·네트워크)는 다음 간격에 다시 읽는다.
const STOP_STATUSES: readonly number[] = [401, 403, 404];

// 요청 한 번과 그 polling. 화면을 떠나거나 새로 고치면 cancelled 가 되어 늦게 온 결과를 버린다.
type Ticket = {
  cancelled: boolean;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
};

const newTicket = (): Ticket => ({
  cancelled: false,
  controller: new AbortController(),
  timer: null,
});

const isActive = (value: unknown): value is ActiveStatus =>
  value === "QUEUED" || value === "RUNNING";
const isFinal = (value: unknown): value is FinalStatus =>
  value === "COMPLETED" || value === "PARTIAL" || value === "FAILED";
const isRecommendation = (value: unknown): value is Recommendation =>
  value === "BID" || value === "WATCH" || value === "NO_BID";

function finishedOf(status: FinalStatus, body: unknown): FinishedRun {
  const record = isRecord(body) ? body : {};
  return {
    status,
    solScore: typeof record.solScore === "number" ? record.solScore : null,
    recommendation: isRecommendation(record.recommendation) ? record.recommendation : null,
  };
}

const pollUrlOf = (id: string) => `/api/v1/analyses/${encodeURIComponent(id)}`;
// 서버가 준 pollUrl 은 같은 서버의 분석 주소일 때만 따른다.
const safePollUrl = (url: unknown, id: string): string =>
  typeof url === "string" && url.startsWith("/api/v1/analyses/") ? url : pollUrlOf(id);

function wait(ticket: Ticket, ms: number): Promise<void> {
  return new Promise((resolve) => {
    ticket.timer = setTimeout(() => {
      ticket.timer = null;
      resolve();
    }, ms);
  });
}

export function useAnalysisRun(
  bidId: string,
  options: { active?: ActiveRun | null } = {},
): { state: RunState; start: (force: boolean) => Promise<void>; refresh: () => void } {
  const router = useRouter();
  const activeId = options.active?.id ?? null;
  const activeStatus = options.active?.status ?? null;
  const [state, setState] = useState<RunState>(() =>
    activeStatus === null
      ? { phase: "idle" }
      : { phase: "polling", status: activeStatus, delayed: false },
  );
  // 새로고침 뒤에도 서버가 같은 run 을 진행 중이라고 하면 다시 읽기 시작하게 하는 열쇠.
  const [resumeKey, setResumeKey] = useState(0);
  const ticketRef = useRef<Ticket | null>(null);

  const cancel = useCallback(() => {
    const ticket = ticketRef.current;
    if (ticket === null) return;
    ticket.cancelled = true;
    ticket.controller.abort();
    if (ticket.timer !== null) clearTimeout(ticket.timer);
    ticketRef.current = null;
  }, []);

  // 화면을 떠나면 타이머와 요청을 멈춘다.
  useEffect(() => cancel, [cancel]);

  const release = useCallback((ticket: Ticket) => {
    if (ticketRef.current === ticket) ticketRef.current = null;
  }, []);

  const fail = useCallback(
    (ticket: Ticket, failure: Pick<ApiFailure, "code" | "message" | "requestId">) => {
      release(ticket);
      setState({
        phase: "error",
        code: failure.code,
        message: failure.message,
        ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
      });
    },
    [release],
  );

  const finish = useCallback(
    (ticket: Ticket, status: FinalStatus, body: unknown, deduplicated: boolean) => {
      release(ticket);
      // 서버가 새로 그린 결과와 같은 때에 idle 로 바꾼다. 그 사이 지난 결과가 잠깐 다시 보이지 않게 한다.
      startTransition(() => {
        setState({ phase: "idle", finished: finishedOf(status, body) });
        router.refresh();
      });
      if (status !== "COMPLETED") void refreshTopbarStatus();
      if (deduplicated) toast(DEDUPLICATED_TOAST);
    },
    [release, router],
  );

  const poll = useCallback(
    async (ticket: Ticket, url: string, startedAt: number) => {
      for (;;) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= POLL_LIMIT_MS) {
          release(ticket);
          setState((prev) => ({
            phase: "polling",
            status: prev.phase === "polling" ? prev.status : "QUEUED",
            delayed: true,
          }));
          return;
        }
        await wait(ticket, elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS);
        if (ticket.cancelled) return;
        let response: Response;
        try {
          response = await fetch(url, {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: ticket.controller.signal,
          });
        } catch {
          // 잠깐 끊긴 것이면 다음 간격에 다시 읽는다. 떠나서 끊은 것이면 멈춘다.
          if (ticket.cancelled) return;
          continue;
        }
        const body = await readJson(response);
        if (ticket.cancelled) return;
        if (STOP_STATUSES.includes(response.status)) {
          fail(ticket, failureOf(response, body));
          return;
        }
        if (!response.ok) continue;
        const status = isRecord(body) ? body.status : undefined;
        if (isFinal(status)) {
          finish(ticket, status, body, false);
          return;
        }
        if (isActive(status)) {
          setState((prev) =>
            prev.phase === "polling" && prev.status === status && !prev.delayed
              ? prev
              : { phase: "polling", status, delayed: false },
          );
        }
      }
    },
    [fail, finish, release],
  );

  const follow = useCallback(
    (ticket: Ticket, url: string, status: ActiveStatus) => {
      setState({ phase: "polling", status, delayed: false });
      void poll(ticket, url, Date.now());
    },
    [poll],
  );

  const start = useCallback(
    async (force: boolean) => {
      if (ticketRef.current !== null) return;
      const ticket = newTicket();
      ticketRef.current = ticket;
      setState({ phase: "requesting" });
      const key = crypto.randomUUID();
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2 && response === null; attempt += 1) {
        try {
          response = await fetch(`/api/v1/bids/${encodeURIComponent(bidId)}/analyses`, {
            method: "POST",
            cache: "no-store",
            headers: { ...JSON_HEADERS, "Idempotency-Key": key },
            body: JSON.stringify({ force }),
            signal: ticket.controller.signal,
          });
        } catch {
          if (ticket.cancelled) return;
        }
      }
      if (ticket.cancelled) return;
      if (response === null) {
        fail(ticket, { code: NETWORK_ERROR, message: NETWORK_MESSAGE });
        return;
      }
      const body = await readJson(response);
      if (ticket.cancelled) return;
      if (response.ok && isRecord(body) && typeof body.analysisId === "string") {
        // 같은 입력으로 이미 끝난 분석이면(deduplicated) polling 없이 다시 그린다.
        if (isFinal(body.status)) {
          finish(ticket, body.status, null, body.deduplicated === true);
          return;
        }
        follow(
          ticket,
          safePollUrl(body.pollUrl, body.analysisId),
          isActive(body.status) ? body.status : "QUEUED",
        );
        return;
      }
      const failure = failureOf(response, body);
      // 같은 입력의 분석이 진행 중이면(force) 그 run 을 대신 읽는다(05 §5).
      const running =
        response.status === 409 && failure.code === "ANALYSIS_IN_PROGRESS"
          ? failure.details.analysisId
          : undefined;
      if (typeof running === "string") {
        follow(ticket, pollUrlOf(running), "QUEUED");
        return;
      }
      fail(ticket, failure);
    },
    [bidId, fail, finish, follow],
  );

  // 서버가 진행 중인 run 을 주면(다른 탭에서 시작했거나 새로 고친 경우) POST 없이 그 run 을 읽는다.
  useEffect(() => {
    if (activeId === null || ticketRef.current !== null) return;
    const ticket = newTicket();
    ticketRef.current = ticket;
    void poll(ticket, pollUrlOf(activeId), Date.now());
  }, [activeId, resumeKey, poll]);

  // 지연 배너의 [새로고침]: 지금 읽기를 멈추고 서버가 다시 그리게 한다. 아직 진행 중이면 위 effect 가 다시 읽기 시작한다.
  const refresh = useCallback(() => {
    cancel();
    startTransition(() => {
      setState({ phase: "idle" });
      setResumeKey((key) => key + 1);
      router.refresh();
    });
  }, [cancel, router]);

  return { state, start, refresh };
}
