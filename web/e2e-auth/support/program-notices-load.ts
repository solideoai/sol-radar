import { getSupabaseAdmin } from "@/server/supabase";
import { programNoticesWorkerRegistration } from "@/worker/program-notices";

// 부처 지원사업 공고 E2E 의 적재 한 번(programs-setup.ts 가 자식 프로세스로 부른다). worker 코드는 고치지 않고 그대로 쓴다.
//   pnpm -C web exec node --conditions=react-server --import tsx e2e-auth/support/program-notices-load.ts
// 등록 함수(programNoticesWorkerRegistration)의 2단계를 부르면 첫 회차가 바로 돈다. 그 회차가 끝날 때까지 기다린 뒤 close() 한다
// (close 는 타이머를 멈추고 진행 중 회차를 최대 5초 기다린다). 회차 끝은 program_notice_runs 에 이번 mss run 이 남은 것으로 안다 —
// 회차는 PROGRAM_NOTICE_SOURCES 순서(bizinfo → mss)로 돌고 소스마다 run 을 남기므로 mss run 이 마지막 기록이다.
//
// env(부르는 쪽이 이 자식에만 준다): NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY(격리 Supabase)·SOL_RUN_MODE=mock·
// FIXTURES_DIR·SOURCES_REGISTRY_FILE. mock 모드는 네트워크 대신 FIXTURES_DIR/recorded/program-notices/<소스>/ 녹음을 재생한다.
// 출력: worker 의 JSON 로그 줄(상태·건수·오류 코드만) + 마지막 줄 `program-notices-load: …`(건수·상태). 키·주소는 찍지 않는다.

const WAIT_MS = 60_000;
const POLL_MS = 250;
// 회차의 마지막 소스. 이 소스의 run 이 기록되면 회차가 끝난 것이다.
const LAST_SOURCE = "mss";

type RunRow = {
  source: string;
  status: string;
  error_code: string | null;
  saved_count: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runsSince(startedAt: Date): Promise<RunRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("program_notice_runs")
    .select("source, status, error_code, saved_count")
    .gte("started_at", startedAt.toISOString())
    .order("started_at", { ascending: true });
  // 오류 문장에는 코드만 싣는다(메시지에 값이 실릴 수 있다).
  if (error) throw new Error(`program_notice_runs 읽기 실패(code=${error.code ?? "unknown"})`);
  return data;
}

async function waitForRound(startedAt: Date): Promise<RunRow[]> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const runs = await runsSince(startedAt);
    if (runs.some((run) => run.source === LAST_SOURCE)) return runs;
    await sleep(POLL_MS);
  }
  throw new Error(
    `${WAIT_MS / 1000}초 안에 ${LAST_SOURCE} run 이 기록되지 않았다(위 program_notices.disabled·round_failed 줄을 본다).`,
  );
}

async function countNotices(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("program_notices")
    .select("id", { count: "exact", head: true });
  if (error || count === null)
    throw new Error(`program_notices 세기 실패(code=${error?.code ?? "unknown"})`);
  return count;
}

const describeRun = (run: RunRow): string =>
  `${run.source}:${run.status}${run.error_code === null ? "" : `/${run.error_code}`}(saved=${run.saved_count})`;

async function main() {
  const startedAt = new Date();
  const start = await programNoticesWorkerRegistration(process.env);
  // 2단계는 공유 Redis 연결을 쓰지 않는다(등록 함수 주석). 연결 자리에 null 을 준다.
  const collector = await start(null);
  let runs: RunRow[];
  try {
    runs = await waitForRound(startedAt);
  } finally {
    await collector.close();
  }
  const notices = await countNotices();
  console.log(`program-notices-load: notices=${notices} runs=${runs.map(describeRun).join(",")}`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      `program-notices-load 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    );
    process.exit(1);
  },
);
