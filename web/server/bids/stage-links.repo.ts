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

export type StageLinksRepo = {
  // 지금 공고. 없으면(또는 RLS 가 가리면) null.
  findAnchor(bidId: string): Promise<StageLinkRow | null>;
  // 지금 공고와 같은 is_demo 인 행 가운데 식별자가 맞는 행과, 단계가 다른 최근 공고(후보 풀, poolLimit 건).
  // 지금 공고는 빼고, 같은 행이 두 번 오지 않는다.
  findRelated(anchor: StageLinkRow, poolLimit: number): Promise<StageLinkRow[]>;
};
