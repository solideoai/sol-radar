import "server-only";
import { readRunMode, type RunMode } from "@/server/analysis";
import { defaultOrigin, type BidListOrigin } from "@/server/bids";

// 실행 모드(SOL_RUN_MODE). 잘못된 값이면 던진다(키 이름만 싣는다). 비어 있으면 mock 이다.
export function currentRunMode(): RunMode {
  return readRunMode(process.env).runMode;
}

const RUN_MODES: readonly RunMode[] = ["live", "fixture", "mock"];
const isRunMode = (value: string): value is RunMode => RUN_MODES.some((mode) => mode === value);

// 수동 수집 실행 모드(SOL_INGEST_MODE). 회사 redis-api 는 분석 Worker 와 맞추려고 SOL_RUN_MODE 를 mock 으로 두면서도
// 공공 API 수동 수집(live)을 받아야 한다. 그래서 수집 판정만 따로 정한다. 비어 있으면 SOL_RUN_MODE 를 따르고,
// 잘못된 값이면 SOL_RUN_MODE 와 같이 던진다(키 이름만 싣는다). 틀린 설정으로 공공 API 를 부르지 않는다.
export function currentIngestMode(): RunMode {
  const value = process.env.SOL_INGEST_MODE?.trim() ?? "";
  if (value === "") return currentRunMode();
  if (!isRunMode(value)) throw new Error("env 오류: SOL_INGEST_MODE");
  return value;
}

// 화면의 기본 데이터 출처. SOL_DEFAULT_ORIGIN(live·demo·all)이 없거나 틀리면 실행 모드로 정한다(@/server/bids defaultOrigin).
// 실행 모드 라벨과 따로 둔다. 회사 런타임이 live 여도 발표 화면은 demo 를 기본으로 보일 수 있어야 한다(10-25 계획 D2).
export function currentDefaultOrigin(runMode: RunMode = currentRunMode()): BidListOrigin {
  return defaultOrigin(runMode, process.env.SOL_DEFAULT_ORIGIN);
}

// "다음 수집 예정" 추정에 쓰는 주기(분). 웹(Vercel)은 worker 가 정기 일정을 실제로 걸었는지 알 수 없어 추정하지 않는다
// (예전 G2B_INGEST_INTERVAL_MINUTES 는 더 읽지 않는다). 그래서 늘 null 이고 대시보드는 "다음 수집 예정"을 숨긴다.
// 실제 다음 실행은 관리자 수집 화면이 GET /admin/ingestion/manual-gate 의 schedule 로 보여 준다.
// 수집 지연 기준은 이 값과 상관없이 정기 일정 간격 + 30분이다(@/server/opportunities ingestStaleAfterMs).
export function currentIngestIntervalMinutes(): null {
  return null;
}
