"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  INSIGHT_DONE_HOLD_MS,
  INSIGHT_EXPECTED_MS,
  insightFillMs,
  insightFillValue,
  insightProgress,
} from "@/components/bids/insight-progress";
import {
  RecommendationInsightDialog,
  type InsightStage,
} from "@/components/bids/recommendation-insight-dialog";
import {
  INSIGHT_NOTICE,
  authorshipText,
  readableModelText,
  type InsightRunFacts,
} from "@/components/bids/recommendation-insight-sections";
import { useInsightRequest } from "@/components/bids/use-insight-request";
import { Button } from "@/components/ui/button";
import type { InsightView } from "@/server/insight";

// 공고 상세의 "추천 분석" 구역(ADR-066·078, 스펙 2026-11-03-recommendation-insight-detail §3·4.7). 결정 모델 참고 지표 다음 구역이다.
// 구역은 상태·판단 이유 첫 문장·버튼만 보인다. 버튼을 누르면 팝업이 열리고, 결과가 없으면 그 자리에서 요청해 진행률 뒤 내용을 채운다.
// 판정(점수·권고)은 규칙 엔진 그대로이고 Qwen 은 이유·해설만 정리한다. 고지 문장은 어느 상태에서나 보인다.
// 요청·묻기 상태와 진행률은 여기서 갖는다. 팝업을 닫아도 분석은 이어지고 다시 열면 같은 숫자에서 이어진다.
// 분석 run 이 바뀌면 부르는 쪽이 key 를 바꿔 새로 그린다(옛 run 의 설명을 새 run 에 붙이지 않는다).

export { INSIGHT_NOTICE };
export type { InsightRunFacts };

// 숫자가 1씩 오르게 0.1초마다 다시 센다(예상 시간 10초 동안 1초에 9씩). 100 까지 채울 때는 더 잘게 센다.
const PROGRESS_TICK_MS = 100;
const FILL_TICK_MS = 20;

type RecommendationInsightProps = {
  bidId: string;
  runId: string;
  /** 767px 이하 전체 화면 팝업 머리에 보이는 공고명. */
  bidTitle: string;
  /** 팝업 머리·점수 요소·자격 해설이 쓰는 이 run 의 규칙 값. */
  run: InsightRunFacts;
  /** 요청할 수 있는 업무 역할(ADMIN·SALES·ANALYST). 아니면 결과만 읽는다. */
  canRequest: boolean;
  /** 서버가 읽은 이 run 의 최신 1건. 없으면 null. */
  initialInsight: InsightView | null;
  /** 최신이 FAILED 일 때 그 run 의 마지막 모델 결과. 그 밖에는 null. */
  initialPrevious: InsightView | null;
  /** PENDING 을 묻는 최대 시간(INSIGHT_POLL_LIMIT_MS). 진행률이 99 에 닿는 때이기도 하다(계획 Q4). 서버 화면이 넘긴다. */
  pollLimitMs: number;
  /** 지금 출력 형식 버전(INSIGHT_PROMPT_VERSION). 다르면 옛 형식으로 그린다. 서버 화면이 넘긴다. */
  currentPromptVersion: string;
};

/** 판단 이유 첫 문장. 뒤가 공백이거나 글 끝인 "." 까지다("3.5" 같은 숫자는 자르지 않는다). 없으면 전체. */
const firstSentence = (summary: string): string => {
  const text = readableModelText(summary);
  return /^[\s\S]*?\.(?=\s|$)/.exec(text)?.[0] ?? text;
};

type SectionButton = { label: string; requests: boolean } | null;
type SectionState = {
  status: string;
  spinning: boolean;
  sentence: string | null;
  button: SectionButton;
};

const VIEW_BUTTON: SectionButton = { label: "추천 분석 보기", requests: false };

// 구역의 상태 줄·첫 문장·버튼(디자인 스펙 3.2). 버튼 글자로 모델을 부르는지 구분한다(계획 Q5).
function sectionStateOf(
  insight: InsightView | null,
  previous: InsightView | null,
  stage: InsightStage,
  canRequest: boolean,
): SectionState {
  if (stage === "waiting") {
    return {
      status: "추천 분석을 만들고 있습니다.",
      spinning: true,
      sentence: null,
      button: VIEW_BUTTON,
    };
  }
  if (stage === "delayed") {
    return {
      status: "응답이 늦어지고 있습니다.",
      spinning: false,
      sentence: null,
      button: VIEW_BUTTON,
    };
  }
  if (insight === null) {
    return canRequest
      ? {
          status:
            "공고문과 회사 자료를 근거로 판단 이유, 점수 요소, 자격 요건, 참여 전 확인할 것을 정리합니다.",
          spinning: false,
          sentence: null,
          button: { label: "추천 분석", requests: true },
        }
      : { status: "아직 추천 분석이 없습니다.", spinning: false, sentence: null, button: null };
  }
  if (insight.status !== "DONE" || insight.payload === null) {
    const shown = previous?.payload ?? null;
    return {
      status: "추천 분석을 만들지 못했습니다.",
      spinning: false,
      sentence: shown === null ? null : firstSentence(shown.summary),
      button:
        shown !== null ? VIEW_BUTTON : canRequest ? { label: "다시 요청", requests: true } : null,
    };
  }
  return {
    status: authorshipText(insight),
    spinning: false,
    sentence: firstSentence(insight.payload.summary),
    button: VIEW_BUTTON,
  };
}

function RecommendationInsight({
  bidId,
  runId,
  bidTitle,
  run,
  canRequest,
  initialInsight,
  initialPrevious,
  pollLimitMs,
  currentPromptVersion,
}: RecommendationInsightProps) {
  const headingId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // 결과를 받은 순간 팝업이 열려 있는지(묻기 루프가 부르는 onDone 이 읽는다).
  const openRef = useRef(false);
  // 팝업이 열린 채로 DONE 을 받은 때와 그때 보이던 값. 그 값에서 100 까지 채우고 잠깐 보인 뒤 내용으로 바꾼다.
  const [finish, setFinish] = useState<{ from: number; at: number } | null>(null);
  const [fillValue, setFillValue] = useState(100);
  // 팝업에 이미 보인 진행률. 계산 값이 이보다 작아도(시작점이 행의 createdAt 으로 옮겨짐) 줄여 보이지 않는다.
  const [progress, setProgress] = useState(0);
  // 마지막으로 그린 진행률. DONE 을 받은 순간의 값을 읽는다(그린 뒤 effect 가 적는다).
  const shownRef = useRef(0);

  // 닫혀 있으면 구역만 바뀐다.
  const onDone = useCallback(() => {
    if (!openRef.current) return;
    const from = shownRef.current;
    setFillValue(from);
    setFinish({ from, at: Date.now() });
  }, []);
  const { insight, previous, phase, startedAt, request, recheck } = useInsightRequest({
    bidId,
    runId,
    initialInsight,
    initialPrevious,
    pollLimitMs,
    onDone,
  });

  const waiting = phase === "requesting" || phase === "polling";
  const stage: InsightStage =
    finish !== null
      ? "finishing"
      : waiting
        ? "waiting"
        : phase === "delayed" || insight?.status === "PENDING"
          ? "delayed"
          : "settled";

  const progressAt = useCallback(
    (now: number) =>
      startedAt === null ? 0 : insightProgress(now - startedAt, INSIGHT_EXPECTED_MS, pollLimitMs),
    [pollLimitMs, startedAt],
  );

  // 팝업이 열려 있고 기다리는 동안 0.1초마다 다시 센다. 묻기 간격(2초·5초)과 따로 돈다.
  useEffect(() => {
    if (!open || !waiting) return;
    const timer = setInterval(
      () => setProgress((shown) => Math.max(shown, progressAt(Date.now()))),
      PROGRESS_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [open, progressAt, waiting]);

  // DONE 을 받은 값에서 100 까지 고르게 채우고(한 번에 건너뛰지 않는다), 100 을 잠깐 보인 뒤 내용으로 바꾼다.
  useEffect(() => {
    if (finish === null) return;
    const fill = setInterval(
      () => setFillValue(insightFillValue(finish.from, Date.now() - finish.at)),
      FILL_TICK_MS,
    );
    const done = setTimeout(
      () => setFinish(null),
      insightFillMs(finish.from) + INSIGHT_DONE_HOLD_MS,
    );
    return () => {
      clearInterval(fill);
      clearTimeout(done);
    };
  }, [finish]);

  const changeOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (next) setProgress((shown) => Math.max(shown, progressAt(Date.now())));
    else setFinish(null);
  };
  // 새 요청은 0% 부터 센다. [다시 확인]은 같은 요청이라 이어 센다.
  const startRequest = () => {
    setProgress(0);
    request();
  };

  const section = sectionStateOf(insight, previous, stage, canRequest);
  const shownProgress = stage === "finishing" ? fillValue : stage === "delayed" ? 99 : progress;
  useEffect(() => {
    shownRef.current = shownProgress;
  });

  return (
    <section
      aria-labelledby={headingId}
      data-slot="recommendation-insight"
      className="flex flex-col"
    >
      <h2 id={headingId} className="type-heading text-foreground">
        추천 분석
      </h2>
      <p className="type-caption text-muted-foreground">{INSIGHT_NOTICE}</p>
      <p role="status" className="mt-3 flex items-center gap-2 type-label text-muted-foreground">
        {section.spinning && (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
        )}
        {section.status}
      </p>
      {section.sentence !== null && (
        <p className="mt-1 line-clamp-3 type-body text-foreground">{section.sentence}</p>
      )}
      {section.button !== null && (
        <Button
          ref={buttonRef}
          variant="outline"
          size="sm"
          className="mt-3 self-start"
          onClick={() => {
            changeOpen(true);
            if (section.button?.requests) startRequest();
          }}
        >
          {section.button.label}
        </Button>
      )}
      <RecommendationInsightDialog
        open={open}
        onOpenChange={changeOpen}
        returnFocus={buttonRef}
        bidTitle={bidTitle}
        run={run}
        canRequest={canRequest}
        currentPromptVersion={currentPromptVersion}
        insight={insight}
        previous={previous}
        stage={stage}
        progress={shownProgress}
        onRequest={startRequest}
        onRecheck={recheck}
      />
    </section>
  );
}

export { RecommendationInsight };
