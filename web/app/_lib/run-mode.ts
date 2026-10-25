import "server-only";
import { readRunMode, type RunMode } from "@/server/analysis";
import { defaultOrigin, type BidListOrigin } from "@/server/bids";
import { parseIngestIntervalMinutes } from "@/server/opportunities";

// 실행 모드(SOL_RUN_MODE). 잘못된 값이면 던진다(키 이름만 싣는다). 비어 있으면 mock 이다.
export function currentRunMode(): RunMode {
  return readRunMode(process.env).runMode;
}

// 화면의 기본 데이터 출처. SOL_DEFAULT_ORIGIN(live·demo·all)이 없거나 틀리면 실행 모드로 정한다(@/server/bids defaultOrigin).
// 실행 모드 라벨과 따로 둔다. 회사 런타임이 live 여도 발표 화면은 demo 를 기본으로 보일 수 있어야 한다(10-25 계획 D2).
export function currentDefaultOrigin(runMode: RunMode = currentRunMode()): BidListOrigin {
  return defaultOrigin(runMode, process.env.SOL_DEFAULT_ORIGIN);
}

// 수집 주기(분, G2B_INGEST_INTERVAL_MINUTES). worker 와 같은 이름이다. 없거나 틀리면 null(화면은 기본 60분 기준).
export function currentIngestIntervalMinutes(): number | null {
  return parseIngestIntervalMinutes(process.env.G2B_INGEST_INTERVAL_MINUTES);
}
