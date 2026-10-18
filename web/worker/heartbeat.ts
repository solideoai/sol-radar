import { writeFileSync } from "node:fs";

export const HEARTBEAT_INTERVAL_MS = 10_000;

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
    },
  };
}
