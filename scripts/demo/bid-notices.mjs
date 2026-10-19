// demo/bid-notices.mjs — fixture 공고 SEED 배치를 Supabase 에 넣는다(공고·revision·첨부·수집 run·격리) + mock 추출.
//
// seedBidNotices 가 "공고 적재 함수 하나"다(04 §6). C3 수집 파이프라인이 병합되면 demo-reset.mjs 는 이 함수 호출을
// FixtureConnector 의 runIngest({ source: "fixture", batch: "SEED" }) 로 바꾸고, 돌려주는 모양
// ({ bids: [{ fixtureId, bidId, revisionId, checksum }], quarantined, summary, ingestRunId }) 만 맞추면 된다.
// 그때까지는 07 §6.4·15 §3 의 규칙(상대 날짜 → anchor 기준 KST 18:00, checksum = canonical JSON sha256)을
// scripts/demo/plan.mjs 의 순수 함수로 직접 계산한다.
//
// seedRequirementExtractions 는 수집이 아니라 extract job 의 결과(mock)라 따로 둔다 — C3 가 바뀌어도 남는다.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadBidFixtures, validateBidFixtures } from "../bids/check.mjs";
import {
  extractionFileFor,
  indexExtractionFiles,
  planSeedBatch,
  toBidRows,
  toExtractionRow,
  toIngestRows,
} from "./plan.mjs";

// ── fixture 읽기 ───────────────────────────────────────────────

// fixtures/bids + manifest. 잘못된 fixture 는 조용히 건너뛰지 않고 멈춘다(07 §7).
export const loadDemoBidFixtures = async (root) => {
  const fixtures = await loadBidFixtures({ root });
  const result = validateBidFixtures(fixtures);
  if (!result.ok)
    throw new Error(
      `공고 fixture 검증 실패: ${result.errors.map((error) => `${error.code}${error.fixtureId ? `(${error.fixtureId})` : ""}`).join(", ")}`,
    );
  return fixtures;
};

// fixtures/extractions/*.json → { index, files: { 이름: JSON } }
export const loadExtractionFixtures = async (root) => {
  const dir = path.join(root, "fixtures", "extractions");
  let names;
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("fixtures/extractions/ 가 없습니다(mock 추출 fixture, 07 §6.3)");
    throw error;
  }
  const files = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, JSON.parse(await readFile(path.join(dir, name), "utf8"))]),
    ),
  );
  return { index: indexExtractionFiles(names), files };
};

export const loadCompanyProfileFixture = async (root) => {
  const file = path.join(root, "fixtures", "company", "solideo-profile.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("fixtures/company/solideo-profile.json 이 없습니다(08 §6.1 회사 프로필)");
    throw error;
  }
};

// ── 적재 ───────────────────────────────────────────────────────

// 데모 공고(is_demo=true)만 지운다. live 공고(is_demo=false)는 손대지 않는다(04 §6). 하위 표는 FK cascade.
// fixture 출처의 수집 run 도 모두 데모 데이터라 함께 지운다(ingest_errors 는 cascade).
export const deleteDemoBids = async (client) => {
  await client.delete("bid_notices", { is_demo: true });
  await client.delete("ingest_runs", { source: "fixture" });
};

export const seedBidNotices = async (
  client,
  { fixtures, anchor, runMode, now = () => new Date() },
) => {
  const plan = planSeedBatch(fixtures, { anchor });
  const { notices, revisions, documents } = toBidRows(plan);
  await client.insert("bid_notices", notices);
  await client.insert("bid_revisions", revisions);
  await client.insert("bid_documents", documents);
  const { run, errors } = toIngestRows({
    summary: plan.summary,
    quarantined: plan.quarantined,
    fetchedAt: plan.fetchedAt,
    finishedAt: now().toISOString(),
    runMode,
    order: fixtures.manifest.batches.SEED,
    anchor: plan.fetchedAt,
  });
  await client.insert("ingest_runs", [run]);
  await client.insert("ingest_errors", errors);
  return {
    bids: plan.created.map(({ fixtureId, bidId, revisionId, normalized }) => ({
      fixtureId,
      bidId,
      revisionId,
      noticeId: normalized.noticeId,
      checksum: normalized.checksum,
    })),
    quarantined: plan.quarantined,
    summary: plan.summary,
    ingestRunId: run.id,
  };
};

// 적재된 공고(r1)마다 mock 추출 한 행. 파일이 없는 공고는 오류다(19건 모두 파일이 있어야 한다, 07 §6.5).
export const seedRequirementExtractions = async (client, { bids, extractions }) => {
  const rows = bids.map(({ fixtureId, bidId, revisionId }) => {
    const file = extractionFileFor(extractions.index, fixtureId, 1);
    if (!file) throw new Error(`mock 추출 fixture 가 없습니다: ${fixtureId}`);
    return toExtractionRow({
      fixtureId,
      bidId,
      revisionId,
      revision: 1,
      extraction: extractions.files[file],
    });
  });
  await client.insert("requirement_extractions", rows);
  return { extractions: rows.length };
};
