import IORedis from "ioredis";
import {
  createDependencyReporter,
  createStorageProbe,
  dependencyPublish,
  startDependencyReporter,
} from "./dependency-health";
import { createWorkerStorageClient } from "./storage-client";
import { readStorageSettings } from "@/server/documents";
import { probeAi } from "@/server/health";
import { readWorkerEnv } from "./env";

const env = process.env;
const settings = readStorageSettings(env);
const workerEnv = readWorkerEnv(env);

if (!env.AI_GATEWAY_URL?.trim()) {
  throw new Error("AI_GATEWAY_URL is required");
}

const redis = new IORedis(workerEnv.redisUrl, {
  maxRetriesPerRequest: 1,
  commandTimeout: 3_000,
});

redis.on("error", () => {
  console.error("dependency reporter Redis connection error");
});

const reporter = startDependencyReporter(
  createDependencyReporter({
    scope: {
      runMode: env.SOL_RUN_MODE?.trim() || "mock",
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, ""),
      ...settings,
    },
    now: Date.now,
    storage: createStorageProbe(createWorkerStorageClient(env, 5_000), settings),
    ai: () => probeAi(env.AI_GATEWAY_URL),
    publish: dependencyPublish(redis),
  }),
);

let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await reporter.close();
  } finally {
    redis.disconnect();
  }
}

process.once("SIGTERM", () => {
  void shutdown();
});

process.once("SIGINT", () => {
  void shutdown();
});

console.log("dependency reporter started");
