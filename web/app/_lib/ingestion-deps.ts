import "server-only";
import { cursorScope, readCursorSecret, signCursor, verifyCursor } from "@/server/bids";
import {
  ingestionAdminRepo,
  type IngestionAdminDeps,
  type IngestionRunCursor,
} from "@/server/ingestion";
import { describeQueueError } from "./analysis-queue";
import { createIdempotencyStore } from "./idempotency-store";
import { createIngestQueue } from "./ingest-queue";
import { createAnalysisRateLimiter } from "./rate-limit";
import { currentRunMode } from "./run-mode";

// 수집 관리(N8) Route Handler·화면이 서비스에 주입하는 의존성 묶음.
// 수집 도메인은 공고 도메인을 부르지 않으므로 HMAC 커서는 여기(app 층)서 공고 도메인의 서명 도구로 만든다.

// 수동 수집은 조직당 분당 5회이고 분석과 따로 센다(계획서 §1-4).
const INGEST_LIMIT_PER_MINUTE = 5;

// 조직이 지문에 들어간 커서. 다른 조직이 받은 커서는 지문이 달라 거절된다(보안 L3). 24시간 만료는 verifyCursor 가 본다.
function ingestionRunCursor(orgId: string, secret: string): IngestionRunCursor {
  const scope = cursorScope("ingestionRuns", [orgId]);
  return {
    sign: ({ startedAt, id }) =>
      signCursor(
        { sortValue: startedAt, id, queryFingerprint: scope, issuedAt: Date.now() },
        secret,
      ),
    verify: (token) => {
      const verified = verifyCursor(token, scope, secret, Date.now());
      if (!verified.ok) return null;
      const { sortValue, id } = verified.payload;
      return typeof sortValue === "string" ? { startedAt: sortValue, id } : null;
    },
  };
}

// env 는 부를 때 읽는다(모듈을 불러올 때 읽으면 빌드 시점 값이 굳는다). orgId 는 업무 조직(ctx.orgId)이다.
export function ingestionDeps(orgId: string): IngestionAdminDeps {
  const redisUrl = process.env.REDIS_URL;
  // 32자 미만·공백뿐이면 null → 목록이 503 {component:"cursor"} 다(O9).
  const secret = readCursorSecret(process.env.API_CURSOR_SECRET);
  return {
    repo: ingestionAdminRepo,
    queue: createIngestQueue({ redisUrl }),
    idempotency: createIdempotencyStore({ redisUrl }),
    limiter: createAnalysisRateLimiter({
      redisUrl,
      keyPrefix: "ingest",
      limitPerMinute: INGEST_LIMIT_PER_MINUTE,
    }),
    runMode: currentRunMode(),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    cursor: secret === null ? null : ingestionRunCursor(orgId, secret),
    // 원인 로그. 접속 문자열의 비밀은 describeQueueError 가 가린다. 응답에는 싣지 않는다.
    onInfraError: (component, error) => {
      console.error(
        JSON.stringify({
          event: component === "queue" ? "ingest_enqueue_failed" : "ingest_redis_failed",
          component,
          message: describeQueueError(error),
        }),
      );
    },
  };
}
