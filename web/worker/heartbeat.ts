import { rmSync, writeFileSync } from "node:fs";

export const HEARTBEAT_INTERVAL_MS = 10_000;

// /tmp 는 컨테이너가 재시작해도 남는다. 옛 파일이 살아 있는 척하지 않게 기동 전과 종료 때 지운다.
// 파일이 없는 것(ENOENT)은 정상이고, 그 밖의 오류는 그대로 던진다.
export function removeHeartbeatFile(file: string): void {
  rmSync(file, { force: true });
}

// 컨테이너 healthcheck 가 파일 mtime 으로 살아 있음을 본다.
export function startHeartbeat(
  file: string,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): { stop(): void } {
  const beat = () => {
    try {
      writeFileSync(file, `${new Date().toISOString()}\n`);
    } catch {
      console.error("worker heartbeat 기록 실패");
    }
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      removeHeartbeatFile(file);
    },
  };
}
