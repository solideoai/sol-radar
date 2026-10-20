import type { Metadata } from "next";
import { connection } from "next/server";
import { ingestionDeps } from "@/app/_lib/ingestion-deps";
import { listIngestionRuns } from "@/server/ingestion";
import { requireWork } from "@/app/(app)/(work)/work";
import { IngestionForbidden } from "./ingestion-forbidden";
import { INGESTION_PATH, INGESTION_TITLE } from "./ingestion-copy";
import { IngestionView } from "./ingestion-view";

export const metadata: Metadata = { title: INGESTION_TITLE };

const FIRST_PAGE_SIZE = 20;

// N8 데이터 수집 관리(디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md). 업무 역할 ADMIN 전용이다.
// 역할을 먼저 보고 ADMIN 이 아니면 데이터를 읽지 않고 안내만 그린다(D10). 읽기 권한 자체는 RLS 가 정한다.
// 첫 쪽(20건)은 서버가 그리고, 다음 쪽·상태 다시 읽기·상세는 화면이 /api/v1/admin/ingestion/runs 로 읽는다.
export default async function IngestionPage({ searchParams }: PageProps<"/admin/ingestion">) {
  await connection();
  const { run } = await searchParams;
  const runParam = typeof run === "string" ? run : null;
  const work = await requireWork(
    runParam === null ? INGESTION_PATH : `${INGESTION_PATH}?run=${encodeURIComponent(runParam)}`,
  );
  if (work.role !== "ADMIN") return <IngestionForbidden role={work.role} />;
  // 상태 줄 시간 계산의 첫 기준. 요청마다 한 번 만들어 내린다(하이드레이션 차이 없음).
  const now = new Date();
  const result = await listIngestionRuns(
    { orgId: work.orgId, userId: work.userId, role: work.role },
    { limit: FIRST_PAGE_SIZE, cursor: null },
    ingestionDeps(work.orgId),
  );
  // 예상한 실패(커서 비밀 없음 503 등)도 화면에서는 읽기 실패라 오류 경계(error.tsx)로 던진다.
  if (!result.ok) throw new Error(result.message);
  return (
    <IngestionView
      runMode={work.runMode}
      initialItems={result.data.items}
      initialNextCursor={result.data.pageInfo.nextCursor}
      now={now.toISOString()}
    />
  );
}
