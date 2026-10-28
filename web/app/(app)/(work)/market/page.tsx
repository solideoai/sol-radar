import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { GAP_BUCKET_LABELS, gapRadarHref } from "@/server/gaps";
import { getMarketOverview, MARKET_PERIODS, parseMarketQuery } from "@/server/market";
import { loadOpportunitySources } from "@/app/_lib/opportunity-data";
import { requireWork } from "@/app/(app)/(work)/work";
import { MARKET_DESCRIPTION, MARKET_TITLE, marketHref } from "./market-copy";
import { MarketFilters, MarketView, type MarketReference } from "./market-view";

export const metadata: Metadata = { title: MARKET_TITLE };

// 발주 현황(스펙 §6 B1·B2). 늘 live 나라장터 입찰공고만 본다(DEMO 예시 공고는 세지 않는다).
// B2: 상위 발주기관·분야 행에 /gaps 판정 묶음 분포(마감 전 공고 기준)를 겹친다. 회사 프로필이 없으면 겹쳐 보기만 뺀다.
// ?period=30|90(기본 90) · ?relevance=relevant|all(기본 relevant). 틀린 값은 기본값으로 그린다.
// 읽기 전용이다. 누가 무엇을 읽는지는 RLS 가 정한다(anon 키 + 세션, server/market).
export default async function MarketPage({ searchParams }: PageProps<"/market">) {
  await connection();
  const query = parseMarketQuery(await searchParams);
  const work = await requireWork(marketHref(query));
  // 기간 경계·D-n 의 기준. 요청마다 한 번 만들어 내린다.
  const now = new Date();
  const [overview, sources] = await Promise.allSettled([
    getMarketOverview(work.orgId, query, now),
    loadOpportunitySources("live"),
  ]);
  if (overview.status === "rejected") throw overview.reason;
  // 기준 시각은 나라장터(G2B) 수집의 마지막 완전 성공이다. 조회가 실패해도 집계는 그린다.
  const reference: MarketReference =
    sources.status === "fulfilled"
      ? {
          at:
            sources.value.groups.find((group) => group.sourceFamily === "G2B")?.lastSuccessAt ??
            null,
          failed: false,
        }
      : { at: null, failed: true };
  return (
    <AppPage
      title={MARKET_TITLE}
      description={MARKET_DESCRIPTION}
      contentClassName="max-w-360"
      actions={<MarketFilters query={query} periods={MARKET_PERIODS} />}
    >
      <MarketView
        overview={overview.value}
        reference={reference}
        now={now}
        gapCopy={{
          bucketLabels: GAP_BUCKET_LABELS,
          gapsHref: gapRadarHref({
            scope: query.relevance === "all" ? "all" : "relevant",
            assume: [],
          }),
        }}
      />
    </AppPage>
  );
}
