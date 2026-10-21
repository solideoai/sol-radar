import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("company Compose publishes only the HTTP service on loopback6380 and reuses external Redis", async () => {
  const config = parse(
    await readFile(new URL("../infra/compose.company.yaml", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(config.services), ["redis-api"]);
  const api = config.services["redis-api"];
  assert.deepEqual(api.ports, ["127.0.0.1:6380:3000"]);
  assert.equal(api.restart, "unless-stopped");
  assert.equal(api.environment.SOL_DEPLOYMENT_ROLE, "redis-api");
  assert.equal(api.networks.length, 1);
  assert.equal(config.networks[api.networks[0]].external, true);
  assert.equal(config.volumes, undefined);
  assert.equal(api.environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("Gateway image cannot copy local secret files and starts the existing Next standalone server", async () => {
  const dockerfile = await readFile(new URL("../web/Dockerfile", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../web/Dockerfile.dockerignore", import.meta.url), "utf8");
  assert.match(ignore, /\*\*\/\.env\*/);
  assert.match(ignore, /node_modules/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(dockerfile, /CMD \["node", "server.js"\]/);
  assert.doesNotMatch(dockerfile, /COPY.*\.env/);
});
