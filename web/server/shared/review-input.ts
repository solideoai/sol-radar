import { z } from "zod";

// 05 §4.6 ReviewInput. 브라우저(DecisionPanel)와 서버(bids 모델)가 같은 규칙을 쓰도록 이 층에 한 번만 둔다.
// 이 층은 아무것도 import 하지 않는다(zod 제외). employment.ts 와 같은 이유다.
export const reviewDecisionSchema = z.enum(["BID", "WATCH", "NO_BID"]);

export const reviewReasonSchema = z
  .string("사유를 입력하세요")
  .trim()
  .min(10, "사유는 10자 이상 입력하세요")
  .max(2000, "사유는 2000자 이하입니다");

export const reviewInputSchema = z.strictObject({
  decision: reviewDecisionSchema,
  reason: reviewReasonSchema,
  scoreRunId: z.string().min(1).optional(),
  assigneeUserId: z.string().min(1).optional(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewInput = z.infer<typeof reviewInputSchema>;
