import type { Metadata } from "next";
import { connection } from "next/server";
import { ingestionDeps } from "@/app/_lib/ingestion-deps";
import { getIngestionSourceCards, listIngestionRuns } from "@/server/ingestion";
import { requireWork } from "@/app/(app)/(work)/work";
import { IngestionForbidden } from "./ingestion-forbidden";
import { INGESTION_PATH, INGESTION_TITLE } from "./ingestion-copy";
import { IngestionView } from "./ingestion-view";
import { SourceCards } from "./source-cards";

export const metadata: Metadata = { title: INGESTION_TITLE };

const FIRST_PAGE_SIZE = 20;

// N8 데이터 수집 관리(디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md). 업무 역할 ADMIN 전용이다.
// 역할을 먼저 보고 ADMIN 이 아니면 데이터를 읽지 않고 안내만 그린다(D10). 읽기 권한 자체는 RLS 가 정한다.
// 첫 쪽(20건)은 서버가 그리고, 다음 쪽·상태 다시 읽기·상세는 화면이 /api/v1/admin/ingestion/runs 로 읽는다.
// 소스별 카드(§4.4, D3)는 공개 API 없이 여기서 수집 도메인을 직접 읽어(사용자 세션·RLS) 서버에서 그린다.
export default async function IngestionPage({ searchParams }: PageProps<"/admin/ingestion">) {
  await connection();
  const { run } = await searchParams;
  const runParam = typeof run === "string" ? run : null;
  const work = await requireWork(
    runParam === null ? INGESTION_PATH : `${INGESTION_PATH}?run=${encodeURIComponent(runParam)}`,
  );
  if (work.role !== "ADMIN") return <IngestionForbidden role={work.role} />;
  // 상태 줄 시간 계산과 카드 상대 시각("12분 전")의 기준. 요청마다 한 번 만들어 내린다(하이드레이션 차이 없음).
  const now = new Date();
  const ctx = { orgId: work.orgId, userId: work.userId, role: work.role };
  const deps = ingestionDeps(work.orgId);
  const [runs, cards] = await Promise.all([
    listIngestionRuns(ctx, { limit: FIRST_PAGE_SIZE, cursor: null }, deps),
    getIngestionSourceCards(ctx, deps),
  ]);
  // 예상한 실패(커서 비밀 없음 503 등)도 화면에서는 읽기 실패라 오류 경계(error.tsx)로 던진다.
  if (!runs.ok) throw new Error(runs.message);
  if (!cards.ok) throw new Error(cards.message);
  const nowIso = now.toISOString();
  return (
    <IngestionView
      runMode={work.runMode}
      initialItems={runs.data.items}
      initialNextCursor={runs.data.pageInfo.nextCursor}
      now={nowIso}
      sourceCards={<SourceCards cards={cards.data} runMode={work.runMode} now={nowIso} />}
    />
  );
}
