import { OctagonAlertIcon } from "lucide-react";
import { formatKst, formatRelative } from "@/components/bids/format";
import { Card, CardContent } from "@/components/ui/card";
import type { RunMode } from "@/server/bids";
import type { IngestionSourceCard, IngestionSourceFailure } from "@/server/ingestion";
import { errorCodeLabel, primaryFailureOf } from "./error-kind";
import {
  SOURCE_CARD_EMPTY,
  SOURCE_CARD_NONE,
  SOURCE_CARD_ORDER,
  SOURCE_CARD_TERMS,
  SOURCE_CARDS_TITLE,
  loadedLabel,
  quarantinedLabel,
  runnableLabel,
  sourceLabel,
  type IngestSource,
} from "./ingestion-copy";

// 소스별 최근 수집(N8 디자인 스펙 §4.4, D3). page(서버 컴포넌트)가 그려 IngestionView 의 자리(sourceCards)로 넘긴다.
// 값은 서버가 그린 때의 것이라 폴링으로 다시 계산하지 않고 router.refresh() 로만 바뀐다. 카드는 동작이 없어 초점을 받지 않는다(§7).
// 칸 수는 단 폭으로 정한다(@container): 본문 960(1280·펼침)·1120(1440·펼침) 모두 @2xl 이상이라 2칸이다.

const EMPTY = "—";

type SourceCardsProps = {
  cards: readonly IngestionSourceCard[];
  runMode: RunMode;
  /** 상대 시각(`12분 전`)의 기준(ISO). page 가 첫 쪽을 읽을 때 만든 값이다. */
  now: string;
};

const emptyCard = (source: IngestSource): IngestionSourceCard => ({
  source,
  lastSuccess: null,
  lastFailure: null,
});

export function SourceCards({ cards, runMode, now }: SourceCardsProps) {
  const at = new Date(now);
  return (
    <section aria-labelledby="ingest-sources-title" className="flex flex-col gap-3">
      <h2 id="ingest-sources-title" className="type-heading text-foreground">
        {SOURCE_CARDS_TITLE}
      </h2>
      <div className="@container">
        <div className="grid gap-4 @2xl:grid-cols-2">
          {SOURCE_CARD_ORDER.map((source) => (
            <SourceCard
              key={source}
              card={cards.find((card) => card.source === source) ?? emptyCard(source)}
              runMode={runMode}
              now={at}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Instant({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={iso}>
      {formatKst(iso)}
    </time>
  );
}

function SourceCard({
  card,
  runMode,
  now,
}: {
  card: IngestionSourceCard;
  runMode: RunMode;
  now: Date;
}) {
  const { lastSuccess, lastFailure } = card;
  const hasRecord = lastSuccess !== null || lastFailure !== null;
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="type-heading text-foreground">{sourceLabel(card.source)}</h3>
          <p className="type-caption text-muted-foreground">
            {runnableLabel(runMode, card.source)}
          </p>
        </div>
        {hasRecord ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="type-label text-muted-foreground">{SOURCE_CARD_TERMS.lastSuccess}</dt>
            <dd className="min-w-0 type-body tabular-nums text-foreground">
              {lastSuccess === null ? (
                SOURCE_CARD_NONE
              ) : (
                <>
                  <Instant iso={lastSuccess.finishedAt} />
                  {` · ${formatRelative(lastSuccess.finishedAt, now)}`}
                </>
              )}
            </dd>
            <dt className="type-label text-muted-foreground">{SOURCE_CARD_TERMS.lastFailure}</dt>
            {lastFailure === null ? (
              <dd className="min-w-0 type-body text-foreground">{SOURCE_CARD_NONE}</dd>
            ) : (
              <FailureValue failure={lastFailure} />
            )}
            <dt className="type-label text-muted-foreground">{SOURCE_CARD_TERMS.loaded}</dt>
            <dd className="min-w-0 type-body tabular-nums text-foreground">
              {lastSuccess === null ? EMPTY : loadedLabel(lastSuccess.created, lastSuccess.changed)}
            </dd>
            <dt className="type-label text-muted-foreground">{SOURCE_CARD_TERMS.quarantined}</dt>
            <dd className="min-w-0 type-body tabular-nums text-foreground">
              {lastSuccess === null ? EMPTY : quarantinedLabel(lastSuccess.quarantined)}
            </dd>
          </dl>
        ) : (
          <p className="type-body text-muted-foreground">{SOURCE_CARD_EMPTY}</p>
        )}
      </CardContent>
    </Card>
  );
}

// 실패 값은 색과 아이콘에 더해 글자(중단 원인 라벨·코드)가 뜻을 말한다(§7). 원인은 상태 줄과 같은 함수로 고른다.
// 긴 코드(API_SERVICE_KEY_INVALID 등)가 칸을 넘지 않게 꺾는다(§9).
function FailureValue({ failure }: { failure: IngestionSourceFailure }) {
  const cause = primaryFailureOf(failure.errors);
  return (
    <dd className="flex min-w-0 items-start gap-1.5 type-body tabular-nums text-destructive">
      <OctagonAlertIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
      <span className="min-w-0 wrap-anywhere">
        <Instant iso={failure.finishedAt} />
        {cause === null ? null : ` · ${errorCodeLabel(cause.errorCode)} ${cause.errorCode}`}
      </span>
    </dd>
  );
}
