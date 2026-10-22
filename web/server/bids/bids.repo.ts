import "server-only";
import type { AnalysisView } from "./analysis-view.model";
import type { BidListQuery, CursorPayload } from "./bid-query";
import type { AnalysisStatus, BidListItem, BidRevisionSummary, Recommendation } from "./bid.model";
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
  // 중복 판정은 입력 전체로 한다(04 §5 부분 UNIQUE 는 company_profile_id 를 쓴다).
  companyProfileId: string;
  profileRevision: number;
  revisionId: string;
  extractionId: string | null;
  algorithmVersion: string;
  stage?: BidListItem["stage"];
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
// IDEMPOTENCY_KEY 충돌은 run 을 싣지 않는다. 서비스가 findIdempotency 로 첫 요청을 다시 찾는다.
export type CreateRunResult =
  { created: RunRef } | { conflict: "ACTIVE_INPUT"; run: RunRef } | { conflict: "IDEMPOTENCY_KEY" };

export interface BidsRepo {
  getRevisionHistory(
    bidId: string,
  ): Promise<{ title: string; revisions: BidRevisionSummary[] } | null>;
  getRevisionSnapshots(
    bidId: string,
    revisions: number[],
  ): Promise<{ revision: number; normalized: unknown }[]>;
  listBids(orgId: string, query: BidListQuery, after: ListAfter): Promise<PagedRows<BidListItem>>;
  // listBids 와 같은 조건(커서·정렬·페이지 크기 제외)의 전체 건수
  countBids(orgId: string, query: BidListQuery): Promise<number>;
  getBid(orgId: string, id: string): Promise<BidDetail | null>;
  // 공고가 있는지(다른 조직의 자원이 아니라 공고 자체). 공고는 모든 조직이 같이 본다.
  bidExists(orgId: string, bidId: string): Promise<boolean>;
  listAnalyses(
    orgId: string,
    bidId: string,
    limit: number,
    after: ListAfter,
  ): Promise<PagedRows<AnalysisView>>;
  // 이 조직의 최신 점수 run(COMPLETED·PARTIAL). 없으면 null
  getLatestScoredAnalysis(orgId: string, bidId: string): Promise<AnalysisView | null>;
  getAnalysis(orgId: string, id: string): Promise<AnalysisView | null>;
  // 가정 재계산(BOOST-2)용: run 의 상태와 입력 스냅샷만 읽는다. 없거나 다른 조직이면 null
  getAnalysisSnapshot(
    orgId: string,
    id: string,
  ): Promise<{ status: AnalysisStatus; inputSnapshot: unknown } | null>;
  // 같은 입력(공고 revision·프로필 revision·알고리즘, 04 §5 부분 UNIQUE)의 QUEUED·RUNNING run
  findRunningAnalysis(orgId: string, bidId: string, input: AnalysisInput): Promise<RunRef | null>;
  // 같은 입력의 완료(COMPLETED·PARTIAL) run 중 최신
  findCompletedSameInput(
    orgId: string,
    bidId: string,
    input: AnalysisInput,
  ): Promise<RunRef | null>;
  // 분석 입력(최신 revision·추출 캐시·알고리즘 버전). 프로필 revision 이 없으면 null
  resolveAnalysisInput(
    orgId: string,
    bidId: string,
    profileRevision: number | undefined,
  ): Promise<AnalysisInput | null>;
  // QUEUED 행을 만든다. run_mode·ai_provider 는 worker 가 덮어쓴다.
  // UNIQUE 충돌(동시 요청)은 던지지 않고 conflict 로 돌려준다. run 은 이미 있는 쪽이다.
  createAnalysisRun(input: CreateAnalysisRun): Promise<CreateRunResult>;
  // 큐에 넣지 못한 run 을 FAILED 로 표시한다. 두 가지를 한다.
  // ① active 부분 UNIQUE 인덱스에서 빠진다. ② 그 run 의 idempotency_key 를 null 로 풀어,
  // 같은 Idempotency-Key 재시도가 FAILED run 을 재생하지 않고 새 run 을 만들게 한다(접수 실패는 재생 대상이 아니다).
  markRunFailed(orgId: string, scoreRunId: string, errorCode: string): Promise<void>;
  // 저장 멱등 키로 처음 요청을 찾는다
  findIdempotency(orgId: string, key: string): Promise<{ requestHash: string; run: RunRef } | null>;
}

// 분석 큐 포트. 큐 이름·jobId 규칙은 B1 어댑터가 맡는다(분석 worker 의 job 데이터와 같은 모양).
export interface AnalysisQueue {
  enqueue(job: { orgId: string; scoreRunId: string; idempotencyKey: string }): Promise<void>;
}

// 분석 요청 속도 제한 포트(조직당 30회/분). 구현은 app 층(Redis)이 맡는다.
export interface AnalysisRateLimiter {
  hit(orgId: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
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
  // 공고의 결정 이력(이 조직 것만). 공고가 없으면 null, 결정이 없거나 다른 조직이면 []
  listReviews(orgId: string, bidId: string): Promise<Review[] | null>;
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
  activeProjects: number;
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

// 업무 틀(layout) 상단바가 쓰는 두 값. 공고 집계·AI 상태 없이 읽는다(M3).
export type DashboardStatusSource = Pick<DashboardSource, "dataFreshness" | "unreadNotifications">;

export interface DashboardRepo {
  load(orgId: string, origin: "live" | "demo" | "all"): Promise<DashboardSource>;
  // 수집 신선도와 안 읽은 알림 수만 읽는다. AI 프로브를 부르지 않는다.
  loadStatus(origin: "live" | "demo" | "all"): Promise<DashboardStatusSource>;
}
