// demo/bid-notices.mjs — 데모 공고의 정리와 fixture 읽기.
//
// 공고 SEED 적재(공고·revision·첨부·outbox·수집 run·격리)는 C3 수집 도메인의 seedFixtureBids 가 한다(C3 6-5).
// demo-reset.mjs 가 그것을 ingestBids 로 주입받아 부르고, 돌려받은 { bids, quarantined, summary, ingestRunId } 를 쓴다.
//
// mock 추출은 적재하지 않는다. 인용 검증을 거치지 않은 fixture 원본이 worker 캐시가 되면 안 된다(demo-reset.mjs 머리말).
// loadExtractionFixtures 는 분석 저장 시험(web/server/analysis/store.test-support.ts)이 test-harness 로 쓴다.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadBidFixtures, validateBidFixtures } from "../bids/check.mjs";
import { indexExtractionFiles } from "./plan.mjs";

// ── fixture 읽기 ───────────────────────────────────────────────

// fixtures/bids + manifest. 잘못된 fixture 는 조용히 건너뛰지 않고 멈춘다(07 §7).
// 적재는 seedFixtureBids 가 같은 파일을 다시 읽어 한다. 여기서는 무엇이든 지우기 전에 fixture 가 맞는지 먼저 본다.
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
// 공고 이벤트(outbox, 6-5 보충 2)는 FK 가 없어 먼저 지운다. id·멱등키가 결정적이라 지난 리허설의 이벤트가 남으면
// 다음 SEED·LIVE 의 이벤트가 on conflict do nothing 에 막혀 변경 알림이 나오지 않는다. live 공고·검토 이벤트는 그대로 둔다.
// fixture 출처의 수집 run 도 모두 데모 데이터라 함께 지운다(ingest_errors 는 cascade). 같은 jobKey 로 새 run 이 열린다.
export const deleteDemoBids = async (client) => {
  const demoBids = await client.select("bid_notices", {
    columns: "id",
    filters: { is_demo: true },
  });
  if (demoBids.length > 0)
    await client.delete("outbox_events", {
      aggregate_type: "bid_notice",
      aggregate_id: { in: demoBids.map((bid) => bid.id) },
    });
  await client.delete("bid_notices", { is_demo: true });
  await client.delete("ingest_runs", { source: "fixture" });
};
