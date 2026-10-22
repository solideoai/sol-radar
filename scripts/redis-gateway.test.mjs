import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("company runtime exposes only the authenticated HTTP API and reuses existing Redis", async () => {
  const config = parse(
    await readFile(new URL("../infra/compose.company.yaml", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(config.services), ["redis-api", "ai-gateway", "worker"]);
  const api = config.services["redis-api"];
  assert.deepEqual(api.build, { context: "..", dockerfile: "web/Dockerfile" });
  assert.deepEqual(api.ports, ["127.0.0.1:6380:3000"]);
  assert.equal(api.restart, "unless-stopped");
  assert.equal(api.environment.SOL_DEPLOYMENT_ROLE, "redis-api");
  assert.equal(api.networks.length, 2);
  assert.equal(config.networks[api.networks[0]].external, true);
  assert.equal(config.volumes, undefined);
  assert.equal(api.environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(api.environment.AI_GATEWAY_URL, "http://ai-gateway:8000");
  const worker = config.services.worker;
  const ai = config.services["ai-gateway"];
  assert.equal(worker.env_file, ".env.worker.local");
  assert.equal(ai.env_file, ".env.ai-gateway.local");
  assert.equal(worker.environment.AI_GATEWAY_URL, api.environment.AI_GATEWAY_URL);
  assert.equal(worker.environment.SOL_RUN_MODE, api.environment.SOL_RUN_MODE);
  assert.equal(ai.environment.SOL_RUN_MODE, api.environment.SOL_RUN_MODE);
  assert.equal(worker.ports, undefined);
  assert.equal(ai.ports, undefined);
  assert.equal(ai.networks.includes(api.networks[0]), false);
  assert.equal(
    worker.volumes.every((v) => v.endsWith(":ro")),
    true,
  );
});

test("Vercel web-only deployment cannot include model runtimes or AI bindings", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(config.services), ["web"]);
  assert.equal(config.services.web.bindings, undefined);
  assert.equal(config.rewrites[0].destination.service, "web");
});

test("Gateway image cannot copy local secret files and starts the existing Next standalone server", async () => {
  const dockerfile = await readFile(new URL("../web/Dockerfile", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../web/Dockerfile.dockerignore", import.meta.url), "utf8");
  const aiIgnore = await readFile(
    new URL("../services/ai/Dockerfile.dockerignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /\*\*\/\.env\*/);
  assert.match(aiIgnore, /\*\*\/\.env\*/);
  assert.match(aiIgnore, /^\*$/m);
  assert.match(ignore, /node_modules/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(dockerfile, /COPY infra\/sources\/ \/app\/infra\/sources\//);
  assert.match(dockerfile, /WORKDIR \/app\/web/);
  assert.match(dockerfile, /CMD \["node", "server.js"\]/);
  assert.doesNotMatch(dockerfile, /COPY.*\.env/);
});
