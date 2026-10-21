import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { defaultOrigin } from "@/server/bids";
import { loadBidPage, loadWatchedBidIdsOrNull } from "@/app/_lib/work-data";
import { canRunIngestion } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { BIDS_DESCRIPTION, BIDS_TITLE } from "./bids-copy";
import { BidListView } from "./bid-list-view";
import { listQueryOf } from "./list-query";

export const metadata: Metadata = { title: BIDS_TITLE };

// 스펙 §5.3. 필터 값은 주소 쿼리가 정본이다. 첫 쪽(20건)은 서버가 그리고, 다음 쪽은 "더 보기"가 API 로 읽는다.
// 누가 무엇을 읽는지는 RLS 가 정한다. 기본 출처는 실행 모드를 따른다(mock·fixture → demo, live → live).
export default async function BidsPage({ searchParams }: PageProps<"/bids">) {
  await connection();
  const raw = await searchParams;
  const work = await requireWork(nextPathOf(raw));
  const { query, search } = listQueryOf(raw, work.runMode);
  // D-n 의 기준. 요청마다 한 번 만들어 내린다(P1, 하이드레이션 차이 없음).
  const now = new Date();
  // ★ 처음 값(N3 Q2 ①). 관심은 보조 정보라 읽지 못하면 null 이고 ★ 열 없이 그린다(D15).
  const [first, watchedIds] = await Promise.all([
    loadBidPage(work.orgId, query),
    loadWatchedBidIdsOrNull({ orgId: work.orgId, userId: work.userId }),
  ]);
  return (
    <AppPage title={BIDS_TITLE} description={BIDS_DESCRIPTION} contentClassName="max-w-360">
      <BidListView
        defaultOrigin={defaultOrigin(work.runMode) === "live" ? "live" : "demo"}
        items={first.items}
        nextCursor={first.pageInfo.nextCursor}
        query={search}
        now={now.toISOString()}
        canRunIngestion={canRunIngestion(work.role)}
        watchedIds={watchedIds}
      />
    </AppPage>
  );
}

// 로그인·가입 보완 뒤 돌아올 주소. 검색어 등 조건을 잃지 않게 쿼리를 그대로 붙인다(경로는 /bids 고정이라 바깥으로 새지 않는다).
function nextPathOf(raw: Awaited<PageProps<"/bids">["searchParams"]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `/bids?${search}` : "/bids";
}
