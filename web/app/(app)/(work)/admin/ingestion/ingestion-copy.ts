import type { IngestionRunView } from "@/server/ingestion";
import type { RunMode } from "@/server/bids";
import { formatCount } from "./ingest-format";

// /admin/ingestion 화면 글자(N8 디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md §3.4·§6, 초안).
// 서버 컴포넌트·클라이언트 부품이 같이 쓴다. 서버 모듈은 타입으로만 가져온다.

export const INGESTION_TITLE = "데이터 수집 관리";
export const INGESTION_DESCRIPTION =
  "공고 수집 실행 기록과 격리·재시도를 봅니다. 수집은 분석을 자동으로 시작하지 않습니다.";
export const INGESTION_PATH = "/admin/ingestion";
export const RUNS_ENDPOINT = "/api/v1/admin/ingestion/runs";

export const RUN_BUTTON_LABEL = "수동 수집 실행";
export const RUN_BUTTON_BUSY_HINT = "실행 중인 수집이 끝나면 다시 실행할 수 있습니다";
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

// ── 소스별 최근 수집 카드(스펙 §4.4·§6) ──

export const SOURCE_CARDS_TITLE = "소스별 최근 수집";
/** 카드 순서는 고정이다(스펙 §4.4). 서버가 어떤 순서로 주든 이 순서로 그린다. */
export const SOURCE_CARD_ORDER = ["fixture", "g2b"] as const satisfies readonly IngestSource[];
export const SOURCE_CARD_TERMS = {
  lastSuccess: "마지막 성공",
  lastFailure: "마지막 실패",
  loaded: "적재",
  quarantined: "격리",
} as const;
export const SOURCE_CARD_NONE = "없음";
export const SOURCE_CARD_EMPTY = "수집 기록이 없습니다";

// 받지 않는 소스는 받는 모드를 밝힌다. 모드 이름은 늘 "실행 모드" 앞말과 함께다(배치 LIVE 와 섞이지 않게).
const SOURCE_ONLY_MODES = {
  fixture: "실행 모드 fixture·mock에서만 실행할 수 있습니다",
  g2b: "실행 모드 live에서만 실행할 수 있습니다",
} as const satisfies Record<IngestSource, string>;

/** 카드의 "실행 가능" 줄. 지금 실행 모드에서 되면 그 모드를, 안 되면 받는 모드를 보인다. */
export const runnableLabel = (runMode: RunMode, source: IngestSource): string =>
  acceptsSource(runMode, source)
    ? `${runModeLabel(runMode)}에서 실행할 수 있습니다`
    : SOURCE_ONLY_MODES[source];

// 카드는 칸이 넓어 건수를 줄이지 않고 전체 수(ko-KR 자릿점)로 보인다.
const fullCount = (count: number): string => formatCount(count).full;

/** 카드 "적재" 값. 마지막 성공 run 의 summary 다. */
export const loadedLabel = (created: number, changed: number): string =>
  `신규 ${fullCount(created)} · 변경 ${fullCount(changed)}`;
/** 카드 "격리" 값. */
export const quarantinedLabel = (quarantined: number): string => `${fullCount(quarantined)}건`;
