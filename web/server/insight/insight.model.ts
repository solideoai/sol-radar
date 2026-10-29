import "server-only";
import { z } from "zod";

// ── 추천 분석(ADR-066)의 공통 계약: 표·큐·화면이 함께 쓰는 이름과 모양 ──
// 요청 하나가 recommendation_insights 한 행이다. 화면 POST → redis-api 가 PENDING 행·insight job → Analysis Worker 가
// gateway POST /insight(Qwen) 결과로 DONE·FAILED 로 닫는다. 판정(점수·권고)은 바꾸지 않고 이유·강점·보완할 점만 담는다.

export const INSIGHT_QUEUE = "insight";
export const INSIGHT_JOB = "explain";
/** 이보다 오래된 PENDING 은 worker 가 FAILED(STALE)로 닫는다. */
export const INSIGHT_STALE_MS = 10 * 60 * 1000;
/** 화면이 PENDING 을 묻는 최대 시간. 넘으면 늦음 안내를 보인다. */
export const INSIGHT_POLL_LIMIT_MS = 3 * 60 * 1000;
/** 추천 분석을 요청할 수 있는 업무 역할(분석 실행과 같다). */
export const INSIGHT_REQUEST_ROLES = ["ADMIN", "SALES", "ANALYST"] as const;

export const insightStatusSchema = z.enum(["PENDING", "DONE", "FAILED"]);
export type InsightStatus = z.infer<typeof insightStatusSchema>;

/** DONE 의 출처. MODEL = 검증을 통과한 Qwen 출력, TEMPLATE = gateway 가 규칙 결과로 만든 대체 문장. */
export const insightSourceSchema = z.enum(["MODEL", "TEMPLATE"]);
export type InsightSource = z.infer<typeof insightSourceSchema>;

/**
 * gateway 가 TEMPLATE 로 대체한 이유. gateway 응답 fallbackReason 과 같은 이름이다.
 * INJECTION_SUSPECTED 는 입력(run 의 인젝션 의심 플래그나 gateway guard)이 의심스러워 모델을 부르지 않은 경우다(보안 리뷰 중-2).
 */
export const insightFallbackReasonSchema = z.enum([
  "MODEL_UNAVAILABLE",
  "INVALID_OUTPUT",
  "FORBIDDEN_WORD",
  "UNKNOWN_NUMBER",
  "UNKNOWN_REF",
  "LABEL_CONFLICT",
  "INJECTION_SUSPECTED",
]);
export type InsightFallbackReason = z.infer<typeof insightFallbackReasonSchema>;

/** FAILED 의 이유. worker 가 쓴다. */
export const insightErrorCodeSchema = z.enum([
  "GATEWAY_UNAVAILABLE",
  "GATEWAY_INVALID",
  "SOURCE_INVALID",
  "STALE",
]);
export type InsightErrorCode = z.infer<typeof insightErrorCodeSchema>;

/** 근거 번호. B = 공고 원문 인용, C = 회사 자료. 1~99. */
export const insightRefIdSchema = z.string().regex(/^[BC][1-9]\d?$/);

export const insightRefSchema = z.object({
  id: insightRefIdSchema,
  kind: z.enum(["BID", "COMPANY"]),
  label: z.string().min(1).max(80),
  quotedText: z.string().min(1).max(300),
});
export type InsightRef = z.infer<typeof insightRefSchema>;

export const insightItemSchema = z.object({
  text: z.string().min(1).max(200),
  refIds: z.array(insightRefIdSchema).max(4),
});
export type InsightItem = z.infer<typeof insightItemSchema>;

/** recommendation_insights.payload. 항목이 가리키는 근거는 refs 에 있어야 한다. */
export const insightPayloadSchema = z
  .object({
    summary: z.string().min(1).max(400),
    strengths: z.array(insightItemSchema).max(4),
    improvements: z.array(insightItemSchema).max(4),
    refs: z.array(insightRefSchema).max(24),
  })
  .superRefine((payload, ctx) => {
    const known = new Set(payload.refs.map((ref) => ref.id));
    for (const [group, items] of [
      ["strengths", payload.strengths],
      ["improvements", payload.improvements],
    ] as const) {
      items.forEach((item, index) => {
        item.refIds.forEach((refId, refIndex) => {
          if (!known.has(refId)) {
            ctx.addIssue({
              code: "custom",
              path: [group, index, "refIds", refIndex],
              message: "refs 에 없는 근거 번호",
            });
          }
        });
      });
    }
  });
export type InsightPayload = z.infer<typeof insightPayloadSchema>;

/** insight 큐 job 데이터. 행 내용은 worker 가 표에서 다시 읽는다. */
export const insightJobDataSchema = z.object({ insightId: z.uuid(), orgId: z.uuid() });
export type InsightJobData = z.infer<typeof insightJobDataSchema>;

/** BullMQ jobId. 같은 행은 같은 id 라 다시 넣어도 job 이 하나다(사용자 id 에는 ':' 을 쓰지 않는다). */
export function insightJobId(insightId: string): string {
  return `insight-${insightId}`;
}

/** 화면·GET 이 받는 한 건. */
export type InsightView = {
  id: string;
  scoreRunId: string;
  status: InsightStatus;
  /** DONE 일 때만 값이 있다. */
  source: InsightSource | null;
  payload: InsightPayload | null;
  fallbackReason: InsightFallbackReason | null;
  modelName: string | null;
  /** FAILED 일 때만 값이 있다. */
  errorCode: InsightErrorCode | null;
  createdAt: string;
  finishedAt: string | null;
};

/** POST 202 본문. deduplicated = 새 행을 만들지 않고 있던 PENDING·DONE(MODEL) 행을 돌려줬다. */
export type InsightAccepted = {
  insightId: string;
  status: InsightStatus;
  deduplicated: boolean;
  pollUrl: string;
};
