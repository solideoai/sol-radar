// 사업 단위 분할(21 §3.6): bidNtceNo·bfSpecRgstNo·orderPlanUntyNo·befBidBbancNo(재공고의 이전 공고)로 union-find 클러스터를
// 만들고 hash(clusterId) 순서로 test 20·dev 10 을 고른다. test·dev 클러스터는 train 에 0건이어야 한다(23 §4.1 5번).
// 순수 함수만 둔다. 파일 읽기·쓰기는 split-eval.mjs 몫이다.
import { createHash } from "node:crypto";
import { budgetBucketOf } from "./g2b-lib.mjs";

export const SPLIT_SCHEMA_VERSION = "sol-eval-split/v0.1";
export const SPLITS = ["test", "dev", "train"];

const present = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

// ── union-find ──
export function createUnionFind() {
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    // 작은 쪽을 큰 쪽에 붙인다(결정적: 문자열 비교).
    if (compare(leftRoot, rightRoot) < 0) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };
  return { find, union };
}

/** 연결 근거가 되는 식별자. 같은 값을 가진 공고끼리 묶인다. */
export const LINK_FIELDS = ["bfSpecRgstNo", "orderPlanUntyNo"];

/**
 * notices: 공고마다 최신 차수 행(latestByNotice 결과). 전체 정보화 공고를 넣는다 — 표본 밖 공고를 거쳐 이어지는 표본끼리도 묶는다.
 * 돌려주는 값: noticeId → 대표 노드(root). 노드는 "n:<bidNtceNo>" 와 "<field>:<value>" 둘 다다.
 */
export function clusterNotices(notices) {
  const uf = createUnionFind();
  for (const item of notices) {
    const no = present(item.bidNtceNo);
    if (no === null) continue;
    const node = `n:${no}`;
    uf.find(node);
    for (const field of LINK_FIELDS) {
      const value = present(item[field]);
      if (value !== null) uf.union(node, `${field}:${value}`);
    }
    // 재공고(reNtceYn=Y)의 이전 공고 번호. 값이 있으면 reNtceYn 과 무관하게 잇는다(같은 사업이다).
    const before = present(item.befBidBbancNo);
    if (before !== null) uf.union(node, `n:${before}`);
  }
  const rootOf = new Map();
  for (const item of notices) {
    const no = present(item.bidNtceNo);
    if (no !== null) rootOf.set(no, uf.find(`n:${no}`));
  }
  return rootOf;
}

/**
 * 표본 공고를 클러스터로 묶는다. clusterId 는 구성원 최소 공고번호 순서의 c-NNNN.
 * aux: bidNtceNo → { licenseRows, regionRows, eorderRows, queried }.
 */
export function buildClusters({ notices, sampleIds, aux }) {
  const rootOf = clusterNotices(notices);
  const byNotice = new Map(notices.map((item) => [item.bidNtceNo, item]));
  const groups = new Map();
  for (const id of sampleIds) {
    const root = rootOf.get(id);
    if (root === undefined) throw new Error(`표본 공고가 목록에 없다: ${id}`);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  const clusters = [...groups.values()]
    .map((ids) => ids.sort(compare))
    .sort((left, right) => compare(left[0], right[0]))
    .map((ids, index) => {
      const members = ids.map((id) => {
        const item = byNotice.get(id);
        const info = aux.get(id) ?? {
          licenseRows: 0,
          regionRows: 0,
          eorderRows: 0,
          queried: false,
        };
        return { id, item, ...info };
      });
      // 대표 공고: 보조 조회가 있고 면허제한·e발주가 있는 것 우선, 없으면 최소 번호.
      const primary =
        members.find(
          (member) => member.queried && (member.licenseRows > 0 || member.eorderRows > 0),
        ) ??
        members.find((member) => member.queried) ??
        members[0];
      const hasLicenseLimit = members.some((member) => member.licenseRows > 0);
      const hasEorderAttachment = members.some((member) => member.eorderRows > 0);
      const queried = members.some((member) => member.queried);
      return {
        clusterId: `c-${String(index + 1).padStart(4, "0")}`,
        noticeIds: ids,
        primaryNoticeId: primary.id,
        agency: present(primary.item.dminsttNm) ?? "",
        budgetKrw: present(primary.item.asignBdgtAmt) ?? present(primary.item.presmptPrce),
        deadlineAt: present(primary.item.bidClseDt),
        classification: present(primary.item.pubPrcrmntClsfcNm) ?? "",
        budgetBucket: budgetBucketOf(primary.item),
        hasLicenseLimit,
        hasEorderAttachment,
        queried,
        // test·dev 후보 조건(지시서): 보조 조회가 있고 면허제한 행 ≥1 또는 e발주 첨부 ≥1.
        eligible: queried && (hasLicenseLimit || hasEorderAttachment),
      };
    });
  return clusters;
}

export const clusterRank = (datasetVersion, clusterId) =>
  sha256Hex(`${datasetVersion}:${clusterId}`);

/**
 * test·dev 선택. 후보(eligible)를 hash 순으로 보되 기관(agency)은 test∪dev 안에서 겹치지 않게, 분야×예산 층을 돌며 고르게 뽑는다.
 * existing: 이전 결과의 { noticeId → split }. 있으면 그 배정을 먼저 지킨다(사람 라벨이 붙은 test 가 움직이지 않게).
 */
export function selectSplits({
  clusters,
  datasetVersion,
  testSize,
  devSize,
  existing = new Map(),
}) {
  const ranked = clusters
    .map((cluster) => ({ cluster, rank: clusterRank(datasetVersion, cluster.clusterId) }))
    .sort((left, right) => compare(left.rank, right.rank))
    .map(({ cluster }) => cluster);
  const assignment = new Map();
  const usedAgencies = new Set();
  const reasons = new Map();
  const counts = { test: 0, dev: 0 };
  const sizes = { test: testSize, dev: devSize };

  const take = (cluster, split, reason) => {
    assignment.set(cluster.clusterId, split);
    usedAgencies.add(cluster.agency);
    counts[split] += 1;
    reasons.set(cluster.clusterId, reason);
  };

  // 1) 이전 배정 유지(아직 후보 조건을 만족하고 기관이 겹치지 않을 때만).
  for (const cluster of ranked) {
    const kept = cluster.noticeIds
      .map((id) => existing.get(id))
      .find((split) => split === "test" || split === "dev");
    if (
      kept === undefined ||
      !cluster.eligible ||
      usedAgencies.has(cluster.agency) ||
      counts[kept] >= sizes[kept]
    )
      continue;
    take(cluster, kept, `이전 분할 유지(${kept})`);
  }

  // 2) 남은 자리를 층(분야×예산 구간)을 돌며 hash 순으로 채운다.
  const strata = new Map();
  for (const cluster of ranked) {
    if (!cluster.eligible || assignment.has(cluster.clusterId)) continue;
    const key = `${cluster.classification}|${cluster.budgetBucket}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(cluster);
  }
  const orderedStrata = [...strata.entries()].sort(([left], [right]) => compare(left, right));
  const fill = (split) => {
    for (let round = 0; counts[split] < sizes[split]; round += 1) {
      let progressed = false;
      for (const [key, members] of orderedStrata) {
        if (counts[split] >= sizes[split]) break;
        const candidate = members.find(
          (cluster) => !assignment.has(cluster.clusterId) && !usedAgencies.has(cluster.agency),
        );
        if (candidate === undefined) continue;
        take(candidate, split, `hash 순·층 ${key}·기관 중복 없음`);
        progressed = true;
      }
      if (!progressed) break;
    }
  };
  fill("test");
  fill("dev");

  const assigned = clusters.map((cluster) => {
    const split = assignment.get(cluster.clusterId) ?? "train";
    const selectionReason =
      reasons.get(cluster.clusterId) ??
      (cluster.eligible
        ? "후보였으나 자리 없음 → train"
        : cluster.queried
          ? "보조 조회 결과에 면허제한·e발주 없음 → train"
          : "보조 조회 전 → train");
    return { ...cluster, split, selectionReason };
  });
  return {
    clusters: assigned,
    counts: { ...counts, train: assigned.length - counts.test - counts.dev },
  };
}

/**
 * 누수 검사. (1) test·dev 공고번호가 train 공고번호에 없다. (2) 같은 연결 식별자를 가진 표본 공고가 다른 분할에 없다.
 * notices 는 전체 정보화 공고(연결 식별자 확인용).
 */
export function leakCheck({ clusters, notices }) {
  const splitOf = new Map();
  for (const cluster of clusters)
    for (const id of cluster.noticeIds) splitOf.set(id, cluster.split);
  const trainIds = new Set(clusters.filter((c) => c.split === "train").flatMap((c) => c.noticeIds));
  const heldOut = clusters.filter((c) => c.split !== "train").flatMap((c) => c.noticeIds);
  const testDevInTrain = heldOut.filter((id) => trainIds.has(id)).length;

  const rootOf = clusterNotices(notices);
  const splitByRoot = new Map();
  let crossSplitLinks = 0;
  for (const [id, split] of splitOf) {
    const root = rootOf.get(id);
    const seen = splitByRoot.get(root);
    if (seen === undefined) splitByRoot.set(root, split);
    else if (seen !== split) crossSplitLinks += 1;
  }
  return { testDevInTrain, crossSplitLinks };
}

export function toSplitFile({
  clusters,
  counts,
  leak,
  datasetVersion,
  createdAt,
  sourceWindow,
  recordedRoot,
}) {
  return {
    schemaVersion: SPLIT_SCHEMA_VERSION,
    datasetVersion,
    createdAt,
    sourceWindow,
    recordedRoot,
    clusters: clusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      split: cluster.split,
      noticeIds: cluster.noticeIds,
      primaryNoticeId: cluster.primaryNoticeId,
      agency: cluster.agency,
      budgetKrw: cluster.budgetKrw,
      deadlineAt: cluster.deadlineAt,
      hasLicenseLimit: cluster.hasLicenseLimit,
      hasEorderAttachment: cluster.hasEorderAttachment,
      selectionReason: cluster.selectionReason,
    })),
    counts,
    leakCheck: leak,
  };
}

/** 보조 조회 녹음 → bidNtceNo 별 행 수. 녹음 params.bidNtceNo 가 조회한 공고다(0건 응답도 '조회함'으로 센다). */
export function summarizeAux({ license, region, eorder }) {
  const aux = new Map();
  const entry = (id) => {
    if (!aux.has(id)) aux.set(id, { licenseRows: 0, regionRows: 0, eorderRows: 0, queried: false });
    return aux.get(id);
  };
  const add = (recordings, field) => {
    for (const { recorded } of recordings) {
      const id = recorded.params.bidNtceNo;
      if (id === undefined) continue;
      const row = entry(id);
      row.queried = true;
      row[field] += recorded.items.filter((item) => item.bidNtceNo === id).length;
    }
  };
  add(license, "licenseRows");
  add(region, "regionRows");
  add(eorder, "eorderRows");
  return aux;
}
