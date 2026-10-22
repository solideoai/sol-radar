// Opt-in integration verification. Owns a disposable Redis; never accepts a Redis URL or reads .env.
// pnpm -C web exec node --conditions=react-server --import tsx ../scripts/verify-quota-redis.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { setTimeout as pause } from "node:timers/promises";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const Redis = requireWeb("ioredis");
const { createRedisQuotaStore, QUOTA_REDIS_OPTIONS, QUOTA_KEY_TTL_SECONDS } =
  await import("../web/worker/quota-store.ts");
const { createMemoryIngestionRepo } =
  await import("../web/server/ingestion/ingestion.repo.memory.ts");
const { createExternalSourceConnector } =
  await import("../web/server/ingestion/external-api-connector.ts");
const { createOfficialApiConnector } =
  await import("../web/server/ingestion/official-api-connector.ts");
const { createG2bAuxFetcher } = await import("../web/server/ingestion/g2b-aux.ts");
const { G2B_AUX_OPERATIONS, G2B_BID_NOTICE_LIST_OPERATION } =
  await import("../web/server/ingestion/g2b.model.ts");
const { quotaKey } = await import("../web/server/ingestion/quota.ts");
const { processIngestJob } = await import("../web/worker/ingest-queue.ts");

assert.equal(process.argv.length, 2, "This harness takes no connection arguments");
let realHttpAttempts = 0;
globalThis.fetch = async () => {
  realHttpAttempts++;
  throw new Error("Real HTTP is forbidden in this isolated verification");
};
const id = `sol-f08-${randomUUID()}`;
const image = "redis:7.4-alpine";
const containerPort = 16379;
const clients = new Set();
const proxies = new Set();
const allowedPorts = new Set();
let networkCreated = false;
let containerCreated = false;
let port;
const at = new Date("2026-10-22T03:00:00Z");
const window = { from: "2026-10-21T00:00:00Z", to: "2026-10-22T00:00:00Z" };

function docker(...args) {
  console.log(`$ docker ${args.join(" ")}`);
  const output = execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
  if (output) console.log(output);
  return output;
}

async function connect(options = {}) {
  assert.equal(options.host, undefined, "Redis host overrides are forbidden");
  assert.ok(allowedPorts.has(options.port ?? port), "Only harness-owned ports are permitted");
  const client = new Redis({
    ...QUOTA_REDIS_OPTIONS,
    host: "127.0.0.1",
    port,
    lazyConnect: true,
    ...options,
  });
  clients.add(client);
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

// Faults affect only the first EVAL. A reconnect is allowed to succeed, exposing accidental replay.
async function faultProxy(mode) {
  const sockets = new Set();
  let faulted = false;
  let observedFault;
  const injected = new Promise((resolve) => (observedFault = resolve));
  const server = createServer((downstream) => {
    const upstream = createConnection({ host: "127.0.0.1", port });
    sockets.add(downstream);
    sockets.add(upstream);
    let pendingFault = false;
    let command = "";
    for (const socket of [downstream, upstream]) {
      socket.on("error", () => undefined);
      socket.on("close", () => sockets.delete(socket));
    }
    downstream.on("close", () => upstream.destroy());
    upstream.on("close", () => downstream.destroy());
    downstream.on("data", (data) => {
      command = (command + data.toString()).slice(-32_768);
      if (!faulted && /\r\nEVAL\r\n/i.test(command)) {
        faulted = true;
        pendingFault = true;
        command = "";
        if (mode === "disconnect") {
          observedFault();
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (mode === "timeout") {
          observedFault();
          return; // socket stays open, EVAL is not forwarded, commandTimeout must fire
        }
      }
      upstream.write(data);
    });
    upstream.on("data", (data) => {
      if (pendingFault && mode === "response-loss") {
        observedFault(); // Redis actually executed EVAL; discard its reply, then drop transport
        downstream.destroy();
        upstream.destroy();
        return;
      }
      downstream.write(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxyPort = server.address().port;
  assert.ok(![6379, 6380].includes(proxyPort));
  allowedPorts.add(proxyPort);
  const proxy = {
    port: proxyPort,
    injected,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      proxies.delete(proxy);
    },
  };
  proxies.add(proxy);
  return proxy;
}

async function liveRun(store, serviceId, name, options = {}) {
  const repo = createMemoryIngestionRepo();
  let http = 0;
  const fetch = async (url) => {
    http++;
    return (
      options.fetch?.(http, url) ??
      Response.json({
        response: { header: { resultCode: "00" }, body: { items: [], totalCount: 0 } },
      })
    );
  };
  const quota = { store, serviceId, dailyLimit: options.dailyLimit ?? 10 };
  const g2b = options.source === "g2b";
  const result = await processIngestJob(
    {
      source: g2b ? "g2b" : "lh",
      ...(g2b ? {} : { serviceKey: "lh-bid-notice" }),
      trigger: options.trigger ?? "SCHEDULED",
      ...(options.trigger === "MANUAL" ? { orgId: randomUUID(), requestedBy: randomUUID() } : {}),
      jobKey: name,
      window,
    },
    {
      repo,
      runMode: "live",
      quota,
      quotaForExternal: () => quota,
      externalSourceGate: () => null, // test injection only; registry is never edited
      createFixtureConnector: async () => {
        throw new Error("fixture should not be constructed");
      },
      createG2bConnector: async () =>
        createOfficialApiConnector({
          endpoint: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
          serviceKey: "test-only-key",
          fetch,
        }),
      ...(options.aux
        ? {
            createG2bAuxFetcher: async () =>
              createG2bAuxFetcher({
                endpoint: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
                serviceKey: "test-only-key",
                fetch,
                retry: { random: () => 0, sleep: async () => undefined },
              }),
          }
        : {}),
      createExternalConnector: async () =>
        createExternalSourceConnector({
          sourceKey: "lh-bid-notice",
          serviceKey: "test-only-key",
          fetch,
        }),
      enqueueDocuments: async () => undefined,
      recordManualAudit: async () => undefined,
      now: options.now ?? (() => at),
      retry: { random: () => 0, sleep: async () => undefined },
      secrets: [],
    },
  );
  return {
    status: result.status,
    http,
    quotaUsed: [...repo.state.runs.values()].find((run) => run.runId === result.runId)?.quotaUsed,
    errors: repo.state.errors.map((error) => error.errorCode),
  };
}

function blocked(outcome) {
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.http, 0);
  assert.ok(outcome.errors.includes("QUOTA_STORE_UNAVAILABLE"));
}

try {
  assert.equal(process.env.DOCKER_HOST, undefined, "DOCKER_HOST overrides are unsupported");
  const endpoint = docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}");
  assert.ok(endpoint.startsWith("unix://"), "Only a local Unix Docker socket is permitted");
  // Docker --internal suppresses published ports. Use an exclusive bridge with egress masquerading off.
  docker(
    "network",
    "create",
    "--opt",
    "com.docker.network.bridge.enable_ip_masquerade=false",
    "--label",
    `sol.f08=${id}`,
    id,
  );
  networkCreated = true;
  docker(
    "run",
    "--detach",
    "--name",
    id,
    "--network",
    id,
    "--label",
    `sol.f08=${id}`,
    "--publish",
    `127.0.0.1::${containerPort}`,
    "--read-only",
    "--user",
    "redis",
    "--tmpfs",
    "/data:rw,noexec,nosuid,size=16m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "128m",
    "--cpus",
    "1",
    image,
    "redis-server",
    "--port",
    String(containerPort),
    "--save",
    "",
    "--appendonly",
    "no",
    "--protected-mode",
    "no",
  );
  containerCreated = true;
  const inspected = JSON.parse(
    docker(
      "inspect",
      "--format",
      '{"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}',
      id,
    ),
  );
  if (!inspected.running) docker("logs", id);
  assert.equal(inspected.running, true);
  assert.equal(inspected.labels["sol.f08"], id);
  assert.equal(Object.keys(inspected.networks).join(), id);
  assert.equal(inspected.mounts.filter((mount) => mount.Type !== "tmpfs").length, 0);
  const binding = inspected.ports[`${containerPort}/tcp`][0];
  assert.equal(binding.HostIp, "127.0.0.1");
  port = Number(binding.HostPort);
  assert.ok(Number.isSafeInteger(port) && port > 1024 && ![6379, 6380].includes(port));
  allowedPorts.add(port);
  console.log(`ISOLATED redis=127.0.0.1:${port}, internal container port=${containerPort}`);
  docker("image", "inspect", image, "--format", "{{.Id}} {{json .RepoDigests}}");
  const admin = await connect();
  console.log(
    `Redis ${
      Object.fromEntries(
        (await admin.info("server"))
          .split("\r\n")
          .filter((s) => s.includes(":"))
          .map((s) => s.split(":")),
      ).redis_version
    }`,
  );

  const store = createRedisQuotaStore(admin, { dailyLimit: 10 });
  const single = createRedisQuotaStore(admin, { dailyLimit: 1 });
  assert.equal(await single.reserve("single-slot", at), true);
  assert.equal(await single.reserve("single-slot", at), false);
  assert.equal(await single.get("single-slot", at), 1);
  console.log("PASS A dailyLimit=1: reserve=true,false final counter=1");
  const key = quotaKey("ttl", at);
  assert.equal(await store.reserve("ttl", at), true);
  assert.equal(await admin.get(key), "1");
  assert.equal(QUOTA_KEY_TTL_SECONDS, 172800);
  let ttl = await admin.ttl(key);
  assert.ok(ttl >= 172799 && ttl <= 172800);
  console.log(`PASS reserve actual Lua: used=1 TTL=${ttl}s (2 days)`);
  await store.markExhausted("ttl", at);
  assert.equal(await store.get("ttl", at), 10);
  assert.equal(await store.reserve("ttl", at), false);
  ttl = await admin.ttl(key);
  assert.ok(ttl >= 172799 && ttl <= 172800);
  await admin.set(quotaKey("above-limit", at), "12");
  await store.markExhausted("above-limit", at);
  assert.equal(await store.get("above-limit", at), 12);
  console.log(
    `PASS exhaustion actual Lua: used=10 denied=true TTL=${ttl}s; above-limit=12 preserved`,
  );
  // Physical expiration is accelerated only in this disposable instance; production TTL remains 2 days.
  await admin.pexpire(key, 50);
  await pause(100);
  assert.equal(await admin.exists(key), 0);
  assert.equal(await store.reserve("ttl", at), true);
  assert.equal(await store.get("ttl", at), 1);
  ttl = await admin.ttl(key);
  assert.ok(ttl >= 172799 && ttl <= 172800);
  console.log("PASS accelerated physical expiration: absent -> reserve=1, TTL reset to 2 days");

  const before = new Date("2026-10-22T14:59:59Z");
  const after = new Date("2026-10-22T15:00:00Z");
  let clock = before;
  const midnight = createRedisQuotaStore(admin, { dailyLimit: 1 });
  const crossed = await liveRun(midnight, "midnight", "midnight", {
    dailyLimit: 1,
    now: () => clock,
    fetch: (calls) => {
      clock = after;
      return calls === 1 ? new Response("unavailable", { status: 503 }) : undefined;
    },
  });
  assert.equal(crossed.status, "SUCCEEDED");
  assert.equal(crossed.http, 2);
  assert.equal(await midnight.get("midnight", before), 1);
  assert.equal(await midnight.get("midnight", after), 1);
  for (const date of [before, after]) assert.ok((await admin.ttl(quotaKey("midnight", date))) > 0);
  console.log(
    `PASS KST 23:59:59 -> 00:00:00: ${quotaKey("midnight", before)}=1 ${quotaKey("midnight", after)}=1, HTTP=2`,
  );

  const contenders = await Promise.all(Array.from({ length: 32 }, () => connect()));
  const parallel = await Promise.all(
    contenders.map((client) =>
      createRedisQuotaStore(client, { dailyLimit: 10 }).reserve("parallel-32", at),
    ),
  );
  assert.equal(parallel.filter(Boolean).length, 10);
  assert.equal(parallel.filter((reserved) => !reserved).length, 22);
  assert.equal(await store.get("parallel-32", at), 10);
  console.log(
    "PASS B 32 simultaneous independent clients: successes=10 denied=22 counter=10 overshoots=0",
  );
  let overshoots = 0;
  for (let round = 0; round < 20; round++) {
    const serviceId = `race-${round}`;
    await admin.set(quotaKey(serviceId, at), "9");
    const results = await Promise.all(
      contenders.map((client) =>
        createRedisQuotaStore(client, { dailyLimit: 10 }).reserve(serviceId, at),
      ),
    );
    const winners = results.filter(Boolean).length;
    if (winners !== 1 || (await store.get(serviceId, at)) !== 10) overshoots++;
  }
  assert.equal(overshoots, 0);
  console.log("PASS last-slot race: 32 independent clients x 20 rounds, overshoots=0");
  const runs = await Promise.all(
    contenders.map((client, index) =>
      liveRun(
        createRedisQuotaStore(client, { dailyLimit: 1 }),
        "worker-race",
        `worker-race-${index}`,
        { dailyLimit: 1, trigger: index % 2 === 0 ? "MANUAL" : "SCHEDULED" },
      ),
    ),
  );
  assert.equal(
    runs.reduce((sum, run) => sum + run.http, 0),
    1,
  );
  assert.equal(runs.filter((run) => run.status === "SUCCEEDED").length, 1);
  assert.equal(runs.filter((run) => run.status === "FAILED").length, 31);
  console.log(
    "PASS 32 simultaneous manual/scheduled live job handlers: HTTP=1, SUCCEEDED=1 FAILED=31",
  );
  const retry = await liveRun(createRedisQuotaStore(admin, { dailyLimit: 1 }), "retry", "retry", {
    dailyLimit: 1,
    fetch: () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(retry.status, "FAILED");
  assert.equal(retry.http, 1);
  assert.equal(await single.get("retry", at), 1);
  assert.equal(retry.quotaUsed, 1);
  console.log("PASS 503 retry with final slot: HTTP=1 FAILED, second HTTP blocked");

  for (const dailyLimit of [4, 5]) {
    const serviceId = `verify-g2b-shared-${dailyLimit}`;
    const sharedStore = createRedisQuotaStore(admin, { dailyLimit });
    const operations = [];
    const shared = await liveRun(sharedStore, serviceId, serviceId, {
      source: "g2b",
      aux: true,
      dailyLimit,
      fetch: (calls, url) => {
        const operation = new URL(url).pathname.split("/").at(-1);
        operations.push(operation); // Keep only operation names; never log URL/query or credentials.
        if (calls === 2) return new Response("unavailable", { status: 503 });
        const items =
          operation === G2B_BID_NOTICE_LIST_OPERATION
            ? [
                {
                  bidNtceNo: "SHARED-QUOTA-TEST",
                  bidNtceOrd: "000",
                  bidNtceNm: "데이터 시스템 용역",
                  ntceKindNm: "등록공고",
                  dminsttNm: "시험기관",
                  infoBizYn: "Y",
                  bidNtceDt: "2026-10-22 09:00:00",
                  bidClseDt: "2026-10-23 18:00:00",
                  bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
                },
              ]
            : [];
        return Response.json({
          response: {
            header: { resultCode: "00" },
            body: { items, totalCount: items.length },
          },
        });
      },
    });
    assert.deepEqual(operations, [
      G2B_BID_NOTICE_LIST_OPERATION,
      G2B_AUX_OPERATIONS[0].operation,
      G2B_AUX_OPERATIONS[0].operation,
      G2B_AUX_OPERATIONS[1].operation,
      ...(dailyLimit === 5 ? [G2B_AUX_OPERATIONS[2].operation] : []),
    ]);
    assert.equal(shared.status, dailyLimit === 5 ? "SUCCEEDED" : "FAILED");
    assert.equal(shared.http, dailyLimit);
    assert.equal(shared.quotaUsed, dailyLimit);
    assert.equal(await sharedStore.get(serviceId, at), dailyLimit);
    const otherId = `verify-other-service-${dailyLimit}`;
    assert.equal(await single.get(otherId, at), 0);
    const other = await liveRun(single, otherId, otherId, { dailyLimit: 1 });
    assert.equal(other.status, "SUCCEEDED");
    assert.equal(other.http, 1);
    assert.equal(other.quotaUsed, 1);
    assert.equal(await single.get(otherId, at), 1);
    assert.equal(await sharedStore.get(serviceId, at), dailyLimit);
    console.log(
      `PASS F shared G2B list/3 auxiliaries/retry: limit=${dailyLimit} HTTP=${shared.http} quota_used=${shared.quotaUsed} counter=${dailyLimit}; other-service HTTP=1 counter=1 unaffected`,
    );
  }

  const failedFaults = [];
  for (const mode of ["disconnect", "response-loss", "timeout"]) {
    const proxy = await faultProxy(mode);
    const client = await connect({ port: proxy.port });
    const faultStore = createRedisQuotaStore(client, { dailyLimit: 10 });
    const start = performance.now();
    const result = await liveRun(faultStore, mode, mode);
    await Promise.race([
      proxy.injected,
      pause(3000).then(() => {
        throw new Error("fault was not injected");
      }),
    ]);
    const used = await store.get(mode, at);
    console.log(
      `FAULT ${mode}: ${JSON.stringify(result)} used=${used} elapsed=${Math.round(performance.now() - start)}ms`,
    );
    try {
      blocked(result);
      assert.equal(used, mode === "response-loss" ? 1 : 0);
    } catch {
      failedFaults.push(mode);
    }
    client.disconnect();
    await proxy.close();
  }

  // Test users are nopass and restricted to this throwaway Redis. Never prints or reads company ACLs.
  const minimal = [
    "on",
    "nopass",
    "~quota:*",
    "-@all",
    "+get",
    "+incr",
    "+expire",
    "+set",
    "+ping",
    "+info",
    "+client|setinfo",
  ];
  await admin.acl("SETUSER", "f08-no-eval", ...minimal);
  const denied = await connect({ username: "f08-no-eval" });
  await assert.rejects(denied.eval("return 1", 0), /NOPERM/);
  await assert.rejects(denied.evalsha("0".repeat(40), 0), /NOPERM/);
  const deniedStore = createRedisQuotaStore(denied, { dailyLimit: 10 });
  for (const source of ["g2b", "lh"]) {
    for (const trigger of ["MANUAL", "SCHEDULED"]) {
      const result = await liveRun(deniedStore, `acl-${source}`, `acl-${source}-${trigger}`, {
        source,
        trigger,
      });
      blocked(result);
      console.log(`PASS ACL no EVAL/EVALSHA: live ${source}/${trigger} ${JSON.stringify(result)}`);
    }
  }
  await admin.acl("SETUSER", "f08-minimal", ...minimal, "+eval");
  const allowed = await connect({ username: "f08-minimal" });
  const allowedStore = createRedisQuotaStore(allowed, { dailyLimit: 10 });
  assert.equal(await allowedStore.reserve("acl-minimal", at), true);
  await allowedStore.markExhausted("acl-minimal", at);
  assert.equal(await allowedStore.get("acl-minimal", at), 10);
  await assert.rejects(allowed.evalsha("0".repeat(40), 0), /NOPERM/);
  console.log(
    "PASS minimum quota ACL: GET EVAL INCR EXPIRE SET (+client handshake); EVALSHA not used by current store",
  );
  await admin.acl(
    "SETUSER",
    "f08-no-incr",
    ...minimal.filter((grant) => grant !== "+incr"),
    "+eval",
  );
  const noIncrement = await connect({ username: "f08-no-incr" });
  const failedEvalKey = quotaKey("eval-runtime-failure", at);
  assert.equal(await noIncrement.get(failedEvalKey), null);
  await assert.rejects(
    noIncrement.eval("return redis.call('INCR', KEYS[1])", 1, failedEvalKey),
    /ACL|NOPERM/i,
  );
  const evalFailure = await liveRun(
    createRedisQuotaStore(noIncrement, { dailyLimit: 10 }),
    "eval-runtime-failure",
    "eval-runtime-failure",
  );
  blocked(evalFailure);
  assert.equal(await store.get("eval-runtime-failure", at), 0);
  console.log(
    `PASS E actual Lua command failure (EVAL allowed, INCR denied): ${JSON.stringify(evalFailure)}`,
  );
  const auxClient = await connect();
  const auxReadFailure = await liveRun(
    createRedisQuotaStore(auxClient, { dailyLimit: 10 }),
    "aux-read",
    "aux-read",
    {
      source: "g2b",
      aux: true,
      fetch: () => {
        auxClient.disconnect(); // connection fails only after the successful, already charged list HTTP
        return Response.json({
          response: {
            header: { resultCode: "00" },
            body: {
              totalCount: 1,
              items: [
                {
                  bidNtceNo: "AUX-READ-FAIL",
                  bidNtceOrd: "000",
                  bidNtceNm: "데이터 시스템 용역",
                  ntceKindNm: "등록공고",
                  dminsttNm: "시험기관",
                  infoBizYn: "Y",
                  bidNtceDt: "2026-10-22 09:00:00",
                  bidClseDt: "2026-10-23 18:00:00",
                  bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
                },
              ],
            },
          },
        });
      },
    },
  );
  console.log(`AUX READ DISCONNECT: ${JSON.stringify(auxReadFailure)}`);
  assert.equal(auxReadFailure.status, "FAILED");
  assert.equal(auxReadFailure.http, 1);
  assert.ok(auxReadFailure.errors.includes("QUOTA_STORE_UNAVAILABLE"));
  console.log(
    "PASS Redis disconnect after list: list HTTP=1, auxiliary HTTP=0, FAILED with QUOTA_STORE_UNAVAILABLE",
  );
  assert.deepEqual(failedFaults, [], "Redis faults must fail closed without replaying EVAL");
  const stats = await admin.info("commandstats");
  const evalCalls = Number(stats.match(/^cmdstat_eval:calls=(\d+)/m)?.[1]);
  assert.ok(evalCalls > 0, "Redis itself must report actual EVAL executions");
  const incrbyCalls = Number(stats.match(/^cmdstat_incrby:calls=(\d+)/m)?.[1] ?? 0);
  assert.equal(incrbyCalls, 0, "Reservations must not be counted again with INCRBY");
  console.log(`PASS actual Redis INFO commandstats: EVAL calls=${evalCalls}; INCRBY calls=0`);

  // Remove only this harness's server from service, then fail an actual TCP connection to its port.
  docker("stop", "--time", "1", id);
  assert.equal(docker("inspect", "--format", "{{.State.Running}}", id), "false");
  const refused = new Redis({ ...QUOTA_REDIS_OPTIONS, host: "127.0.0.1", port, lazyConnect: true });
  clients.add(refused);
  let connectionErrorCode;
  let connectionClosed = false;
  let becameReady = false;
  refused.on("close", () => {
    connectionClosed = true;
  });
  refused.on("ready", () => {
    becameReady = true;
  });
  refused.on("error", (error) => {
    // IORedis connect() rejects with a generic close error; the socket error event retains its code.
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error.code))
      connectionErrorCode = error.code;
  });
  await assert.rejects(refused.connect());
  // Docker Desktop may accept TCP and close it when the stopped container has no Redis behind it.
  assert.equal(connectionClosed, true);
  assert.equal(becameReady, false);
  const connectionFailure = await liveRun(
    createRedisQuotaStore(refused, { dailyLimit: 1 }),
    "connection-failed",
    "connection-failed",
    { dailyLimit: 1 },
  );
  blocked(connectionFailure);
  console.log(
    `PASS E actual Redis connection failure (${connectionErrorCode ?? "closed-before-ready"}): ${JSON.stringify(connectionFailure)}`,
  );
  assert.equal(realHttpAttempts, 0);
  console.log(
    "PASS isolation: actual external HTTP attempts=0; Redis targets restricted to owned loopback ports",
  );
  console.log("ALL ISOLATED REDIS CHECKS PASSED; no external HTTP or operational services used");
} finally {
  for (const client of clients) client.disconnect();
  for (const proxy of [...proxies]) await proxy.close();
  if (containerCreated) docker("rm", "--force", id);
  if (networkCreated) docker("network", "rm", id);
  console.log("CLEANUP: disposable Redis container and its dedicated network removed");
}
