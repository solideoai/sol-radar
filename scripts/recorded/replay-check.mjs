#!/usr/bin/env node
// replay-check.mjs — fixtures/recorded/train 의 녹음 전부를 정본 스키마(web/server/ingestion/recorded-api.ts)로 읽고,
// 나라장터 봉투로 되돌려 parseG2bEnvelope 가 같은 행 수를 내는지 본다. 네트워크·DB 없음.
//
//   pnpm record:check                 (루트 package.json: pnpm -C web exec node --conditions=react-server --import tsx …)
//   pnpm record:check -- --root <폴더>  다른 녹음 폴더
// 도메인 모듈은 `import "server-only"` 라서 demo-reset.mjs 와 같은 방식(web 의 tsx, react-server 조건)으로 부른다.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INGESTION_MODULE = new URL("../../web/server/ingestion/index.ts", import.meta.url);
const RECORDED_MODULE = new URL("../../web/server/ingestion/recorded-api.ts", import.meta.url);

function parseRoot(argv) {
  const index = argv.indexOf("--root");
  return index === -1
    ? path.join(ROOT, "fixtures", "recorded", "train")
    : path.resolve(argv[index + 1] ?? "");
}

async function listRecordingFiles(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith(".masked.json")) files.push(file);
    }
  }
  await walk(root);
  return files.sort();
}

async function main() {
  const root = parseRoot(process.argv.slice(2));
  const [{ parseG2bEnvelope, G2B_CONTACT_FIELDS }, { loadRecordedResponse, toG2bEnvelopeBody }] =
    await Promise.all([import(INGESTION_MODULE.href), import(RECORDED_MODULE.href)]);
  const files = await listRecordingFiles(root);
  if (files.length === 0) throw new Error(`녹음 파일이 없다: ${root}`);
  const byOperation = new Map();
  let itemsTotal = 0;
  let contactValuesLeft = 0;
  for (const file of files) {
    // 형식이 틀리면 loadRecordedResponse 가 경로를 담아 던진다. 건너뛰지 않는다.
    const recorded = await loadRecordedResponse(file);
    const replayed = parseG2bEnvelope(toG2bEnvelopeBody(recorded));
    const replayedItems = replayed.ok ? replayed.items.length : 0;
    if (recorded.envelope === "response" && replayedItems !== recorded.items.length) {
      throw new Error(`재생한 행 수가 다르다: ${path.relative(root, file)}`);
    }
    if (recorded.envelope !== "response" && (replayed.ok || replayed.kind !== "RESULT_CODE")) {
      throw new Error(`오류 봉투가 오류로 재생되지 않았다: ${path.relative(root, file)}`);
    }
    // 담당자 필드에 마스킹되지 않은 값이 남았는지(값이 있는데 * 나 *** 가 아니면 실패).
    for (const item of recorded.items) {
      for (const field of G2B_CONTACT_FIELDS) {
        const value = item[field];
        if (typeof value === "string" && value !== "" && !/^\*+$/.test(value))
          contactValuesLeft += 1;
      }
    }
    itemsTotal += recorded.items.length;
    byOperation.set(recorded.operation, (byOperation.get(recorded.operation) ?? 0) + 1);
  }
  if (contactValuesLeft > 0) throw new Error(`담당자 필드에 가리지 않은 값 ${contactValuesLeft}건`);
  console.log(
    `record:check 통과: 파일 ${files.length}개, 행 ${itemsTotal}, 오퍼레이션별 ${JSON.stringify(Object.fromEntries(byOperation))}, 담당자 필드 잔존 0`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
