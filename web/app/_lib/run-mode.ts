import "server-only";
import { readRunMode, type RunMode } from "@/server/analysis";

// 실행 모드(SOL_RUN_MODE). 잘못된 값이면 던진다(키 이름만 싣는다). 비어 있으면 mock 이다.
export function currentRunMode(): RunMode {
  return readRunMode(process.env).runMode;
}
