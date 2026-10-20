import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClusters,
  clusterNotices,
  leakCheck,
  selectSplits,
  summarizeAux,
  toSplitFile,
} from "./split-lib.mjs";

const notice = (bidNtceNo, extra = {}) => ({
  bidNtceNo,
  bidNtceOrd: "000",
  dminsttNm: `기관-${bidNtceNo}`,
  asignBdgtAmt: "300000000",
  bidClseDt: "2026-10-28 10:00:00",
  pubPrcrmntClsfcNm: "정보시스템유지관리서비스",
  ...extra,
});

test("clusterNotices: 사전규격·발주계획·이전 공고 번호로 묶인다(표본 밖 공고를 거쳐도)", () => {
  const rootOf = clusterNotices([
    notice("A", { bfSpecRgstNo: "S1" }),
    notice("B", { bfSpecRgstNo: "S1", orderPlanUntyNo: "P1" }),
    notice("C", { orderPlanUntyNo: "P1" }),
    notice("D", { befBidBbancNo: "C", reNtceYn: "Y" }),
    notice("E"),
    notice("F", { befBidBbancNo: "ZZ" }),
  ]);
  assert.equal(rootOf.get("A"), rootOf.get("B"));
  assert.equal(rootOf.get("B"), rootOf.get("C"));
  assert.equal(rootOf.get("C"), rootOf.get("D"));
  assert.notEqual(rootOf.get("A"), rootOf.get("E"));
  assert.notEqual(rootOf.get("E"), rootOf.get("F"));
});

const AUX_FULL = { licenseRows: 1, regionRows: 0, eorderRows: 0, queried: true };
const AUX_EMPTY = { licenseRows: 0, regionRows: 0, eorderRows: 0, queried: true };

test("buildClusters: 표본만 클러스터가 되고 clusterId 는 최소 공고번호 순, 후보 조건은 보조 조회 + 면허제한·e발주", () => {
  const notices = [
    notice("A", { bfSpecRgstNo: "S1" }),
    notice("B", { bfSpecRgstNo: "S1" }),
    notice("C"),
    notice("D"),
  ];
  const aux = new Map([
    ["A", AUX_EMPTY],
    ["B", AUX_FULL],
    ["C", AUX_EMPTY],
  ]);
  const clusters = buildClusters({ notices, sampleIds: ["D", "C", "B", "A"], aux });
  assert.deepEqual(
    clusters.map((c) => [c.clusterId, c.noticeIds, c.primaryNoticeId, c.eligible, c.queried]),
    [
      ["c-0001", ["A", "B"], "B", true, true],
      ["c-0002", ["C"], "C", false, true],
      ["c-0003", ["D"], "D", false, false],
    ],
  );
  assert.equal(clusters[0].agency, "기관-B");
  assert.equal(clusters[0].budgetKrw, "300000000");
  assert.equal(clusters[0].deadlineAt, "2026-10-28 10:00:00");
});

const manyClusters = (count, agencyOf = (index) => `기관-${index}`) =>
  Array.from({ length: count }, (_, index) => ({
    clusterId: `c-${String(index + 1).padStart(4, "0")}`,
    noticeIds: [`N${index}`],
    primaryNoticeId: `N${index}`,
    agency: agencyOf(index),
    budgetKrw: "1",
    deadlineAt: null,
    classification: index % 2 === 0 ? "정보시스템유지관리서비스" : "정보시스템개발서비스",
    budgetBucket: index % 3 === 0 ? "lt-1e8" : "1e8-5e8",
    hasLicenseLimit: true,
    hasEorderAttachment: false,
    queried: true,
    eligible: index < 50,
  }));

test("selectSplits: 결정적이고 test 20·dev 10 을 채우며 기관이 겹치지 않는다", () => {
  const clusters = manyClusters(80);
  const first = selectSplits({ clusters, datasetVersion: "v0.1", testSize: 20, devSize: 10 });
  const second = selectSplits({ clusters, datasetVersion: "v0.1", testSize: 20, devSize: 10 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.counts, { test: 20, dev: 10, train: 50 });
  const heldOut = first.clusters.filter((c) => c.split !== "train");
  assert.equal(new Set(heldOut.map((c) => c.agency)).size, 30);
  assert.ok(heldOut.every((c) => c.eligible));
  const other = selectSplits({ clusters, datasetVersion: "v0.2", testSize: 20, devSize: 10 });
  assert.notDeepEqual(
    first.clusters.map((c) => c.split),
    other.clusters.map((c) => c.split),
  );
});

test("selectSplits: 같은 기관의 후보는 하나만 들어간다", () => {
  const clusters = manyClusters(60, (index) => (index < 40 ? "같은기관" : `기관-${index}`));
  const result = selectSplits({ clusters, datasetVersion: "v0.1", testSize: 20, devSize: 10 });
  const heldOut = result.clusters.filter((c) => c.split !== "train");
  assert.equal(heldOut.filter((c) => c.agency === "같은기관").length, 1);
  // 후보 50개 중 같은 기관 40개는 하나로 줄어 11개만 가능 → 자리가 모자라도 던지지 않고 수만 줄인다.
  assert.equal(result.counts.test + result.counts.dev, 11);
});

test("selectSplits: 이전 배정(existing)을 먼저 지킨다", () => {
  const clusters = manyClusters(80);
  const existing = new Map([
    ["N7", "test"],
    ["N9", "dev"],
  ]);
  const result = selectSplits({
    clusters,
    datasetVersion: "v0.1",
    testSize: 20,
    devSize: 10,
    existing,
  });
  const byId = new Map(result.clusters.map((c) => [c.primaryNoticeId, c]));
  assert.equal(byId.get("N7").split, "test");
  assert.equal(byId.get("N9").split, "dev");
  assert.match(byId.get("N7").selectionReason, /이전 분할 유지/);
});

test("leakCheck: 묶여야 할 공고가 다른 분할에 있으면 잡는다", () => {
  const notices = [
    notice("A", { bfSpecRgstNo: "S1" }),
    notice("B", { bfSpecRgstNo: "S1" }),
    notice("C"),
  ];
  const clean = leakCheck({
    clusters: [
      { noticeIds: ["A", "B"], split: "test" },
      { noticeIds: ["C"], split: "train" },
    ],
    notices,
  });
  assert.deepEqual(clean, { testDevInTrain: 0, crossSplitLinks: 0 });
  // A·B 는 사전규격 S1 로 한 사업인데 분할이 갈렸다.
  const crossed = leakCheck({
    clusters: [
      { noticeIds: ["A"], split: "test" },
      { noticeIds: ["B"], split: "train" },
    ],
    notices,
  });
  assert.equal(crossed.crossSplitLinks, 1);
  // 같은 공고가 test 와 train 양쪽에 있다.
  const duplicated = leakCheck({
    clusters: [
      { noticeIds: ["A", "B"], split: "test" },
      { noticeIds: ["A"], split: "train" },
    ],
    notices,
  });
  assert.equal(duplicated.testDevInTrain, 1);
});

test("summarizeAux: 조회한 공고의 행 수를 세고 0건 응답도 조회됨으로 둔다", () => {
  const rec = (bidNtceNo, items) => ({ recorded: { params: { bidNtceNo }, items } });
  const aux = summarizeAux({
    license: [rec("A", [{ bidNtceNo: "A" }, { bidNtceNo: "A" }]), rec("B", [])],
    region: [rec("A", [{ bidNtceNo: "A" }])],
    eorder: [rec("B", [{ bidNtceNo: "B" }, { bidNtceNo: "X" }])],
  });
  assert.deepEqual(aux.get("A"), { licenseRows: 2, regionRows: 1, eorderRows: 0, queried: true });
  assert.deepEqual(aux.get("B"), { licenseRows: 0, regionRows: 0, eorderRows: 1, queried: true });
});

test("toSplitFile: 지시서 형식의 키만 낸다(분류·층 같은 내부 값은 빠진다)", () => {
  const file = toSplitFile({
    clusters: [{ ...manyClusters(1)[0], split: "test", selectionReason: "r" }],
    counts: { test: 1, dev: 0, train: 0 },
    leak: { testDevInTrain: 0, crossSplitLinks: 0 },
    datasetVersion: "v0.1",
    createdAt: "2026-10-20T00:00:00.000Z",
    sourceWindow: { from: "2026-08-20", to: "2026-10-19" },
    recordedRoot: "fixtures/recorded/train",
  });
  assert.equal(file.schemaVersion, "sol-eval-split/v0.1");
  assert.deepEqual(Object.keys(file.clusters[0]), [
    "clusterId",
    "split",
    "noticeIds",
    "primaryNoticeId",
    "agency",
    "budgetKrw",
    "deadlineAt",
    "hasLicenseLimit",
    "hasEorderAttachment",
    "selectionReason",
  ]);
  assert.deepEqual(file.counts, { test: 1, dev: 0, train: 0 });
  assert.deepEqual(file.leakCheck, { testDevInTrain: 0, crossSplitLinks: 0 });
});
