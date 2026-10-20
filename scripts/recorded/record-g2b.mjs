#!/usr/bin/env node
// record-g2b.mjs — 나라장터 입찰공고정보서비스(15129394) 응답을 마스킹해 녹음한다(X6a A1 수집, 23 §4.3 저장 2안).
//
//   pnpm record:g2b -- --check-env                 서비스키 존재·형식만 확인(값은 출력하지 않는다). 호출 0회
//   pnpm record:g2b -- --phase list                60일 목록(1일 창 × 999행). 창마다 1파일
//   pnpm record:g2b -- --phase sample              목록 녹음에서 정보화 필터 → 표본 300(결정적 seed) → sample.v0.1.json
//   pnpm record:g2b -- --phase aux                 표본 순서대로 보조 조회 3종(면허제한·참가가능지역·e발주 첨부)
//   pnpm record:g2b -- --phase all                 list → sample → aux
//   옵션: --env-root <저장소 루트>(infra/.env 가 있는 곳) --out <폴더>(기본 fixtures/recorded/train)
//         --from 2026-08-20 --to 2026-10-19 --rows 999 --budget 500 --stop-remaining 150
//         --sample-size 300 --seed sol-eval/v0.1 --aux-limit 150 --dry-run --now <ISO>
//
// 지키는 것
//   - 서비스키는 infra/.env 에서 parseEnv 로 읽어 메모리에만 둔다(check-env.mjs 와 같은 방식). 출력·로그·파일·URL 기록에 없다.
//   - 하루 예산(--budget, 기본 500)과 x-ratelimit-remaining 하한(--stop-remaining, 기본 150)을 넘기지 않는다.
//     오류 응답·재시도도 1회로 센다. 같은 날 앞선 실행의 호출 수는 calllog 에서 더해 잇는다.
//   - 429/Retry-After, resultCode 22·23·30·31 은 즉시 멈춘다. timeout·5xx·네트워크 오류만 1·2·4s(+jitter) 최대 3회 재시도.
//   - 저장 전 마스킹(masking.mjs), 저장 뒤 폴더 전체에서 이메일·전화·servicekey·키 흔적 0건을 스스로 확인한다.
//   - 15129437·15129462·15129467 은 부르지 않는다. 첨부도 받지 않는다.
import { mkdir, readFile, readdir, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AUX_OPERATIONS,
  CANCELLED_NOTICE_KIND,
  CONNECTOR_TIMEOUT_MS,
  G2B_MAX_ROWS,
  G2B_RESPONSE_MAX_BYTES,
  G2B_SERVICE_ID,
  LIST_OPERATION,
  LIST_REGISTRY_KEY,
  RETRY_MAX_RETRIES,
  STOP_RESULT_CODES,
  agencyClassOf,
  auxParams,
  budgetBucketOf,
  buildG2bUrl,
  deadlineBucketOf,
  distributionOf,
  isInfoBizNoticeBroad,
  isSuccessResultCode,
  kstInstant,
  latestByNotice,
  listParams,
  loadServiceKey,
  looksLikeXml,
  nonNegativeIntegerHeader,
  parseG2bEnvelope,
  parseG2bGatewayError,
  parseG2bLocalDateTime,
  retryDelayMs,
  sampleStratified,
  splitG2bWindow,
  KST_OFFSET_MS,
} from "./g2b-lib.mjs";
import { hasLeak, scanLeaks } from "./masking.mjs";
import { buildRecording, loadRecordings, serializeRecording } from "./recording-file.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE_SCHEMA_VERSION = "sol-recorded-sample/v0.1";
const DEFAULTS = {
  envRoot: ROOT,
  out: path.join(ROOT, "fixtures", "recorded", "train"),
  from: "2026-08-20",
  to: "2026-10-19",
  rows: G2B_MAX_ROWS,
  budget: 500,
  stopRemaining: 150,
  sampleSize: 300,
  seed: "sol-eval/v0.1",
  auxLimit: 150,
  pauseMs: 150,
};

class StopRecording extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}

// ── 인자 ──
function parseArgs(argv) {
  const options = { ...DEFAULTS, phase: null, checkEnv: false, dryRun: false, now: new Date() };
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
      case "--check-env":
        options.checkEnv = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--phase":
        options.phase = next();
        break;
      case "--env-root":
        options.envRoot = path.resolve(next());
        break;
      case "--out":
        options.out = path.resolve(next());
        break;
      case "--from":
        options.from = next();
        break;
      case "--to":
        options.to = next();
        break;
      case "--rows":
        options.rows = integer(next(), "--rows");
        break;
      case "--budget":
        options.budget = integer(next(), "--budget");
        break;
      case "--stop-remaining":
        options.stopRemaining = integer(next(), "--stop-remaining");
        break;
      case "--sample-size":
        options.sampleSize = integer(next(), "--sample-size");
        break;
      case "--seed":
        options.seed = next();
        break;
      case "--aux-limit":
        options.auxLimit = integer(next(), "--aux-limit");
        break;
      case "--pause-ms":
        options.pauseMs = integer(next(), "--pause-ms");
        break;
      case "--now":
        options.now = new Date(next());
        if (Number.isNaN(options.now.getTime())) throw new Error("--now 는 ISO 시각이어야 한다");
        break;
      default:
        throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  if (!options.checkEnv && !["list", "sample", "aux", "all"].includes(options.phase ?? "")) {
    throw new Error("--phase list|sample|aux|all 또는 --check-env 가 필요하다");
  }
  if (options.rows < 1 || options.rows > G2B_MAX_ROWS)
    throw new Error(`--rows 는 1~${G2B_MAX_ROWS}`);
  return options;
}

const kstDateStamp = (at) => {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  return [
    kst.getUTCFullYear(),
    String(kst.getUTCMonth() + 1).padStart(2, "0"),
    String(kst.getUTCDate()).padStart(2, "0"),
  ].join("");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 값 없이 구조만 적는다: 객체는 {키:타입}, 배열은 [길이], 문자열은 string(길이). */
function describeShape(value, depth) {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value === null) return "null";
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value !== "object") return typeof value;
  if (depth <= 0) return "{…}";
  return `{${Object.entries(value)
    .map(([key, child]) => `${key}:${describeShape(child, depth - 1)}`)
    .join(",")}}`;
}

const exists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

// ── 호출 예산·기록 ──
class Budget {
  constructor({ limit, stopRemaining, logFile, dateStamp }) {
    this.limit = limit;
    this.stopRemaining = stopRemaining;
    this.logFile = logFile;
    this.dateStamp = dateStamp;
    this.usedBefore = 0;
    this.used = 0;
    this.remainingByOperation = new Map();
  }

  /** 같은 KST 날짜의 앞선 실행 호출 수를 calllog 에서 더한다. */
  async load() {
    try {
      const text = await readFile(this.logFile, "utf8");
      this.usedBefore = text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.dateStamp === this.dateStamp).length;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  get total() {
    return this.usedBefore + this.used;
  }

  /** 다음 호출 전에 본다. 한도를 넘거나 앞 응답의 remaining 이 하한 아래면 멈춘다(앞 응답은 이미 저장됐다). */
  assertCanCall() {
    if (this.floorBreached !== undefined) {
      throw new StopRecording("RATE_LIMIT_FLOOR", this.floorBreached);
    }
    if (this.total + 1 > this.limit) {
      throw new StopRecording("BUDGET", `오늘 호출 ${this.total}회, 한도 ${this.limit}회`);
    }
  }

  async record(entry) {
    this.used += 1;
    if (entry.remaining !== null) this.remainingByOperation.set(entry.operation, entry.remaining);
    await appendFile(this.logFile, `${JSON.stringify({ dateStamp: this.dateStamp, ...entry })}\n`);
    if (entry.remaining !== null && entry.remaining < this.stopRemaining) {
      this.floorBreached = `x-ratelimit-remaining ${entry.remaining} < ${this.stopRemaining} (${entry.operation})`;
    }
  }
}

// ── 호출 1회(재시도 포함). 돌려주는 값에 URL·키는 없다 ──
const isTimeoutError = (error) =>
  typeof error === "object" &&
  error !== null &&
  (error.name === "TimeoutError" || error.name === "AbortError");

async function readBoundedText(response) {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > G2B_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new StopRecording("TOO_LARGE", `응답이 ${G2B_RESPONSE_MAX_BYTES} 바이트를 넘는다`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** 한 번 시도한다. 재시도할 수 있는 실패는 { retryable: true, kind } 로, 멈출 실패는 StopRecording 으로 돌려준다. */
async function attemptOnce({ operation, params, serviceKey, label }) {
  const url = buildG2bUrl({ operation, serviceKey, params });
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    return {
      retryable: true,
      kind: isTimeoutError(error) ? "TIMEOUT" : "NETWORK",
      ms: Date.now() - startedAt,
      httpStatus: null,
    };
  }
  const httpStatus = response.status;
  const remaining = nonNegativeIntegerHeader(response.headers.get("x-ratelimit-remaining"));
  const limit = nonNegativeIntegerHeader(response.headers.get("x-ratelimit-limit"));
  const retryAfter = response.headers.get("retry-after");
  const base = { httpStatus, remaining, limit, ms: 0 };

  if (httpStatus === 429 || retryAfter !== null) {
    await response.body?.cancel().catch(() => undefined);
    throw new StopRecording(
      "RATE_LIMITED",
      `${label} HTTP ${httpStatus}, Retry-After ${retryAfter ?? "없음"}`,
    );
  }
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared.trim()) &&
    Number(declared) > G2B_RESPONSE_MAX_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new StopRecording("TOO_LARGE", `${label} content-length ${declared}`);
  }
  let text;
  try {
    text = await readBoundedText(response);
  } catch (error) {
    if (error instanceof StopRecording) throw error;
    return {
      retryable: true,
      kind: isTimeoutError(error) ? "TIMEOUT" : "READ",
      ...base,
      ms: Date.now() - startedAt,
    };
  }
  base.ms = Date.now() - startedAt;

  // 키 오류는 type=json 이어도 XML 로 온다(g2b.model.ts). 코드가 무엇이든 키·게이트웨이 문제라 멈춘다.
  if (looksLikeXml(text)) {
    const gateway = parseG2bGatewayError(text);
    const code = gateway?.returnReasonCode ?? "?";
    throw new StopRecording(
      "GATEWAY_ERROR",
      `${label} 게이트웨이 resultCode ${code} ${gateway?.returnAuthMsg ?? ""}`.trim(),
    );
  }
  if (httpStatus >= 500) return { retryable: true, kind: "HTTP_5XX", ...base };
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new StopRecording("HTTP_ERROR", `${label} HTTP ${httpStatus}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StopRecording("NOT_JSON", `${label} 응답 본문이 JSON 이 아니다`);
  }
  const envelope = parseG2bEnvelope(json);
  if (envelope.malformed) {
    // 값은 찍지 않는다. 키 이름·타입·길이만으로 어떤 모양인지 본다(새 봉투 변형을 찾을 때).
    throw new StopRecording(
      "MALFORMED",
      `${label} 응답 형식이 봉투가 아니다: ${describeShape(json, 4)}`,
    );
  }
  if (STOP_RESULT_CODES.includes(envelope.resultCode.trim())) {
    throw new StopRecording(
      "RESULT_CODE",
      `${label} resultCode ${envelope.resultCode} (한도·키 오류)`,
    );
  }
  return { retryable: false, ...base, text, envelope };
}

async function callWithRetry(context, { operation, params, label }) {
  const { budget, serviceKey, random } = context;
  for (let attempt = 1; ; attempt += 1) {
    budget.assertCanCall();
    const fetchedAt = new Date().toISOString();
    let result;
    try {
      result = await attemptOnce({ operation, params, serviceKey, label });
    } catch (error) {
      // 멈추는 실패도 호출 1회다. 기록한 뒤 던진다.
      if (error instanceof StopRecording) {
        await budget
          .record({
            at: fetchedAt,
            operation,
            params,
            attempt,
            httpStatus: null,
            resultCode: null,
            totalCount: null,
            items: null,
            ms: null,
            remaining: null,
            outcome: error.reason,
          })
          .catch(() => undefined);
      }
      throw error;
    }
    const outcome = result.retryable ? result.kind : "OK";
    await budget.record({
      at: fetchedAt,
      operation,
      params,
      attempt,
      httpStatus: result.httpStatus,
      resultCode: result.envelope?.resultCode ?? null,
      totalCount: result.envelope?.totalCount ?? null,
      items: result.envelope?.items.length ?? null,
      ms: result.ms,
      remaining: result.remaining,
      outcome,
    });
    if (!result.retryable) return { ...result, fetchedAt, attempt };
    const retried = attempt - 1;
    if (retried >= RETRY_MAX_RETRIES) {
      throw new StopRecording(
        "RETRY_EXHAUSTED",
        `${label} ${result.kind} ${RETRY_MAX_RETRIES}회 재시도 뒤 실패`,
      );
    }
    const waitMs = retryDelayMs(retried, random);
    console.log(`  ${label} ${result.kind} → ${waitMs}ms 뒤 재시도 ${attempt + 1}`);
    await sleep(waitMs);
  }
}

// ── 저장 ──
async function saveRecording(context, { registryKey, operation, params, call, note, file }) {
  const recorded = buildRecording({
    serviceId: G2B_SERVICE_ID,
    registryKey,
    operation,
    params,
    fetchedAt: call.fetchedAt,
    httpStatus: call.httpStatus,
    rawText: call.text,
    envelope: call.envelope,
    note,
  });
  const text = serializeRecording(recorded);
  const scan = scanLeaks(text, context.keyForms);
  if (hasLeak(scan)) {
    throw new StopRecording(
      "LEAK",
      `${path.basename(file)} 마스킹 뒤에도 흔적이 남았다 ${JSON.stringify(scan)}`,
    );
  }
  await writeFile(file, text);
  return recorded;
}

const logCall = (label, call) => {
  const envelope = call.envelope;
  const summary =
    envelope.envelope === "response"
      ? `rc=${envelope.resultCode} total=${envelope.totalCount} items=${envelope.items.length}`
      : `rc=${envelope.resultCode} (${envelope.resultMsg})`;
  console.log(
    `  ${label} http=${call.httpStatus} ${summary} remaining=${call.remaining ?? "?"} ms=${call.ms}${
      call.attempt > 1 ? ` attempt=${call.attempt}` : ""
    }`,
  );
};

// ── 단계 1: 목록 ──
async function runList(context) {
  const { options, dateStamp, serviceDir } = context;
  const from = kstInstant(options.from, 0, 0);
  const to = kstInstant(options.to, 23, 59);
  const slices = splitG2bWindow(from, to);
  console.log(
    `[list] ${options.from}~${options.to} KST → 1일 창 ${slices.length}개, numOfRows=${options.rows}`,
  );
  if (options.dryRun) return { slices: slices.length, calls: 0, skipped: 0, structuralError: 0 };
  let calls = 0;
  let skipped = 0;
  for (const [index, slice] of slices.entries()) {
    const window = `w${String(index + 1).padStart(2, "0")}`;
    for (let pageNo = 1; ; pageNo += 1) {
      const params = listParams({ pageNo, numOfRows: options.rows, slice });
      const file = path.join(
        serviceDir,
        `${LIST_OPERATION}.${dateStamp}.${window}-p${pageNo}.masked.json`,
      );
      let recorded;
      if (await exists(file)) {
        recorded = JSON.parse(await readFile(file, "utf8"));
        skipped += 1;
      } else {
        const label = `[list ${window} p${pageNo}]`;
        const call = await callWithRetry(context, { operation: LIST_OPERATION, params, label });
        logCall(label, call);
        recorded = await saveRecording(context, {
          registryKey: LIST_REGISTRY_KEY,
          operation: LIST_OPERATION,
          params,
          call,
          note: `60일 목록 ${window} ${pageNo}쪽 (${params.inqryBgnDt}~${params.inqryEndDt} KST, inqryDiv=1)`,
          file,
        });
        calls += 1;
        if (!isSuccessResultCode(recorded.resultCode)) {
          throw new StopRecording(
            "RESULT_CODE",
            `${label} resultCode ${recorded.resultCode} — 창 요청이 거부됐다`,
          );
        }
        await sleep(options.pauseMs);
      }
      if (recorded.totalCount === null || pageNo * options.rows >= recorded.totalCount) break;
    }
  }
  return { slices: slices.length, calls, skipped };
}

// ── 단계 2: 필터 → 표본 ──
async function runSample(context) {
  const { options, serviceDir, sampleFile } = context;
  const recordings = await loadRecordings(serviceDir, LIST_OPERATION);
  if (recordings.length === 0) throw new Error(`목록 녹음이 없다: ${serviceDir}`);
  const allRows = recordings.flatMap(({ recorded }) => recorded.items);
  const latest = latestByNotice(allRows);
  const infoBiz = latest.filter(isInfoBizNoticeBroad);
  const strictCount = infoBiz.filter((item) => item.infoBizYn === "Y").length;
  const notCancelled = infoBiz.filter((item) => item.ntceKindNm !== CANCELLED_NOTICE_KIND);
  const stamp = kstDateStamp(options.now);
  const anchor = kstInstant(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`);
  const { picked, strataCount } = sampleStratified({
    items: notCancelled,
    size: options.sampleSize,
    seed: options.seed,
    anchor,
  });
  const pickedItems = picked.map(({ item }) => item);
  const sample = {
    schemaVersion: SAMPLE_SCHEMA_VERSION,
    seed: options.seed,
    size: picked.length,
    requestedSize: options.sampleSize,
    anchorKst: kstDateStamp(options.now),
    sourceWindow: { from: options.from, to: options.to },
    listFiles: recordings.map(({ file }) => file),
    counts: {
      listRows: allRows.length,
      uniqueNotices: latest.length,
      infoBizBroad: infoBiz.length,
      infoBizStrict: strictCount,
      cancelledExcluded: infoBiz.length - notCancelled.length,
      strata: strataCount,
    },
    distributions: {
      agencyClass: distributionOf(pickedItems, agencyClassOf),
      budgetBucket: distributionOf(pickedItems, budgetBucketOf),
      deadlineBucket: distributionOf(pickedItems, (item) => deadlineBucketOf(item, anchor)),
      classification: distributionOf(pickedItems, (item) => item.pubPrcrmntClsfcNm ?? ""),
      noticeKind: distributionOf(pickedItems, (item) => item.ntceKindNm ?? ""),
    },
    // 보조 조회는 이 순서대로 한다. 담당자 정보는 없다(공고번호·차수·등록일시·층만).
    picked: picked.map(({ item, stratum }) => ({
      bidNtceNo: item.bidNtceNo,
      bidNtceOrd: item.bidNtceOrd,
      rgstDt: item.rgstDt,
      stratum,
    })),
  };
  await writeFile(sampleFile, `${JSON.stringify(sample, null, 2)}\n`);
  console.log(
    `[sample] 목록 행 ${allRows.length} → 공고 ${latest.length} → 정보화(broad) ${infoBiz.length}(strict ${strictCount}) → 취소 제외 ${notCancelled.length} → 표본 ${picked.length} (층 ${strataCount})`,
  );
  for (const [name, table] of Object.entries(sample.distributions)) {
    if (name === "classification") continue;
    console.log(`  ${name}: ${JSON.stringify(table)}`);
  }
  return sample;
}

// ── 단계 3: 보조 조회 ──
async function runAux(context) {
  const { options, dateStamp, serviceDir, sampleFile } = context;
  const sample = JSON.parse(await readFile(sampleFile, "utf8"));
  if (sample.schemaVersion !== SAMPLE_SCHEMA_VERSION) throw new Error("표본 파일 형식이 다르다");
  const budgetLeft = context.budget.limit - context.budget.total;
  const affordable = Math.floor(budgetLeft / AUX_OPERATIONS.length);
  const target = Math.min(options.auxLimit, affordable, sample.picked.length);
  console.log(
    `[aux] 표본 ${sample.picked.length}건 중 앞 ${target}건 × ${AUX_OPERATIONS.length}종 (요청 ${options.auxLimit}, 예산으로 가능한 ${affordable})`,
  );
  if (target < options.auxLimit) {
    console.log(`  예산 때문에 보조 조회 건수를 ${options.auxLimit} → ${target} 으로 줄였다`);
  }
  if (options.dryRun) return { notices: 0, calls: 0, skipped: 0, target };
  let calls = 0;
  let skipped = 0;
  let notices = 0;
  const failures = [];
  for (const entry of sample.picked.slice(0, target)) {
    const rgstAt = parseG2bLocalDateTime(entry.rgstDt);
    if (rgstAt === null) throw new Error(`rgstDt 를 읽을 수 없다: ${entry.bidNtceNo}`);
    let didCall = false;
    for (const aux of AUX_OPERATIONS) {
      const tag = `${aux.tagPrefix}-${entry.bidNtceNo}-${entry.bidNtceOrd}`;
      const file = path.join(serviceDir, `${aux.operation}.${dateStamp}.${tag}.masked.json`);
      if (await exists(file)) {
        skipped += 1;
        continue;
      }
      const params = auxParams({
        numOfRows: options.rows,
        bidNtceNo: entry.bidNtceNo,
        bidNtceOrd: entry.bidNtceOrd,
        rgstAt,
      });
      const label = `[${aux.tagPrefix} ${entry.bidNtceNo}-${entry.bidNtceOrd}]`;
      const call = await callWithRetry(context, { operation: aux.operation, params, label });
      logCall(label, call);
      const recorded = await saveRecording(context, {
        registryKey: aux.registryKey,
        operation: aux.operation,
        params,
        call,
        note: `inqryDiv=2 + bidNtceNo 공고 1건 조회(${entry.bidNtceNo}-${entry.bidNtceOrd}), 표본 ${sample.seed}`,
        file,
      });
      calls += 1;
      didCall = true;
      if (!isSuccessResultCode(recorded.resultCode)) {
        failures.push({ tag, resultCode: recorded.resultCode });
        // 첫 공고에서 구조적으로 거부되면(07·08) 나머지 450회를 태우지 않는다.
        if (notices === 0) {
          throw new StopRecording(
            "RESULT_CODE",
            `${label} resultCode ${recorded.resultCode} — 보조 조회 요청 형식을 다시 본다`,
          );
        }
      } else {
        const foreign = recorded.items.filter((item) => item.bidNtceNo !== entry.bidNtceNo);
        if (foreign.length > 0) {
          throw new StopRecording(
            "FILTER_IGNORED",
            `${label} 다른 공고의 행 ${foreign.length}건 — bidNtceNo 가 무시됐다`,
          );
        }
      }
      await sleep(options.pauseMs);
    }
    if (didCall) notices += 1;
  }
  return { notices, calls, skipped, target, failures };
}

// ── 저장 뒤 폴더 전체 자가 검사 ──
async function selfCheck(context) {
  const { out, keyForms } = context;
  const files = [];
  async function walk(dir) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, name.name);
      if (name.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  await walk(out);
  const totals = { email: 0, phone: 0, serviceKeyParam: 0, secret: 0 };
  const offenders = [];
  for (const file of files) {
    const scan = scanLeaks(await readFile(file, "utf8"), keyForms);
    for (const key of Object.keys(totals)) totals[key] += scan[key];
    if (hasLeak(scan)) offenders.push(path.relative(out, file));
  }
  console.log(
    `[self-check] 파일 ${files.length}개: 이메일 ${totals.email} · 전화 ${totals.phone} · servicekey ${totals.serviceKeyParam} · 키 흔적 ${totals.secret}`,
  );
  if (offenders.length > 0) {
    throw new StopRecording("LEAK", `흔적이 남은 파일: ${offenders.join(", ")}`);
  }
  return { files: files.length, ...totals };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // dry-run 은 호출이 없어 키가 필요 없다. 그 밖에는 키 존재·형식을 먼저 확인한다(값은 출력하지 않는다).
  const key = options.dryRun
    ? { serviceKey: "dry-run-no-key", forms: [], shape: null }
    : await loadServiceKey(options.envRoot);
  if (key.shape !== null) {
    console.log(
      `[env] ${key.shape.envName}: 길이 ${key.shape.length}, ${key.shape.isEncoded ? "Encoding 키(%XX) → 1회 디코드" : "디코드 불필요"}, 디코드 뒤 길이 ${key.shape.decodedLength}`,
    );
  }
  if (options.checkEnv) return;

  const dateStamp = kstDateStamp(options.now);
  const serviceDir = path.join(options.out, G2B_SERVICE_ID);
  await mkdir(serviceDir, { recursive: true });
  const budget = new Budget({
    limit: options.budget,
    stopRemaining: options.stopRemaining,
    logFile: path.join(options.out, `calllog.${dateStamp}.jsonl`),
    dateStamp,
  });
  await budget.load();
  console.log(
    `[budget] 오늘(${dateStamp} KST) 앞선 호출 ${budget.usedBefore}회, 한도 ${budget.limit}회, remaining 하한 ${budget.stopRemaining}`,
  );

  const context = {
    options,
    dateStamp,
    serviceDir,
    out: options.out,
    sampleFile: path.join(options.out, "sample.v0.1.json"),
    budget,
    serviceKey: key.serviceKey,
    keyForms: key.forms,
    random: Math.random,
  };
  const summary = {};
  try {
    if (options.phase === "list" || options.phase === "all") summary.list = await runList(context);
    // dry-run 은 호출 계획만 본다. 표본·보조 조회는 목록 녹음이 있어야 하므로 예산 추정만 적는다.
    if (options.dryRun) {
      const listCalls = summary.list?.slices ?? 0;
      summary.auxPlan = {
        budgetAfterList: options.budget - budget.total - listCalls,
        affordableNotices: Math.floor(
          (options.budget - budget.total - listCalls) / AUX_OPERATIONS.length,
        ),
        requested: options.auxLimit,
      };
      return;
    }
    if (options.phase === "sample" || options.phase === "all")
      summary.sample = (await runSample(context)).counts;
    if (options.phase === "aux" || options.phase === "all") summary.aux = await runAux(context);
  } catch (error) {
    if (!(error instanceof StopRecording)) throw error;
    summary.stopped = { reason: error.reason, detail: error.message };
    console.error(`[stop] ${error.message}`);
    process.exitCode = 1;
  } finally {
    summary.calls = { thisRun: budget.used, today: budget.total, limit: budget.limit };
    summary.remainingByOperation = Object.fromEntries(budget.remainingByOperation);
    if (!options.dryRun) {
      try {
        summary.selfCheck = await selfCheck(context);
      } catch (error) {
        if (!(error instanceof StopRecording)) throw error;
        summary.selfCheck = { failed: error.message };
        console.error(`[self-check] ${error.message}`);
        process.exitCode = 1;
      }
    }
    console.log(`[summary] ${JSON.stringify(summary)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
