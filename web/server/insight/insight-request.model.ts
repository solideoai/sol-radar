import "server-only";
import type { SolRole } from "@/server/organization";
import type { InsightAccepted, InsightJobData, InsightView } from "./insight.model";

// ── 추천 분석 요청·조회(C2)의 저장 포트와 결과 모양 ──
// 공통 계약(insight.model.ts)은 표·큐·화면이 함께 쓰고, 이 파일은 Route Handler 와 서비스 사이만 쓴다.

/** 화면·Route Handler 가 확인한 지금 조직·사용자·업무 역할. 조직은 서버가 정한다(M17). */
export type InsightContext = { orgId: string; userId: string; role: SolRole };

/** 추천 분석을 붙일 분석 run. 같은 조직의 run 만 돌려준다. */
export type InsightRunRef = { id: string; bidId: string; status: string };

/** 저장 포트. 구현(insight.repo)은 사용자 JWT 클라이언트로 부르고, 조직 격리는 RLS 가 한다. */
export type InsightRepo = {
  findRun(orgId: string, runId: string): Promise<InsightRunRef | null>;
  /** 그 run 의 가장 최근 요청 1건. 없으면 null. */
  latestInsight(orgId: string, runId: string): Promise<InsightView | null>;
  /** PENDING 행을 넣고 id 를 돌려준다. 같은 run 에 PENDING·모델 설명이 이미 있으면(유일·제외 위반) null. */
  insertPending(orgId: string, runId: string): Promise<string | null>;
};

/** 사용자당 분당 요청 수 제한. 구현은 app 층(Redis)의 createAnalysisRateLimiter 다. */
export type InsightRateLimiter = {
  hit(key: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
};

export type InsightRequestDeps = {
  repo: InsightRepo;
  enqueue: (data: InsightJobData) => Promise<void>;
  limiter: InsightRateLimiter;
  // Redis 계열 장애(속도 제한 "redis", 큐 등록 "queue")의 원인 로그. 응답에는 싣지 않는다.
  onInfraError: (component: "queue" | "redis", error: unknown) => void;
};

// 새 오류 코드는 만들지 않는다(05 의 코드만).
type InsightFailure = {
  ok: false;
  status: 403 | 404 | 429 | 503;
  code: "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE";
  message: string;
  details: Record<string, unknown>;
};

export type InsightRequestResult =
  { ok: true; status: 202; data: InsightAccepted } | InsightFailure;
export type InsightReadResult =
  { ok: true; status: 200; data: { insight: InsightView | null } } | InsightFailure;
