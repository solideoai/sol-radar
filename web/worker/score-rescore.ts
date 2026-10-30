import {
  createRescoreStore,
  rescore,
  toRescorePayload,
  toRescoreRunRow,
  type RescoreSource,
  type RescoreStore,
} from "@/server/analysis";
import { ALGORITHM_VERSION } from "@/server/scoring";
import { getSupabaseAdmin } from "@/server/supabase";
import { errorNameOf } from "@/worker/error-name";
import { errorCode } from "@/worker/main";

// ── 점수 재채점 CLI(`pnpm score:rescore`, ADR-071) ──
// 공고마다 화면에 보이는 분석 run 의 input_snapshot 을 현재 알고리즘으로 다시 계산해 새 run 으로 넣는다.
// Qwen·Bosun·gateway·Redis 를 부르지 않는다. 옛 run 은 이력으로 남는다. 이미 현재 버전인 run 은 건너뛴다.
// --dry-run 은 쓰지 않고 계산만 해서 점수 분포(건수·최소·최대·평균)를 한 줄로 알린다.
// 로그에는 run id·건수·분포만 싣는다. 공고 제목·원문·공고별 점수·오류 message 는 싣지 않는다(docs/14).
// worker 컨테이너 안에서 돈다(service role 이 거기 있다). 운영 DB 에 쓴다.

const LOAD_CHUNK = 25;
const NO_ORG_LINE = "rescore: --org-slug 의 조직이 없다";
const NO_PROFILE_LINE = "rescore: 조직의 회사 프로필이 없다";

export type RescoreOptions = { orgSlug: string; dryRun: boolean; limit: number | null };
export type RescoreDeps = {
  store: RescoreStore;
  now: () => Date;
  log: (line: string) => void;
};
export type RescoreResult = { exitCode: 0 | 1; line: string };

type Stats = { count: number; min: number; max: number; sum: number };
const emptyStats = (): Stats => ({ count: 0, min: 100, max: 0, sum: 0 });
const addTo = (stats: Stats, value: number): void => {
  stats.count += 1;
  stats.min = Math.min(stats.min, value);
  stats.max = Math.max(stats.max, value);
  stats.sum += value;
};
const describe = (stats: Stats): string =>
  stats.count === 0
    ? "n=0"
    : `n=${stats.count} min=${stats.min} max=${stats.max} avg=${(stats.sum / stats.count).toFixed(1)}`;

/** 재채점 한 번. 마지막 줄을 log 로 찍고 함께 돌려준다. 예상하지 못한 저장 오류는 던진다. */
export async function runRescore(
  deps: RescoreDeps,
  options: RescoreOptions,
): Promise<RescoreResult> {
  const end = (exitCode: RescoreResult["exitCode"], line: string): RescoreResult => {
    deps.log(line);
    return { exitCode, line };
  };
  const orgId = await deps.store.findOrgBySlug(options.orgSlug);
  if (orgId === null) return end(1, NO_ORG_LINE);
  const profile = await deps.store.latestProfile(orgId);
  if (profile === null) return end(1, NO_PROFILE_LINE);

  const shown = await deps.store.listShownRuns(orgId, profile.id);
  const stale = shown.filter((run) => run.algorithmVersion !== ALGORITHM_VERSION);
  const targets = options.limit === null ? stale : stale.slice(0, options.limit);
  const counted = `shown=${shown.length} current=${shown.length - stale.length} targets=${targets.length}`;
  deps.log(`rescore: ${ALGORITHM_VERSION} ${options.dryRun ? "dry-run " : ""}시작 ${counted}`);

  const before = emptyStats();
  const after = emptyStats();
  const tally = {
    written: 0,
    existing: 0,
    busy: 0,
    invalid: 0,
    failed: 0,
    recommendationChanged: 0,
  };
  for (let index = 0; index < targets.length; index += LOAD_CHUNK) {
    const ids = targets.slice(index, index + LOAD_CHUNK).map((run) => run.id);
    const sources = await deps.store.loadSources(orgId, ids);
    for (const source of sources) {
      const outcome = await rescoreOne(deps, orgId, source, options.dryRun);
      if (outcome.kind === "INVALID") {
        tally.invalid += 1;
        deps.log(`rescore: ${source.id} INVALID — 스냅샷을 다시 계산하지 못해 건너뛴다`);
        continue;
      }
      addTo(before, outcome.before.score);
      addTo(after, outcome.after.score);
      if (outcome.before.recommendation !== outcome.after.recommendation)
        tally.recommendationChanged += 1;
      if (outcome.kind === "WRITTEN") tally.written += 1;
      if (outcome.kind === "EXISTING") tally.existing += 1;
      if (outcome.kind === "BUSY") tally.busy += 1;
      if (outcome.kind === "FAILED") {
        tally.failed += 1;
        deps.log(`rescore: ${source.id} FAILED`);
      }
    }
  }
  const summary =
    `rescore: ${counted} written=${tally.written} existing=${tally.existing} busy=${tally.busy} ` +
    `invalid=${tally.invalid} failed=${tally.failed} recommendation_changed=${tally.recommendationChanged} ` +
    `before[${describe(before)}] after[${describe(after)}]`;
  return end(tally.failed === 0 && tally.invalid === 0 ? 0 : 1, summary);
}

type Scored = { score: number; recommendation: string };
type OneOutcome =
  | { kind: "INVALID" }
  | { kind: "DRY_RUN" | "WRITTEN" | "EXISTING" | "BUSY" | "FAILED"; before: Scored; after: Scored };

async function rescoreOne(
  deps: RescoreDeps,
  orgId: string,
  source: RescoreSource,
  dryRun: boolean,
): Promise<OneOutcome> {
  const computed = rescore(source);
  const previous = scoredOf(source);
  if (computed === null || previous === null) return { kind: "INVALID" };
  const scores = {
    before: previous,
    after: { score: computed.result.score, recommendation: computed.result.recommendation },
  };
  if (dryRun) return { kind: "DRY_RUN", ...scores };
  const startedAt = deps.now().toISOString();
  const inserted = await deps.store.insertRun(toRescoreRunRow(orgId, source, startedAt));
  if (inserted.kind !== "CREATED") return { kind: inserted.kind, ...scores };
  const payload = toRescorePayload({
    orgId,
    runId: inserted.id,
    source,
    ...computed,
    startedAt,
    finishedAt: deps.now().toISOString(),
  });
  try {
    if (payload === null) throw new Error("rescore: run_mode·ai_provider 를 모른다");
    await deps.store.finish(payload);
    return { kind: "WRITTEN", ...scores };
  } catch {
    // 넣은 RUNNING 행이 남으면 멈춘 run 복구가 분석 job 으로 다시 넣는다. 그 전에 닫는다.
    await deps.store.markFailed(orgId, inserted.id, deps.now().toISOString());
    return { kind: "FAILED", ...scores };
  }
}

/** 원본 run 의 점수·권고(스냅샷이 아니라 이전 버전 계산 결과). 화면에 보이던 값이다. */
function scoredOf(source: RescoreSource): Scored | null {
  return source.score === null || source.recommendation === null
    ? null
    : { score: source.score, recommendation: source.recommendation };
}

// ── 인자 ──

const ORG_SLUG_FLAG = "--org-slug";
const LIMIT_FLAG = "--limit";
const DRY_RUN_FLAG = "--dry-run";
const USAGE = `사용법: score-rescore.ts ${ORG_SLUG_FLAG} <slug> [${LIMIT_FLAG} <1 이상>] [${DRY_RUN_FLAG}]`;
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** pnpm 이 넘기는 `--` 는 건너뛴다. 인자 값은 오류에 싣지 않는다. 틀리면 사용법만 알린다. */
export function parseRescoreArgs(argv: readonly string[]): RescoreOptions {
  const args = argv.filter((arg) => arg !== "--");
  const values = new Map<string, string>();
  let dryRun = false;
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === DRY_RUN_FLAG && !dryRun) {
      dryRun = true;
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if ((arg !== ORG_SLUG_FLAG && arg !== LIMIT_FLAG) || values.has(arg) || value === undefined) {
      throw new Error(USAGE);
    }
    values.set(arg, value);
    index += 2;
  }
  const orgSlug = values.get(ORG_SLUG_FLAG);
  if (orgSlug === undefined || !SLUG_PATTERN.test(orgSlug)) throw new Error(USAGE);
  const limit = values.get(LIMIT_FLAG);
  if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new Error(USAGE);
  return { orgSlug, dryRun, limit: limit === undefined ? null : Number(limit) };
}

// ── 실행 ──

/** 실패 줄의 오류 이름(+ 코드). 이름은 공용 규칙으로 거른다. message 는 싣지 않는다. */
function errorLabel(error: unknown): string {
  const name = errorNameOf(error);
  const code = errorCode(error);
  return code === null ? name : `${name} ${code}`;
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: RescoreOptions;
  try {
    options = parseRescoreArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "rescore: 설정 오류");
    return 1;
  }
  try {
    const result = await runRescore(
      {
        store: createRescoreStore(getSupabaseAdmin()),
        now: () => new Date(),
        log: (line) => {
          console.log(line);
        },
      },
      options,
    );
    return result.exitCode;
  } catch (error) {
    // 저장소 오류. 넣은 run 은 그대로 둔다. 다시 돌리면 이미 현재 버전인 공고는 건너뛰고 남은 공고만 계산한다.
    console.error(`rescore: 멈췄다(${errorLabel(error)}) — Supabase 를 확인하고 다시 돌린다`);
    return 1;
  }
}

// 시험이 불러올 때는 돌지 않는다(worker/main.ts 와 같은 argv 검사).
if (/[\\/]worker[\\/]score-rescore\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      console.error("rescore: 예기치 않은 오류로 멈췄다");
      process.exitCode = 1;
    },
  );
}
