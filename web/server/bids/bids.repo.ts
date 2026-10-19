import "server-only";
import type { AnalysisView } from "./analysis-view.model";
import type { BidListQuery, CursorPayload } from "./bid-query";
import type { AnalysisStatus, BidListItem, Recommendation } from "./bid.model";
import type { BidDetail } from "./bid-detail.model";
import type { Notification } from "./notification.model";
import type { Review } from "./review.model";

// 저장소 포트: 서비스가 기대하는 모양만 적는다. Supabase 구현은 B1 에서 만든다.
// 조직 격리는 구현체(RLS)가 맡고, 다른 조직 자원은 null 로 돌려준다.

export type ListAfter = CursorPayload | null;
// 한 쪽 결과. last 는 다음 커서를 만드는 마지막 행의 (정렬 키 값, id) 다.
export type PagedRows<T> = {
  items: T[];
  hasNext: boolean;
  last: { sortValue: string | number | null; id: string } | null;
};

export type AnalysisInput = {
  profileRevision: number;
  revisionId: string;
  extractionId: string | null;
  algorithmVersion: string;
};

export type CreateAnalysisRun = AnalysisInput & {
  orgId: string;
  bidId: string;
  requestedBy: string;
  // 저장 멱등 키 `${orgId}:${Idempotency-Key}`. score_runs.idempotency_key 에 들어간다.
  idempotencyKey: string;
  // 같은 키에 같은 본문이 다시 왔는지 가리는 본문 지문.
  requestHash: string;
};

export type RunRef = { id: string; status: AnalysisStatus };

export interface BidsRepo {
  listBids(orgId: string, query: BidListQuery, after: ListAfter): Promise<PagedRows<BidListItem>>;
  getBid(orgId: string, id: string): Promise<BidDetail | null>;
  listAnalyses(orgId: string, bidId: string, after: ListAfter): Promise<PagedRows<AnalysisView>>;
  getAnalysis(orgId: string, id: string): Promise<AnalysisView | null>;
  // 이 공고의 QUEUED·RUNNING run
  findRunningAnalysis(orgId: string, bidId: string): Promise<RunRef | null>;
  // 같은 입력(revision·프로필·알고리즘)의 완료(COMPLETED·PARTIAL) run
  findCompletedSameInput(
    orgId: string,
    bidId: string,
    profileRevision: number,
  ): Promise<RunRef | null>;
  // 분석 입력(최신 revision·추출 캐시·알고리즘 버전). 프로필 revision 이 없으면 null
  resolveAnalysisInput(
    orgId: string,
    bidId: string,
    profileRevision: number | undefined,
  ): Promise<AnalysisInput | null>;
  // QUEUED 행을 만든다. run_mode·ai_provider 는 worker 가 덮어쓴다.
  createAnalysisRun(input: CreateAnalysisRun): Promise<RunRef>;
  // 큐에 넣지 못한 run 을 FAILED 로 표시한다(active 부분 UNIQUE 인덱스를 풀어 준다)
  markRunFailed(orgId: string, scoreRunId: string, errorCode: string): Promise<void>;
  // 저장 멱등 키로 처음 요청을 찾는다
  findIdempotency(orgId: string, key: string): Promise<{ requestHash: string; run: RunRef } | null>;
}

// 분석 큐 포트. 큐 이름·jobId 규칙은 B1 어댑터가 맡는다(분석 worker 의 job 데이터와 같은 모양).
export interface AnalysisQueue {
  enqueue(job: { orgId: string; scoreRunId: string; idempotencyKey: string }): Promise<void>;
}

export type ReviewTarget = {
  revisionId: string;
  // scoreRunId 를 주면 그 run, 없으면 공고의 최신 분석. 없으면 null
  analysis: { id: string; recommendation: Recommendation | null } | null;
};

export type CreateReview = {
  orgId: string;
  bidId: string;
  revisionId: string;
  scoreRunId: string | null;
  reviewerId: string;
  decision: Recommendation;
  reason: string;
  assigneeUserId: string | null;
  systemRecommendationAtDecision: Recommendation | null;
  disagreementFlag: boolean;
};

export interface ReviewRepo {
  // 공고가 없으면 null
  getReviewTarget(orgId: string, bidId: string, scoreRunId?: string): Promise<ReviewTarget | null>;
  // 같은 조직 구성원인지
  isOrgMember(orgId: string, userId: string): Promise<boolean>;
  // bid_reviews + audit_logs (+ REVIEW_ASSIGNED outbox) 를 한 트랜잭션으로 쓴다
  createReview(input: CreateReview): Promise<Review>;
}

export interface NotificationRepo {
  list(
    userId: string,
    query: { unreadOnly: boolean; limit: number },
    after: ListAfter,
  ): Promise<PagedRows<Notification>>;
  markRead(userId: string, id: string): Promise<Notification | null>;
}

export type DashboardAnalysisRow = {
  id: string;
  status: AnalysisStatus;
  recommendation: Recommendation | null;
  reviewFlagCount: number;
  createdAt: string;
};
export type DashboardReviewRow = {
  decision: Recommendation;
  disagreementFlag: boolean;
  decidedAt: string;
};
// 공고 하나의 분석·결정 전체. 최신 1건 고르기는 서비스가 한다.
export type DashboardBidRow = {
  bidId: string;
  title: string;
  stage: BidListItem["stage"];
  status: BidListItem["status"];
  deadlineAt: string | null;
  analyses: DashboardAnalysisRow[];
  reviews: DashboardReviewRow[];
};
export type DashboardSource = {
  bids: DashboardBidRow[];
  dataFreshness: {
    lastIngestAt: string | null;
    lastIngestStatus: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | null;
    lastIngestSummary: {
      created: number;
      changed: number;
      cancelled: number;
      skippedDuplicate: number;
      quarantined: number;
      retried: number;
    } | null;
  };
  ai: {
    provider: "mock" | "local" | "hosted";
    kevEnabled: boolean;
    lastGatewayCheckAt: string | null;
    healthy: boolean;
  };
  unreadNotifications: number;
};

export interface DashboardRepo {
  load(orgId: string, origin: "live" | "demo" | "all"): Promise<DashboardSource>;
}
