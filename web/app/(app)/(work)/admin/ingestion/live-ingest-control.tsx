"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { requestIngestionRun } from "./ingestion-api";
import {
  LIVE_RUN_BUTTON_BUSY,
  LIVE_RUN_BUTTON_LABEL,
  SHOW_RUN_LABEL,
  type IngestRun,
} from "./ingestion-copy";
import type { LiveControlView } from "./manual-gate";
import { requestErrorOf, type RequestError } from "./request-errors";
import { ErrorAction } from "./run-ingest-dialog";

// 머리 [지금 불러오기](10-26 운영 전환). 수집 모드가 live 일 때 대화상자 없이 한 번에 POST {source:"g2b"} 를 보낸다.
// 창(window)을 보내지 않는다 — worker 가 직전 정기 수집 창 끝부터 지금까지 받는다. 클릭마다 새 Idempotency-Key 다.
// 접수(202) 뒤 흐름(접수 행·폴링·상태 줄·상단바 갱신)은 화면(ingestion-view)이 기존 수동 수집과 같이 한다.
// 거절(429·409·503)은 단추 곁에 오류로 두고 성공으로 보이지 않는다. 쿨다운·공유 run·하루 한도 거절은
// 판정을 다시 읽어 막힘이 풀리면(시각이 지나면) 저절로 사라진다.

const GATED_CODES: ReadonlySet<string> = new Set([
  "MANUAL_COOLDOWN",
  "MANUAL_SHARED_RUN",
  "MANUAL_DAILY_LIMIT",
]);

/** gateCheckedAt: 거절을 받았을 때 화면이 들고 있던 판정의 시각. 그 뒤에 읽은 판정이 막힘을 풀면 거절 문구를 내린다. */
type Failure = { error: RequestError; gated: boolean; gateCheckedAt: number };

export function LiveIngestControl({
  view,
  gateCheckedAt,
  buttonRef,
  settledCount,
  onAccepted,
  onWatchRun,
  onShowRun,
  onGateRefresh,
  onReload,
}: {
  view: LiveControlView;
  /** 지금 판정을 받은 때(ms). */
  gateCheckedAt: number;
  buttonRef: React.Ref<HTMLButtonElement>;
  /** 화면이 지켜본 수집이 끝날 때마다 오른다. 오르면 지난 거절 문구를 지운다. */
  settledCount: number;
  onAccepted: (run: IngestRun) => void;
  /** 거절이 알려 준 실행 중 run 을 목록 폴링으로 지켜본다(서랍은 열지 않는다). */
  onWatchRun: (runId: string) => void;
  onShowRun: (runId: string) => void;
  onGateRefresh: () => void;
  onReload: () => void;
}) {
  const id = useId();
  const [requesting, setRequesting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [seenSettled, setSeenSettled] = useState(settledCount);
  if (seenSettled !== settledCount) {
    setSeenSettled(settledCount);
    setFailure(null);
  }

  const blocked = requesting || view.blocked;
  // 판정으로 막는 거절(쿨다운·공유 run·하루 한도)은 그 뒤에 읽은 판정이 막힘을 풀면 내린다. 그 밖의 오류는 다음 클릭까지 남긴다.
  const released =
    failure !== null && failure.gated && gateCheckedAt > failure.gateCheckedAt && !view.blocked;
  const shownError = failure === null || released ? null : failure.error;

  // 다시 그리기 전에 두 번 눌러도 POST 는 하나만 보낸다. 두 번째가 나가면 서버가 429(쿨다운)로 거절해 접수 직후 오류가 보인다.
  const inFlight = useRef(false);

  const request = async () => {
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setRequesting(true);
    const outcome = await requestIngestionRun({ source: "g2b" }, crypto.randomUUID());
    inFlight.current = false;
    setRequesting(false);
    if (outcome.ok) {
      onAccepted(outcome.run);
      onGateRefresh();
      return;
    }
    const error = requestErrorOf(outcome.failure, {
      retryAfterSec: outcome.retryAfterSec,
      submitted: "g2b",
      runMode: "live",
      now: new Date(),
    });
    setFailure({ error, gated: GATED_CODES.has(outcome.failure.code), gateCheckedAt });
    if (error.action?.kind === "show-run") onWatchRun(error.action.runId);
    onGateRefresh();
  };

  const errorId = `${id}-error`;
  const noticeId = `${id}-notice`;
  const scheduleId = `${id}-schedule`;
  const describedBy = [shownError !== null ? errorId : noticeId, scheduleId].join(" ");
  // 오류가 보이는 동안에는 같은 내용을 되풀이하지 않게 판정 안내를 비운다.
  const noticeText = shownError === null ? (view.notice?.text ?? "") : "";
  const showRunId = shownError === null ? (view.notice?.showRunId ?? null) : null;

  return (
    <div className="flex max-w-md flex-col items-end gap-1 text-right">
      {/* 요청 중·막힘에도 초점을 잃지 않게 disabled 대신 focusableWhenDisabled 로 막는다.
          이때 native disabled 가 없어 Button 의 disabled: 흐림이 안 걸리므로 data-disabled 로 흐린다. */}
      <Button
        ref={buttonRef}
        type="button"
        className="data-disabled:opacity-50"
        disabled={blocked}
        focusableWhenDisabled
        aria-describedby={describedBy}
        onClick={() => void request()}
      >
        {requesting && (
          <LoaderCircleIcon
            data-icon="inline-start"
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {requesting ? LIVE_RUN_BUTTON_BUSY : LIVE_RUN_BUTTON_LABEL}
      </Button>
      {/* 낭독 영역은 비어 있을 때도 같은 요소로 남긴다(처음 생기는 영역은 낭독기가 놓칠 수 있다). 단추는 그 형제다. */}
      <p
        role="status"
        id={noticeId}
        className={noticeText === "" ? "sr-only" : "type-caption text-muted-foreground"}
      >
        {noticeText}
      </p>
      {shownError !== null && (
        <div role="alert" id={errorId} className="flex flex-col items-end gap-1">
          <p className="type-caption text-destructive">{shownError.message}</p>
          {shownError.requestId !== undefined && (
            <p className="font-mono type-caption wrap-anywhere text-muted-foreground">
              요청 ID {shownError.requestId}
            </p>
          )}
          <ErrorAction error={shownError} onRefresh={onReload} onShowRun={onShowRun} />
        </div>
      )}
      {showRunId !== null && (
        <Button type="button" variant="outline" size="sm" onClick={() => onShowRun(showRunId)}>
          {SHOW_RUN_LABEL}
        </Button>
      )}
      <p id={scheduleId} className="type-caption text-muted-foreground">
        {view.schedule}
      </p>
    </div>
  );
}
