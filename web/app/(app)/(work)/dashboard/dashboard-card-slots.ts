import { formatRelative } from "@/components/bids/format";
import type { DashboardSummary } from "@/server/bids";

// 대시보드 요약 카드 슬롯 정의 한 곳(설계 docs/plans/2026-10-16-sidebar-ia-design.md §2.3, 06 부품 표 DashboardCardSlots).
// 화면(dashboard-view)은 이 배열을 차례로 그리기만 한다. 순서가 곧 화면 순서다.
// 다섯 번째 슬롯은 해커톤에 "분석 현황"이다. 입찰 프로젝트(N6, P1)가 들어오면 마지막 항목 하나와
// DashboardSummary 필드 하나만 바꿔 "진행 중 입찰 프로젝트"로 교체한다.

export type DashboardCardInput = {
  summary: DashboardSummary;
  /** BID 표와 같은 조건(진행 중 공고의 최신 점수 권고 BID)의 전체 건수(M4). */
  recommendedTotal: number;
  /** 서버가 요청마다 한 번 만든 시각. 상대 시각의 기준이다. */
  now: Date;
};

export type DashboardCard = {
  /** 한 줄에 드는 짧은 값(숫자·상대 시각). */
  value: string;
  hint?: string;
  /** 값이 위험 상태일 때만 destructive. 값 글자 자체가 상태를 말한다(색만으로 전하지 않는다). */
  tone: "default" | "destructive";
};

export type DashboardCardSlotId =
  "recommended" | "review-pending" | "deadline" | "ingest" | "analyses";

export type DashboardCardSlot = {
  id: DashboardCardSlotId;
  label: string;
  read: (input: DashboardCardInput) => DashboardCard;
};

const EMPTY = "—";
const NO_ANALYSIS_HINT = "아직 분석한 공고가 없습니다";

const countCard = (count: number): DashboardCard => ({ value: String(count), tone: "default" });

function ingestCard(freshness: DashboardSummary["dataFreshness"], now: Date): DashboardCard {
  const { lastIngestAt, lastIngestStatus, lastIngestSummary } = freshness;
  if (lastIngestAt === null) return { value: EMPTY, hint: "수집 기록 없음", tone: "default" };
  const counts =
    lastIngestSummary === null
      ? undefined
      : `적재 ${lastIngestSummary.created} · 격리 ${lastIngestSummary.quarantined}`;
  const failed = lastIngestStatus === "FAILED";
  return {
    value: failed ? "실패" : formatRelative(lastIngestAt, now),
    hint: counts,
    tone: failed ? "destructive" : "default",
  };
}

// 공고별 끝난 분석 중 최신 1건으로 센 값(서버 getDashboardSummary). 진행 중 run 은 세지 않는다.
function analysesCard(latest: DashboardSummary["analyses"]["latestByStatus"]): DashboardCard {
  const { completed, partial, failed } = latest;
  return {
    value: String(completed),
    hint:
      completed + partial + failed === 0 ? NO_ANALYSIS_HINT : `부분 ${partial} · 실패 ${failed}`,
    tone: "default",
  };
}

export const DASHBOARD_CARD_SLOTS: readonly DashboardCardSlot[] = [
  // 아래 BID 표·전체 보기와 같은 정의다. 요약의 byRecommendation(모든 상태·최신 끝난 분석)과 다를 수 있다.
  {
    id: "recommended",
    label: "BID 권고",
    read: ({ recommendedTotal }) => countCard(recommendedTotal),
  },
  {
    id: "review-pending",
    label: "검토 대기",
    read: ({ summary }) => countCard(summary.reviews.pending),
  },
  {
    id: "deadline",
    label: "마감 임박 (7일)",
    read: ({ summary }) => countCard(summary.bids.deadlineWithin7Days),
  },
  {
    id: "ingest",
    label: "수집",
    read: ({ summary, now }) => ingestCard(summary.dataFreshness, now),
  },
  {
    id: "analyses",
    label: "분석 현황",
    read: ({ summary }) => analysesCard(summary.analyses.latestByStatus),
  },
];
