// 회사 운영 원본, 2026-10-25 사용자 제공. 내용을 바꾸면 회사 컨테이너와 어긋난다(import 하면 바로 기동하므로 시험에서 import 하지 않는다).
import { startAnalysisRuntime } from "./analysis-runtime";
import { readReconcileSettings } from "./analysis-reconcile";
import { readGatewayConfig, readRunMode as readAnalysisRunMode } from "@/server/analysis";

async function main(): Promise<void> {
  const env = process.env;

  // Redis 연결 전에 설정을 검증한다.
  readReconcileSettings(env);
  readGatewayConfig(env);
  readAnalysisRunMode(env);

  const runtime = startAnalysisRuntime(env);
  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;

    try {
      await runtime.close();
      console.log("analysis-only worker stopped");
      process.exit(0);
    } catch {
      console.error("analysis-only worker shutdown failed");
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  console.log("analysis-only worker started");
}

main().catch((error: unknown) => {
  console.error(
    "analysis-only worker startup failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  process.exitCode = 1;
});
