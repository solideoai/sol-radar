import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { workDeps } from "@/app/_lib/work-deps";
import { requireWork } from "@/app/(app)/(work)/work";
import {
  canRecordReview,
  canRequestAnalysis,
  getBid,
  isUuid,
  listBidAnalyses,
  type AnalysisView,
  type BidDetail,
} from "@/server/bids";
import { getMembersPage } from "@/server/organization";
import { assessmentLabel } from "./assessment-labels";
import { backHrefOf } from "./back-href";
import { BidDetailView, type AnalysisHistoryRow, type DetailBid } from "./bid-detail-view";
import { DETAIL_TITLE } from "./detail-copy";

export const metadata: Metadata = { title: DETAIL_TITLE };

// 스펙 §5.4. 공고 한 건을 근거와 함께 보이고 사람이 결정을 기록하는 화면이다.
// 누가 무엇을 읽는지는 RLS 가 정한다. 공고는 공용이고 분석·결정은 이 조직 것만 보인다(S7: 다른 조직이면 "아직 분석하지 않았습니다").
// 분석 실행·결정 기록은 브라우저가 Route Handler 로 보내고, 끝나면 router.refresh() 로 이 화면을 다시 읽는다.

const HISTORY_LIMIT = 20;

export default async function BidDetailPage({ params, searchParams }: PageProps<"/bids/[id]">) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const { id } = await params;
  // 로그인·가입·조직 확인이 먼저다. 그 전에 404 를 내면 로그인 없이 공고 주소 형식을 떠볼 수 있다.
  const work = await requireWork(`/bids/${id}`);
  if (!isUuid(id)) notFound();

  const deps = workDeps();
  const [detail, history, membersPage] = await Promise.all([
    getBid(work.orgId, id, { repo: deps.bids }),
    listBidAnalyses(work.orgId, id, { cursor: null, limit: HISTORY_LIMIT }, deps.cursorSecret, {
      repo: deps.bids,
    }),
    getMembersPage({ org: work.org, userId: work.userId }),
  ]);
  if (!detail.ok) {
    if (detail.status === 404) notFound();
    // 예상한 실패도 화면에서는 읽기 실패라 오류 경계(error.tsx)로 던진다. message 는 서비스의 한국어 문장이다.
    throw new Error(detail.message);
  }
  // 분석 이력은 띠 안의 보조 목록이다. 읽지 못해도(커서 설정 등) 화면은 그리고 띠에 그 사실만 적는다.
  if (!history.ok) {
    console.error(
      JSON.stringify({ event: "bid_detail_history_failed", bidId: id, code: history.code }),
    );
  }

  const bid = toDetailBid(detail.data);
  const latest = bid.latestAnalysis;
  const historyItems = history.ok ? history.data.items : [];
  const scoredLatest = latest !== null && SCORED.has(latest.status);
  const previousScored = scoredLatest
    ? null
    : (historyItems.find((analysis) => SCORED.has(analysis.status)) ?? null);

  const members =
    membersPage.status === "team"
      ? membersPage.members.map((member) => ({ id: member.userId, name: member.name }))
      : [];
  // 담당자 기본값은 나다(D6). 목록에 없으면 앞에 넣어 선택 칸이 빈 값을 보이지 않게 한다.
  if (!members.some((member) => member.id === work.userId)) {
    members.unshift({ id: work.userId, name: "나" });
  }

  return (
    <BidDetailView
      bid={bid}
      previousScored={previousScored}
      history={
        history.ok
          ? { items: historyItems.map(toHistoryRow), hasMore: history.data.pageInfo.hasNext }
          : null
      }
      assessmentLabels={labelsOf(detail.data.extraction, latest)}
      members={members}
      currentUserId={work.userId}
      canAnalyze={canRequestAnalysis(work.role)}
      canDecide={canRecordReview(work.role)}
      backHref={backHrefOf((await searchParams).list, work.runMode)}
      now={new Date().toISOString()}
    />
  );
}

// 화면에 내려보낼 칸만 고른다. 추출 결과·원본 문자열·구조화 자격·revision 목록은 화면이 쓰지 않아 싣지 않는다.
const toDetailBid = (detail: BidDetail): DetailBid => ({
  id: detail.id,
  source: detail.source,
  noticeId: detail.noticeId,
  title: detail.title,
  agency: detail.agency,
  stage: detail.stage,
  status: detail.status,
  budgetKrw: detail.budgetKrw,
  publishedAt: detail.publishedAt,
  deadlineAt: detail.deadlineAt,
  latestRevision: detail.latestRevision,
  planRef: detail.planRef,
  isDemo: detail.isDemo,
  sourceUrl: detail.sourceUrl,
  lastSyncedAt: detail.lastSyncedAt,
  origin: detail.origin,
  documentsStatus: detail.documentsStatus,
  latestReview: detail.latestReview,
  content: detail.content,
  documents: detail.documents,
  stageLinks: detail.stageLinks,
  extractionStatus: detail.extractionStatus,
  latestAnalysis: detail.latestAnalysis,
  reviews: detail.reviews,
});

const SCORED: ReadonlySet<AnalysisView["status"]> = new Set(["COMPLETED", "PARTIAL"]);

const toHistoryRow = (analysis: AnalysisView): AnalysisHistoryRow => ({
  id: analysis.id,
  status: analysis.status,
  at: analysis.finishedAt ?? analysis.queuedAt,
  solScore: analysis.solScore,
  recommendation: analysis.recommendation,
  runMode: analysis.runMode,
  errorCode: analysis.errorCode,
});

// Kev 항목별 분포의 문구는 서버에서 풀어 넘긴다. 추출 결과 전체를 브라우저로 보내지 않는다.
function labelsOf(extraction: unknown, latest: AnalysisView | null): Record<string, string> {
  if (latest === null) return {};
  return Object.fromEntries(
    latest.requirementAssessments.map((assessment) => [
      assessment.itemId,
      assessmentLabel(extraction, assessment.itemId),
    ]),
  );
}
