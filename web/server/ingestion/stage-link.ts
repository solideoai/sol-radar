import "server-only";
import type { BidStage } from "./normalized-bid.model";
import { normText } from "./text-normalize";

// ── 07 §4 단계 연결: 공개 식별자로만 잇고, 제목이 비슷한 것은 사람이 볼 후보로만 낸다 ──
export type StageLinkInput = {
  bidId: string;
  stage: BidStage;
  noticeId: string;
  planRef?: string | null;
  preSpecRef?: string | null;
  title: string;
};
export type StageLink = { fromBidId: string; toBidId: string; basis: "PLAN_REF" | "PRE_SPEC_REF" };
export type StageLinkCandidate = { bidIdA: string; bidIdB: string; similarity: number };

/** 가정값이다. fixture 실측: FX-01↔FX-19 0.529, 그다음으로 높은 쌍 0.258. */
export const STAGE_LINK_CANDIDATE_MIN_SIMILARITY = 0.5;

const STAGE_ORDER: Readonly<Record<BidStage, number>> = { PLAN: 0, PRE_SPEC: 1, NOTICE: 2 };
// 단계마다 제목에 붙는 말이라 같은 사업인지 가리는 데 도움이 되지 않는다.
const STAGE_TITLE_WORDS = ["(가상)", "사전규격", "발주계획"] as const;

type BidPair = readonly [StageLinkInput, StageLinkInput];

function titleKey(title: string): string {
  const withoutStageWords = STAGE_TITLE_WORDS.reduce(
    (text, word) => text.replaceAll(word, ""),
    normText(title),
  );
  return withoutStageWords.replace(/\s+/g, "");
}

// 글자는 코드 포인트로 센다(서로게이트 쌍을 반으로 가르지 않는다).
function bigramCounts(text: string): Map<string, number> {
  const chars = Array.from(text);
  const bigrams = chars.slice(1).map((char, index) => `${chars[index]}${char}`);
  return bigrams.reduce(
    (counts, bigram) => counts.set(bigram, (counts.get(bigram) ?? 0) + 1),
    new Map<string, number>(),
  );
}

const totalCount = (counts: ReadonlyMap<string, number>): number =>
  [...counts.values()].reduce((sum, count) => sum + count, 0);

/** 글자 2-gram 다중집합의 Dice 계수. 2글자 미만이면 비교할 2-gram 이 없어 0 이다. */
export function titleSimilarity(a: string, b: string): number {
  const countsA = bigramCounts(titleKey(a));
  const countsB = bigramCounts(titleKey(b));
  const sizeA = totalCount(countsA);
  const sizeB = totalCount(countsB);
  if (sizeA === 0 || sizeB === 0) return 0;
  const shared = [...countsA].reduce(
    (sum, [bigram, count]) => sum + Math.min(count, countsB.get(bigram) ?? 0),
    0,
  );
  return (2 * shared) / (sizeA + sizeB);
}

const hasValue = (reference: string | null | undefined): reference is string =>
  typeof reference === "string" && reference.trim() !== "";

function planRefLink(a: StageLinkInput, b: StageLinkInput): StageLink | null {
  if (!hasValue(a.planRef) || a.planRef !== b.planRef || a.stage === b.stage) return null;
  const [from, to] = STAGE_ORDER[a.stage] < STAGE_ORDER[b.stage] ? [a, b] : [b, a];
  return { fromBidId: from.bidId, toBidId: to.bidId, basis: "PLAN_REF" };
}

const refersToPreSpec = (preSpec: StageLinkInput, bid: StageLinkInput): boolean =>
  preSpec.stage === "PRE_SPEC" && hasValue(bid.preSpecRef) && bid.preSpecRef === preSpec.noticeId;

function preSpecRefLink(a: StageLinkInput, b: StageLinkInput): StageLink | null {
  if (refersToPreSpec(a, b)) return { fromBidId: a.bidId, toBidId: b.bidId, basis: "PRE_SPEC_REF" };
  if (refersToPreSpec(b, a)) return { fromBidId: b.bidId, toBidId: a.bidId, basis: "PRE_SPEC_REF" };
  return null;
}

// 순서 없는 쌍의 키. 같은 쌍을 PLAN_REF·PRE_SPEC_REF 로 두 번 잇거나 후보로 다시 내지 않게 한다.
const pairKey = (idA: string, idB: string): string => JSON.stringify([idA, idB].sort());

export function linkStages(bids: readonly StageLinkInput[]): {
  links: StageLink[];
  candidates: StageLinkCandidate[];
} {
  const pairs: BidPair[] = bids.flatMap((a, index) =>
    bids.slice(index + 1).map((b): BidPair => [a, b]),
  );

  const links = pairs.flatMap(([a, b]) => {
    const link = planRefLink(a, b) ?? preSpecRefLink(a, b);
    return link ? [link] : [];
  });
  const linkedPairs = new Set(links.map(({ fromBidId, toBidId }) => pairKey(fromBidId, toBidId)));

  // 같은 유사도는 입력 순서를 지킨다(Array.prototype.sort 는 안정 정렬이다).
  const candidates = pairs
    .filter(([a, b]) => a.stage !== b.stage && !linkedPairs.has(pairKey(a.bidId, b.bidId)))
    .map(([a, b]) => ({
      bidIdA: a.bidId,
      bidIdB: b.bidId,
      similarity: titleSimilarity(a.title, b.title),
    }))
    .filter(({ similarity }) => similarity >= STAGE_LINK_CANDIDATE_MIN_SIMILARITY)
    .sort((left, right) => right.similarity - left.similarity);

  return { links, candidates };
}
