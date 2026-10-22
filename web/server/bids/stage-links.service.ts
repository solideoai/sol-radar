import "server-only";
import {
  linkStages,
  titleSimilarity,
  STAGE_LINK_CANDIDATE_MIN_SIMILARITY,
  type StageLinkInput,
} from "@/server/ingestion";
import { effectiveStatus, type BidStage } from "./bid.model";
import { fail, type ServiceResult } from "./bids.service";
import type { StageLinkRow, StageLinksRepo } from "./stage-links.repo";
import type { StageLinkCandidateItem, StageLinkItem, StageLinksView } from "./stage-links.model";

// 단계 연결(P0-8, 07 §4). 발주계획 → 사전규격 → 입찰공고를 공개 식별자로만 잇고,
// 식별자 없이 제목만 비슷한 공고는 사람이 볼 연결 후보로만 낸다(자동으로 잇지 않는다).
// 규칙은 수집 도메인의 순수 함수 linkStages 하나다. 여기서는 지금 공고가 낀 쌍만 고른다.

/** 후보 풀 상한(가정값). 상세 한 번 읽을 때 비교하는 다른 단계 공고 수를 묶는다. */
export const STAGE_LINK_POOL_LIMIT = 300;
/** 화면에 내는 연결 후보 최대 건수. */
export const STAGE_LINK_CANDIDATE_LIMIT = 3;
/** 식별자 질의 하나가 읽는 건수이자 화면에 내는 연결 최대 건수(가정값). 같은 planRef 공고가 많아도 한 번 읽기를 묶는다. */
export const STAGE_LINK_LINKED_LIMIT = 50;

const STAGE_ORDER: Readonly<Record<BidStage, number>> = {
  PLAN: 0,
  PROCUREMENT_REQUEST: 1,
  PRE_SPEC: 2,
  NOTICE: 3,
  OPENING: 4,
  AWARD: 5,
  CONTRACT: 6,
};
const sourceFamily = (source: string): string => (source.startsWith("g2b-") ? "g2b" : source);
// A reference number is meaningful only within its provider and confirmed agency identity.
const sameIdentityScope = (a: StageLinkRow, b: StageLinkRow): boolean =>
  sourceFamily(a.source) === sourceFamily(b.source) &&
  a.procuring_agency_id !== null &&
  a.procuring_agency_id === b.procuring_agency_id;

const toInput = (row: StageLinkRow): StageLinkInput => ({
  bidId: row.id,
  stage: row.stage,
  noticeId: row.notice_id,
  planRef: row.plan_ref,
  preSpecRef: row.pre_spec_ref,
  title: row.title,
});

type Judged =
  | { kind: "linked"; row: StageLinkRow; basis: StageLinkItem["basis"] }
  | { kind: "candidate"; row: StageLinkRow; similarity: number };

// 지금 공고와 한 행을 한 쌍으로만 본다(전체 쌍을 만들지 않는다).
function judge(anchor: StageLinkRow, row: StageLinkRow): Judged | null {
  const { links, candidates } = linkStages([toInput(anchor), toInput(row)]);
  const link = links[0];
  if (link !== undefined && sameIdentityScope(anchor, row))
    return { kind: "linked", row, basis: link.basis };
  if (link !== undefined) {
    const similarity = titleSimilarity(anchor.title, row.title);
    return similarity >= STAGE_LINK_CANDIDATE_MIN_SIMILARITY
      ? { kind: "candidate", row, similarity }
      : null;
  }
  const candidate = candidates[0];
  if (candidate !== undefined) return { kind: "candidate", row, similarity: candidate.similarity };
  return null;
}

const byStageThenNotice = (a: StageLinkItem, b: StageLinkItem): number =>
  STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.noticeId.localeCompare(b.noticeId);

export async function getStageLinks(
  bidId: string,
  deps: { repo: StageLinksRepo; now?: Date },
): Promise<ServiceResult<StageLinksView>> {
  const anchor = await deps.repo.findAnchor(bidId);
  if (anchor === null) {
    return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
  }
  const related = await deps.repo.findRelated(anchor, {
    pool: STAGE_LINK_POOL_LIMIT,
    identifier: STAGE_LINK_LINKED_LIMIT,
  });
  const now = deps.now ?? new Date();
  // repo 가 같은 is_demo 만 주지만, 가상 공고와 실공고가 섞이지 않게 여기서도 한 번 더 거른다.
  const judged = related
    .filter((row) => row.id !== anchor.id && row.is_demo === anchor.is_demo)
    .map((row) => judge(anchor, row))
    .filter((entry): entry is Judged => entry !== null);

  const linked: StageLinkItem[] = judged
    .flatMap((entry) => (entry.kind === "linked" ? [entry] : []))
    .map(({ row, basis }) => ({
      bidId: row.id,
      stage: row.stage,
      noticeId: row.notice_id,
      title: row.title,
      agency: row.agency,
      status: effectiveStatus(row.status, row.deadline_at, now),
      basis,
    }))
    .sort(byStageThenNotice)
    .slice(0, STAGE_LINK_LINKED_LIMIT);

  // 취소된 공고는 후보로 내지 않는다(사람이 이어 볼 까닭이 없다). 식별자로 이어진 취소 공고는 linked 에 남는다.
  // 같은 유사도는 repo 순서(최근 게시일 먼저)를 지킨다(Array.prototype.sort 는 안정 정렬이다).
  const candidates: StageLinkCandidateItem[] = judged
    .flatMap((entry) => (entry.kind === "candidate" ? [entry] : []))
    .filter(({ row }) => row.status !== "CANCELLED")
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, STAGE_LINK_CANDIDATE_LIMIT)
    .map(({ row }) => ({
      bidId: row.id,
      stage: row.stage,
      noticeId: row.notice_id,
      title: row.title,
      agency: row.agency,
    }));

  return { ok: true, status: 200, data: { linked, candidates } };
}
