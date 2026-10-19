import "server-only";
import type { RunMode } from "@/server/analysis";
import {
  createBidsRepo,
  createDashboardRepo,
  notificationRepo,
  readCursorSecret,
  reviewRepo,
  type AnalysisQueue,
  type AnalysisRateLimiter,
  type BidsRepo,
  type DashboardRepo,
  type NotificationRepo,
  type ReviewRepo,
} from "@/server/bids";
import { getAiState } from "@/server/health";
import { ALGORITHM_VERSION } from "@/server/scoring";
import { createAnalysisQueue, describeQueueError } from "./analysis-queue";
import { createAnalysisRateLimiter } from "./rate-limit";
import { currentRunMode } from "./run-mode";

// 업무 Route Handler 가 서비스에 주입하는 의존성 묶음.
export type WorkDeps = {
  bids: BidsRepo;
  reviews: ReviewRepo;
  notifications: NotificationRepo;
  dashboard: DashboardRepo;
  queue: AnalysisQueue;
  limiter: AnalysisRateLimiter;
  cursorSecret: string | null;
  runMode: RunMode;
  // Redis 계열 장애 로그. 접속 비밀은 describeQueueError 가 가린다.
  onInfraError: (component: "queue" | "redis", error: unknown) => void;
};

// env 는 부를 때 읽는다(모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다).
export function workDeps(): WorkDeps {
  const runMode = currentRunMode();
  const redisUrl = process.env.REDIS_URL;
  return {
    bids: createBidsRepo({ runMode, algorithmVersion: ALGORITHM_VERSION }),
    reviews: reviewRepo,
    notifications: notificationRepo,
    dashboard: createDashboardRepo({
      aiStatus: async () => {
        const state = await getAiState();
        return {
          provider: state === "unavailable" ? (runMode === "mock" ? "mock" : "local") : state,
          kevEnabled: process.env.KEV_ENABLED !== "false",
          lastGatewayCheckAt: new Date().toISOString(),
          healthy: state !== "unavailable",
        };
      },
    }),
    queue: createAnalysisQueue({ redisUrl }),
    limiter: createAnalysisRateLimiter({ redisUrl }),
    // 32자 미만·공백뿐이면 null → 커서 목록이 503 {component:"cursor"} 다(O9).
    cursorSecret: readCursorSecret(process.env.API_CURSOR_SECRET),
    runMode,
    onInfraError: (component, error) => {
      console.error(
        JSON.stringify({
          event: component === "queue" ? "analysis_enqueue_failed" : "analysis_rate_limit_failed",
          component,
          message: describeQueueError(error),
        }),
      );
    },
  };
}
