import "server-only";
import { insightRepo, type InsightRequestDeps } from "@/server/insight";
import { describeQueueError } from "./analysis-queue";
import { createInsightQueue } from "./insight-queue";
import { createAnalysisRateLimiter } from "./rate-limit";

// 추천 분석 요청(POST)을 직접 처리하는 역할(redis-api·standalone)이 서비스에 주입하는 의존성.
// frontend 는 이 함수를 부르지 않고 회사 API 로 중계한다. 시험은 이 모듈을 가짜로 바꾼다.
// env 는 부를 때 읽는다(모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다).
export function insightDeps(): InsightRequestDeps {
  const redisUrl = process.env.REDIS_URL;
  return {
    repo: insightRepo,
    enqueue: createInsightQueue({ redisUrl }),
    // 키는 사용자 id 다(rate:insight:<userId>:<분>). 분당 3회(C2).
    limiter: createAnalysisRateLimiter({ redisUrl, keyPrefix: "insight", limitPerMinute: 3 }),
    onInfraError: (component, error) => {
      console.error(
        JSON.stringify({
          event: component === "queue" ? "insight_enqueue_failed" : "insight_rate_limit_failed",
          component,
          message: describeQueueError(error),
        }),
      );
    },
  };
}
