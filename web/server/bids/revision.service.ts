import "server-only";
import type { BidRevisionSummary } from "./bid.model";
import type { BidsRepo } from "./bids.repo";
import { fail, type ServiceResult } from "./bids.service";
import { toRevisionChanges } from "./revision-diff";
import {
  revisionSnapshotSchema,
  type RevisionComparison,
  type RevisionRef,
  type RevisionSnapshot,
} from "./revision.model";

// 공고 변경 이력. 공고는 모든 조직이 같이 보므로 orgId 는 저장소에 넘기지 않는다(RLS 가 읽기를 맡는다).
// 바뀐 항목 목록은 수집이 저장한 changed_fields 를 믿는다(bids 는 ingestion 을 import 하지 않는다).

const REVISION_PARAM = /^[1-9]\d{0,5}$/;

const noBid = () => fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다", { resource: "bid" });
const noRevision = () =>
  fail(404, "NOT_FOUND", "변경 이력을 찾을 수 없습니다", { resource: "revision" });

// 경로의 revision 번호. 양의 정수 표기(앞 0·부호·소수 없음, 6자리까지)만 숫자로 읽는다.
export function parseRevisionParam(value: string | undefined): number | null {
  return value !== undefined && REVISION_PARAM.test(value) ? Number(value) : null;
}

const refOf = (summary: BidRevisionSummary): RevisionRef => ({
  revision: summary.revision,
  amendmentNo: summary.amendmentNo,
  fetchedAt: summary.fetchedAt,
});

// 저장된 정규화 값이 스냅샷 모양이 아니면 던진다. 저장 계약이 깨진 것이라 500 으로 드러낸다.
const parseSnapshot = (normalized: unknown): RevisionSnapshot =>
  revisionSnapshotSchema.parse(normalized);

// GET /bids/:id/revisions. revision 내림차순.
export async function listBidRevisions(
  _orgId: string,
  bidId: string,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<BidRevisionSummary[]>> {
  const history = await deps.repo.getRevisionHistory(bidId);
  if (history === null) return noBid();
  return { ok: true, status: 200, data: history.revisions };
}

// GET /bids/:id/revisions/:rev. 그 revision 의 정규화 스냅샷.
export async function getBidRevision(
  _orgId: string,
  bidId: string,
  revision: number,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<RevisionSnapshot>> {
  const history = await deps.repo.getRevisionHistory(bidId);
  if (history === null) return noBid();
  if (!history.revisions.some((row) => row.revision === revision)) return noRevision();
  const [row] = await deps.repo.getRevisionSnapshots(bidId, [revision]);
  if (row === undefined) return noRevision();
  return { ok: true, status: 200, data: parseSnapshot(row.normalized) };
}

// 화면용 전/후 비교. revision 이 null 이면 가장 높은 번호, previous 는 그보다 하나 낮은 번호(있을 때).
export async function compareBidRevision(
  _orgId: string,
  bidId: string,
  revision: number | null,
  deps: { repo: BidsRepo },
): Promise<ServiceResult<RevisionComparison>> {
  const history = await deps.repo.getRevisionHistory(bidId);
  if (history === null) return noBid();
  const { title, revisions } = history;
  const current =
    revision === null
      ? revisions.reduce<BidRevisionSummary | undefined>(
          (top, row) => (top === undefined || row.revision > top.revision ? row : top),
          undefined,
        )
      : revisions.find((row) => row.revision === revision);
  if (current === undefined) return noRevision();
  const previous = revisions.find((row) => row.revision === current.revision - 1);

  const wanted =
    previous === undefined ? [current.revision] : [previous.revision, current.revision];
  const snapshots = await deps.repo.getRevisionSnapshots(bidId, wanted);
  const currentRow = snapshots.find((row) => row.revision === current.revision);
  if (currentRow === undefined) return noRevision();
  const after = parseSnapshot(currentRow.normalized);
  const previousRow =
    previous === undefined
      ? undefined
      : snapshots.find((row) => row.revision === previous.revision);
  const before = previousRow === undefined ? null : parseSnapshot(previousRow.normalized);

  return {
    ok: true,
    status: 200,
    data: {
      bidId,
      title,
      revisions,
      current: refOf(current),
      previous: previous === undefined ? null : refOf(previous),
      cancelled: after.status === "CANCELLED",
      changes: before === null ? [] : toRevisionChanges(current.changedFields, before, after),
    },
  };
}
