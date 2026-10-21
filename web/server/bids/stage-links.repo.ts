import "server-only";
import type { BidStage, BidStatus } from "./bid.model";

// 단계 연결을 계산할 때 읽는 공고 한 줄. bid_notices 의 열 그대로다.
export type StageLinkRow = {
  id: string;
  stage: BidStage;
  notice_id: string;
  plan_ref: string | null;
  pre_spec_ref: string | null;
  title: string;
  agency: string | null;
  status: BidStatus;
  deadline_at: string | null;
  is_demo: boolean;
};

// 한 번 읽을 때의 상한. pool 은 후보 풀 건수, identifier 는 식별자 질의 하나가 읽는 건수다.
export type StageLinkLimits = { pool: number; identifier: number };

export type StageLinksRepo = {
  // 지금 공고. 없으면(또는 RLS 가 가리면) null.
  findAnchor(bidId: string): Promise<StageLinkRow | null>;
  // 지금 공고와 같은 is_demo 인 행 가운데 식별자가 맞는 행(질의마다 limits.identifier 건)과,
  // 단계가 다른 최근 공고(후보 풀, limits.pool 건). 지금 공고는 빼고, 같은 행이 두 번 오지 않는다.
  findRelated(anchor: StageLinkRow, limits: StageLinkLimits): Promise<StageLinkRow[]>;
};
