import type { IngestionRunView } from "@/server/ingestion";
import type { RunMode } from "@/server/bids";

// /admin/ingestion 화면 글자(N8 디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md §3.4·§6, 초안).
// 서버 컴포넌트·클라이언트 부품이 같이 쓴다. 서버 모듈은 타입으로만 가져온다.

export const INGESTION_TITLE = "데이터 수집 관리";
export const INGESTION_DESCRIPTION =
  "공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.";
export const INGESTION_PATH = "/admin/ingestion";
export const RUNS_ENDPOINT = "/api/v1/admin/ingestion/runs";

export const RUN_BUTTON_LABEL = "수동 수집 실행";
export const RUN_BUTTON_BUSY_HINT = "실행 중인 수집이 끝나면 다시 실행할 수 있습니다";

// 실수집(수집 모드 live) 머리 단추 [지금 불러오기](10-26 운영 전환). 수집 모드는 manual-gate 응답의 ingestMode 다
// (Vercel 웹의 SOL_RUN_MODE 는 mock 이라 화면의 runMode 로는 실수집인지 알 수 없다).
export const MANUAL_GATE_ENDPOINT = "/api/v1/admin/ingestion/manual-gate";
export const LIVE_RUN_BUTTON_LABEL = "지금 불러오기";
export const LIVE_RUN_BUTTON_BUSY = "요청 중…";
export const GATE_CHECKING_LABEL = "상태 확인 중";
export const GATE_UNKNOWN_NOTICE = "수동 불러오기 상태를 확인할 수 없습니다";
export const IN_PROGRESS_NOTICE = "수집이 진행 중입니다 · 끝나면 결과가 반영됩니다";
export const SCHEDULER_INACTIVE_NOTICE = "수집 Worker 가 아직 켜지지 않았습니다 · 운영자에게 문의";
export const SCHEDULE_OFF = "정기 수집: 꺼짐";
export const SHOW_RUN_LABEL = "실행 중인 수집 보기";
export const REANALYZE_HINT =
  "바뀐 공고는 자동으로 다시 분석하지 않습니다. 공고 상세에서 [재분석]을 누르세요.";

export const EMPTY_TITLE = "아직 수집을 실행하지 않았습니다";
export const EMPTY_DESCRIPTION = "수집을 실행하면 실행마다 한 줄씩 여기에 남습니다.";

// 폴링·서랍이 401·403 을 받았을 때(§4.8). 화면 진입 뒤 세션이 끝났거나 역할이 바뀐 경우다.
export const SESSION_EXPIRED = "로그인이 만료되었습니다. 다시 로그인하세요.";
export const ACCESS_LOST = "이 화면을 볼 권한이 없어졌습니다.";
export const LOGIN_PATH = "/auth/login";

export type IngestSource = IngestionRunView["source"];
export type IngestBatch = NonNullable<IngestionRunView["batch"]>;
export type IngestRun = IngestionRunView;

const SOURCE_LABEL = {
  fixture: { long: "데모 데이터 (fixture)", short: "데모 데이터" },
  g2b: { long: "나라장터 (g2b)", short: "나라장터" },
  kwater: { long: "K-water", short: "K-water" },
  lh: { long: "LH", short: "LH" },
  kepco: { long: "KEPCO", short: "KEPCO" },
} as const satisfies Record<IngestSource, { long: string; short: string }>;

export const sourceLabel = (source: IngestSource, short = false): string =>
  SOURCE_LABEL[source][short ? "short" : "long"];

// 배치 LIVE 는 실행 모드 live 와 다르다(19 §2.1). 둘이 섞이지 않게 앞말을 늘 붙인다.
export const batchLabel = (batch: IngestBatch): string => `배치 ${batch.toUpperCase()}`;
export const runModeLabel = (runMode: RunMode): string => `실행 모드 ${runMode}`;

const REQUESTER_UNKNOWN = "요청자 정보 없음";

/** 실행 방식 글자. long 은 서랍(데모 초기화 명령까지)이다. */
export function triggerLabel(run: Pick<IngestRun, "trigger" | "requestedBy">, long = false) {
  switch (run.trigger) {
    case "MANUAL":
      return `수동 · ${run.requestedBy?.name ?? REQUESTER_UNKNOWN}`;
    case "DEMO":
      return long ? "데모 초기화 (pnpm demo:reset)" : "데모 초기화";
    case "SCHEDULED":
      return "일정";
  }
}

/** 소스 글자 + fixture 면 배치. 표 첫 줄·상태 줄·서랍 부제가 같이 쓴다. */
export function sourceWithBatch(run: Pick<IngestRun, "source" | "batch">, short = false): string {
  const source = sourceLabel(run.source, short);
  return run.batch === null ? source : `${source} · ${batchLabel(run.batch)}`;
}

// 05 :428·ADR-020. live 는 g2b 만, fixture·mock 은 fixture 만 받는다. 최종 판정은 서버(409 RUN_MODE_MISMATCH)다.
export const acceptsSource = (runMode: RunMode, source: IngestSource): boolean =>
  runMode === "live" ? source === "g2b" : source === "fixture";
