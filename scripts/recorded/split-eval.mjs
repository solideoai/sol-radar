#!/usr/bin/env node
// split-eval.mjs — 녹음(fixtures/recorded/train)을 읽어 사업 클러스터를 만들고 test 20·dev 10·train 으로 나눈다(X6a, 21 §3.6).
//
//   pnpm eval:split                                  fixtures/eval/splits.v0.1.json 을 쓴다(커밋 대상, 담당자 정보 없음)
//   옵션: --recorded-root <폴더>(기본 fixtures/recorded/train) --out <파일> --dataset-version v0.1
//         --test 20 --dev 10 --fresh(이전 결과의 test·dev 배정을 지키지 않는다) --now <ISO>
//
// 결정성: 같은 입력이면 같은 출력이다(hash(clusterId) 순, 층 순회, 기관 중복 금지). 이전 출력이 있으면 그 test·dev 배정을
// 먼저 지킨다(사람 라벨이 붙은 공고가 움직이지 않게). 누수(test·dev 가 train 에 있음, 연결 식별자가 분할을 가로지름)는 exit 1.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AUX_OPERATIONS,
  G2B_SERVICE_ID,
  LIST_OPERATION,
  isInfoBizNoticeBroad,
  latestByNotice,
} from "./g2b-lib.mjs";
import { loadRecordings } from "./recording-file.mjs";
import {
  SPLIT_SCHEMA_VERSION,
  buildClusters,
  leakCheck,
  selectSplits,
  summarizeAux,
  toSplitFile,
} from "./split-lib.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULTS = {
  recordedRoot: path.join(ROOT, "fixtures", "recorded", "train"),
  out: path.join(ROOT, "fixtures", "eval", "splits.v0.1.json"),
  datasetVersion: "v0.1",
  test: 20,
  dev: 10,
  fresh: false,
  now: new Date(),
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 에 값이 없다`);
      index += 1;
      return value;
    };
    const integer = (value, name) => {
      if (!/^\d+$/.test(value)) throw new Error(`${name} 는 0 이상 정수여야 한다`);
      return Number(value);
    };
    switch (arg) {
      case "--recorded-root":
        options.recordedRoot = path.resolve(next());
        break;
      case "--out":
        options.out = path.resolve(next());
        break;
      case "--dataset-version":
        options.datasetVersion = next();
        break;
      case "--test":
        options.test = integer(next(), "--test");
        break;
      case "--dev":
        options.dev = integer(next(), "--dev");
        break;
      case "--fresh":
        options.fresh = true;
        break;
      case "--now":
        options.now = new Date(next());
        if (Number.isNaN(options.now.getTime())) throw new Error("--now 는 ISO 시각이어야 한다");
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return options;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function buildSplitFile(options) {
  const serviceDir = path.join(options.recordedRoot, G2B_SERVICE_ID);
  const lists = await loadRecordings(serviceDir, LIST_OPERATION);
  if (lists.length === 0) throw new Error(`목록 녹음이 없다: ${serviceDir}`);
  const sample = await readJsonIfExists(path.join(options.recordedRoot, "sample.v0.1.json"));
  if (sample === null)
    throw new Error("표본 파일이 없다(sample.v0.1.json). record:g2b --phase sample 을 먼저 돌린다");

  const notices = latestByNotice(lists.flatMap(({ recorded }) => recorded.items)).filter(
    isInfoBizNoticeBroad,
  );
  const [license, region, eorder] = await Promise.all(
    AUX_OPERATIONS.map((aux) => loadRecordings(serviceDir, aux.operation)),
  );
  const aux = summarizeAux({ license, region, eorder });
  const sampleIds = sample.picked.map((entry) => entry.bidNtceNo);
  const clusters = buildClusters({ notices, sampleIds, aux });

  const previous = options.fresh ? null : await readJsonIfExists(options.out);
  const existing = new Map();
  if (previous !== null && previous.schemaVersion === SPLIT_SCHEMA_VERSION) {
    for (const cluster of previous.clusters)
      for (const id of cluster.noticeIds) existing.set(id, cluster.split);
  }
  const selected = selectSplits({
    clusters,
    datasetVersion: options.datasetVersion,
    testSize: options.test,
    devSize: options.dev,
    existing,
  });
  const leak = leakCheck({ clusters: selected.clusters, notices });
  const file = toSplitFile({
    clusters: selected.clusters,
    counts: selected.counts,
    leak,
    datasetVersion: options.datasetVersion,
    createdAt: options.now.toISOString(),
    sourceWindow: sample.sourceWindow,
    recordedRoot: path.relative(ROOT, options.recordedRoot).split(path.sep).join("/"),
  });
  const stats = {
    notices: notices.length,
    sampled: sampleIds.length,
    queried: clusters.filter((cluster) => cluster.queried).length,
    eligible: clusters.filter((cluster) => cluster.eligible).length,
    clusters: clusters.length,
    multiNoticeClusters: clusters.filter((cluster) => cluster.noticeIds.length > 1).length,
    kept:
      previous === null
        ? 0
        : selected.clusters.filter((c) => c.selectionReason.startsWith("이전 분할 유지")).length,
  };
  return { file, stats, leak, counts: selected.counts };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { file, stats, leak, counts } = await buildSplitFile(options);
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(
    `[split] 정보화 공고 ${stats.notices} · 표본 ${stats.sampled} · 보조 조회됨 ${stats.queried} · 후보 ${stats.eligible} · 클러스터 ${stats.clusters}(복수 공고 ${stats.multiNoticeClusters}) · 이전 배정 유지 ${stats.kept}`,
  );
  console.log(
    `[split] test ${counts.test} · dev ${counts.dev} · train ${counts.train} → ${path.relative(ROOT, options.out)}`,
  );
  console.log(
    `[leak] testDevInTrain ${leak.testDevInTrain} · crossSplitLinks ${leak.crossSplitLinks}`,
  );
  const problems = [];
  if (leak.testDevInTrain !== 0 || leak.crossSplitLinks !== 0) problems.push("누수가 있다");
  if (counts.test < options.test)
    problems.push(`test 가 ${options.test} 에 못 미친다(${counts.test})`);
  if (counts.dev < options.dev) problems.push(`dev 가 ${options.dev} 에 못 미친다(${counts.dev})`);
  if (problems.length > 0) {
    console.error(`[split] 실패: ${problems.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
