import "server-only";
import { z } from "zod";
import { bidStageSchema, bidStatusSchema } from "./bid.model";

// ── 단계 연결(P0-8, 07 §4). 상세 화면의 "같은 사업의 다른 단계 공고" 구역이 받는 꼴 ──
// 연결은 저장하지 않고 읽을 때 계산한다. 식별자로 이어진 것만 linked 이고, 제목이 비슷한 것은 candidates 로만 낸다.

export const stageLinkBasisSchema = z.enum(["PLAN_REF", "PRE_SPEC_REF"]);

export const stageLinkItemSchema = z.strictObject({
  bidId: z.string(),
  stage: bidStageSchema,
  noticeId: z.string(),
  title: z.string(),
  agency: z.string().nullable(),
  status: bidStatusSchema,
  basis: stageLinkBasisSchema,
});

export const stageLinkCandidateItemSchema = z.strictObject({
  bidId: z.string(),
  stage: bidStageSchema,
  noticeId: z.string(),
  title: z.string(),
  agency: z.string().nullable(),
});

export const stageLinksViewSchema = z.strictObject({
  linked: z.array(stageLinkItemSchema),
  candidates: z.array(stageLinkCandidateItemSchema),
});

export type StageLinkBasis = z.infer<typeof stageLinkBasisSchema>;
export type StageLinkItem = z.infer<typeof stageLinkItemSchema>;
export type StageLinkCandidateItem = z.infer<typeof stageLinkCandidateItemSchema>;
export type StageLinksView = z.infer<typeof stageLinksViewSchema>;
