import "server-only";
import {
  AWARD_WIDEN_STEPS,
  buildAwardReference,
  lookbackStartOf,
  periodMonthsOf,
  type AwardReference,
  type AwardReferenceRepo,
} from "./award-reference.model";
import { awardReferenceRepo } from "./award-reference.repo";

// ── 서비스: 공고 상세의 참고 낙찰가 범위 ──
// 로그인·업무 조직은 화면 가드가 이미 봤다. 읽기 전용이고 무엇이 보이는지는 RLS(활동 중 회원 읽기)가 정한다.
// 후보는 가장 넓은 단계(분류 또는 중분류, 1/3~3배)로 한 번에 읽고, 단계별 거르기는 순수 함수(selectSample)가 한다.

type Deps = { repo?: AwardReferenceRepo; now?: Date };

const WIDEST_MIN = Math.min(...AWARD_WIDEN_STEPS.map((spec) => spec.min));
const WIDEST_MAX = Math.max(...AWARD_WIDEN_STEPS.map((spec) => spec.max));

/** 카드 값. 카드 대상이 아닌 공고이거나 낙찰 이력 표가 비어 있으면(수집 전) null 이라 카드를 그리지 않는다. */
export async function getAwardReference(
  bidId: string,
  { repo = awardReferenceRepo, now = new Date() }: Deps = {},
): Promise<AwardReference | null> {
  const target = await repo.loadTarget(bidId);
  if (target === null) return null;
  const base = target.base.amountKrw;
  const [candidates, meta] = await Promise.all([
    repo.loadCandidates({
      classNo: target.classNo,
      midClassName: target.midClassName,
      group: target.group,
      // 기준금액 열은 정수(bigint)라 경계를 정수로 넓혀 둔다. 정확한 금액대는 selectSample 이 다시 거른다.
      minBase: Math.floor(base * WIDEST_MIN),
      maxBase: Math.ceil(base * WIDEST_MAX),
      openedSince: lookbackStartOf(now),
    }),
    repo.loadDatasetMeta(),
  ]);
  if (meta.dataAsOf === null || meta.earliestOpenedAt === null) return null;
  return buildAwardReference(target, candidates, {
    dataAsOf: meta.dataAsOf,
    periodMonths: periodMonthsOf(meta.earliestOpenedAt, now),
  });
}
