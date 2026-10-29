"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import { formatKst } from "@/components/bids/format";
import { MOCK_MODEL_TEXT } from "@/components/bids/kev-opinion";
import { useInsightRequest, type InsightPhase } from "@/components/bids/use-insight-request";
import { Button } from "@/components/ui/button";
import type { InsightItem, InsightRef, InsightView } from "@/server/insight";

// 공고 상세의 "추천 분석" 패널(스펙 2026-10-29-recommendation-insight §4.6, ADR-066). 결정 모델 참고 지표 다음 구역이다.
// [추천 분석]을 누르면 Qwen 이 판단 이유·강점·보완할 점을 근거 인용과 함께 정리한다. 판정(점수·권고)은 규칙 엔진 그대로다.
// 상태: 없음(요청 가능이면 [추천 분석], 읽기 전용이면 안내) · 진행 중 · 늦음([다시 확인]) · 완료(모델·대체) · 실패([다시 요청]).
// 근거 칩을 누르면 그 항목 아래에 인용(근거 이름·인용문)이 펼쳐진다. 고지 문장은 어느 상태에서나 보인다.
// 분석 run 이 바뀌면 부르는 쪽이 key 를 바꿔 새로 그린다(옛 run 의 설명을 새 run 에 붙이지 않는다).

export const INSIGHT_NOTICE = "판정은 규칙 엔진이 하고, 최종 참여 결정은 사람이 합니다.";

type RecommendationInsightProps = {
  bidId: string;
  runId: string;
  /** 요청할 수 있는 업무 역할(ADMIN·SALES·ANALYST). 아니면 결과만 읽는다. */
  canRequest: boolean;
  /** 서버가 읽은 이 run 의 최신 1건. 없으면 null. */
  initialInsight: InsightView | null;
  /** PENDING 을 묻는 최대 시간(INSIGHT_POLL_LIMIT_MS). 서버 전용 모듈의 상수라 서버 화면이 넘긴다. */
  pollLimitMs: number;
};

const REF_KIND: Record<InsightRef["kind"], string> = { BID: "공고문", COMPANY: "회사 자료" };
// gateway mock 의 /insight 응답 model 값. worker 가 model_name 에 그대로 저장한다.
// mock 응답이 실제 모델처럼 보이면 안 되므로(ADR-034 15번) 결정 모델 참고 지표와 같은 글자로 바꿔 쓴다.
const MOCK_INSIGHT_MODEL = "fixture";

const modelText = (modelName: string | null): string =>
  modelName === MOCK_INSIGHT_MODEL ? MOCK_MODEL_TEXT : `모델 ${modelName ?? "—"}`;

function RecommendationInsight({
  bidId,
  runId,
  canRequest,
  initialInsight,
  pollLimitMs,
}: RecommendationInsightProps) {
  const headingId = useId();
  const { insight, phase, request, recheck } = useInsightRequest({
    bidId,
    runId,
    initialInsight,
    pollLimitMs,
  });
  return (
    <section
      aria-labelledby={headingId}
      data-slot="recommendation-insight"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col">
        <h2 id={headingId} className="type-heading text-foreground">
          추천 분석
        </h2>
        <p className="type-caption text-muted-foreground">{INSIGHT_NOTICE}</p>
      </div>
      <Body
        insight={insight}
        phase={phase}
        canRequest={canRequest}
        onRequest={request}
        onRecheck={recheck}
      />
    </section>
  );
}

function Body({
  insight,
  phase,
  canRequest,
  onRequest,
  onRecheck,
}: {
  insight: InsightView | null;
  phase: InsightPhase;
  canRequest: boolean;
  onRequest: () => void;
  onRecheck: () => void;
}) {
  if (phase === "requesting" || phase === "polling") {
    return (
      <p role="status" className="flex items-center gap-2 type-body text-foreground">
        <LoaderCircleIcon
          aria-hidden
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        공고와 회사 자료를 읽고 정리하고 있습니다.
      </p>
    );
  }
  if (phase === "delayed" || insight?.status === "PENDING") {
    return (
      <div role="status" className="flex flex-col items-start gap-2">
        <p className="type-body text-foreground">
          응답이 늦어지고 있습니다. 잠시 뒤 다시 확인하세요.
        </p>
        <Button variant="outline" size="sm" onClick={onRecheck}>
          다시 확인
        </Button>
      </div>
    );
  }
  if (insight === null) {
    return canRequest ? (
      <div className="flex flex-col items-start gap-2">
        <p className="type-body text-muted-foreground">
          공고문과 회사 자료를 근거로 이 판정의 이유, 강점, 보완할 점을 정리합니다.
        </p>
        <Button variant="outline" size="sm" onClick={onRequest}>
          추천 분석
        </Button>
      </div>
    ) : (
      <p className="type-body text-muted-foreground">아직 추천 분석이 없습니다.</p>
    );
  }
  if (insight.status === "FAILED" || insight.payload === null) {
    return (
      <div role="status" className="flex flex-col items-start gap-2">
        <p className="type-body text-foreground">추천 분석을 만들지 못했습니다.</p>
        {insight.errorCode !== null && (
          <p className="font-mono type-caption text-muted-foreground">{insight.errorCode}</p>
        )}
        {canRequest && (
          <Button variant="outline" size="sm" onClick={onRequest}>
            다시 요청
          </Button>
        )}
      </div>
    );
  }
  const { payload } = insight;
  const template = insight.source === "TEMPLATE";
  const madeAt = formatKst(insight.finishedAt ?? insight.createdAt);
  return (
    <div className="flex flex-col gap-4">
      {template && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="type-label text-muted-foreground">
            모델 설명을 쓰지 못해 규칙 결과로 정리했습니다.
          </p>
          {canRequest && (
            <Button variant="outline" size="xs" onClick={onRequest}>
              다시 요청
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="type-label text-foreground">판단 이유</h3>
        <p className="type-body text-foreground">{payload.summary}</p>
      </div>
      <ItemGroup title="강점" items={payload.strengths} refs={payload.refs} />
      <ItemGroup title="보완할 점" items={payload.improvements} refs={payload.refs} />
      <p className="type-caption text-muted-foreground">
        {template ? "규칙 결과로 정리" : modelText(insight.modelName)} · {madeAt} 작성
      </p>
    </div>
  );
}

function ItemGroup({
  title,
  items,
  refs,
}: {
  title: string;
  items: InsightItem[];
  refs: InsightRef[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="type-label text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="type-label text-muted-foreground">정리할 항목이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <ItemLine key={`${index}-${item.text}`} item={item} refs={refs} />
          ))}
        </ul>
      )}
    </div>
  );
}

// 한 항목과 그 근거 칩. 칩은 하나씩 펼친다(같은 칩을 다시 누르면 접는다).
function ItemLine({ item, refs }: { item: InsightItem; refs: InsightRef[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const quoteId = useId();
  const cited = item.refIds.flatMap((refId) => refs.filter((ref) => ref.id === refId));
  const opened = cited.find((ref) => ref.id === openId);
  return (
    <li className="flex flex-col gap-1.5">
      <p className="type-body text-foreground">{item.text}</p>
      {cited.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cited.map((ref) => (
            <Button
              key={ref.id}
              variant="outline"
              size="xs"
              aria-expanded={ref.id === openId}
              aria-controls={quoteId}
              onClick={() => setOpenId((current) => (current === ref.id ? null : ref.id))}
            >
              {REF_KIND[ref.kind]} {ref.id}
            </Button>
          ))}
        </div>
      )}
      <div id={quoteId}>
        {opened !== undefined && (
          <figure className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
            <figcaption className="type-caption text-muted-foreground">{opened.label}</figcaption>
            <blockquote className="type-body text-foreground [overflow-wrap:anywhere]">
              {opened.quotedText}
            </blockquote>
          </figure>
        )}
      </div>
    </li>
  );
}

export { RecommendationInsight };
