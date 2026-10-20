// ops/close-stale-ingest-runs.mjs 명령 시험. 네트워크는 가짜 fetch 로만 본다 — 어떤 Supabase 에도 요청하지 않는다.
// 실제 프로세스로 띄우는 시험은 요청 전에 끝나는 경우(인자·env 오류)만 다룬다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, run } from "./close-stale-ingest-runs.mjs";

const CLI = fileURLToPath(new URL("./close-stale-ingest-runs.mjs", import.meta.url));
const NOW = new Date("2026-10-20T12:00:00.000Z");
const TEST_KEY = "ops-test-admin-key-not-real";
const API_URL = "http://127.0.0.1:59999";
const ENV_TEXT = `NEXT_PUBLIC_SUPABASE_URL=${API_URL}\nSUPABASE_SERVICE_ROLE_KEY=${TEST_KEY}\n`;

// 서버가 source=g2b·status=RUNNING 으로 걸러 준 행. fresh 는 10분 전이라 대상이 아니다.
const RUNNING_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    source: "g2b",
    status: "RUNNING",
    started_at: "2026-10-20T10:00:00+00:00",
    run_mode: "LIVE",
    trigger: "SCHEDULED",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    source: "g2b",
    status: "RUNNING",
    started_at: "2026-10-20T11:15:00+00:00",
    run_mode: "LIVE",
    trigger: "MANUAL",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    source: "g2b",
    status: "RUNNING",
    started_at: "2026-10-20T11:50:00+00:00",
    run_mode: "LIVE",
    trigger: "MANUAL",
  },
];
const [OLD, MID, FRESH] = RUNNING_ROWS.map((row) => row.id);

const fakeFetch = (handler) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url: new URL(url), method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const response = handler(call) ?? { status: 200, body: "" };
    return {
      ok: response.status < 400,
      status: response.status,
      text: async () => response.body ?? "",
    };
  };
  return { calls, fetchImpl };
};

// GET 은 RUNNING 행을, PATCH 는 바뀐 행 하나를 돌려준다(return=representation).
const supabaseLike = (call) => {
  if (call.method === "GET") return { status: 200, body: JSON.stringify(RUNNING_ROWS) };
  if (call.method === "PATCH") {
    const id = call.url.searchParams.get("id").replace(/^eq\./, "");
    return { status: 200, body: JSON.stringify([{ id }]) };
  }
  return { status: 405, body: "{}" };
};

const runCli = async (argv, { handler = supabaseLike, envText = ENV_TEXT } = {}) => {
  const { calls, fetchImpl } = fakeFetch(handler);
  const out = [];
  const err = [];
  const reads = [];
  const code = await run(argv, {
    now: () => NOW,
    fetchImpl,
    readText: async (file) => {
      reads.push(file);
      if (envText === null)
        throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      return envText;
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, calls, out, err, reads, all: [...out, ...err].join("\n") };
};

const patchesOf = (calls) => calls.filter((call) => call.method === "PATCH");

describe("parseArgs", () => {
  it("기본값은 dry-run·30분이고 --env-file 은 경로를 그대로 받는다", () => {
    assert.deepEqual(parseArgs(["--env-file", "infra/env/x.env"]), {
      envFile: "infra/env/x.env",
      olderThanMinutes: 30,
      apply: false,
    });
  });

  it("--apply·--older-than-minutes 를 받고 pnpm 의 -- 는 건너뛴다", () => {
    assert.deepEqual(
      parseArgs(["--", "--apply", "--older-than-minutes", "45", "--env-file", "a.env"]),
      { envFile: "a.env", olderThanMinutes: 45, apply: true },
    );
  });

  it("--env-file 이 없으면 거부한다(기본값 없음)", () => {
    assert.throws(() => parseArgs([]), /--env-file/);
    assert.throws(() => parseArgs(["--apply"]), /--env-file/);
    assert.throws(() => parseArgs(["--env-file"]), /--env-file/);
    assert.throws(() => parseArgs(["--env-file", "--apply"]), /--env-file/);
  });

  it("30분 미만이나 정수가 아닌 기준은 거부한다", () => {
    for (const value of ["29", "0", "-30", "30.5", "abc", ""])
      assert.throws(
        () => parseArgs(["--env-file", "a.env", "--older-than-minutes", value]),
        /--older-than-minutes/,
      );
    assert.throws(
      () => parseArgs(["--env-file", "a.env", "--older-than-minutes"]),
      /--older-than-minutes/,
    );
  });

  it("모르는 인자는 거부한다", () => {
    assert.throws(() => parseArgs(["--env-file", "a.env", "--force"]), /모르는 인자/);
    assert.throws(() => parseArgs(["--env-file", "a.env", "extra"]), /모르는 인자/);
  });
});

describe("close-stale-ingest-runs — dry-run", () => {
  it("g2b·RUNNING 만 조회하고 PATCH 는 한 번도 보내지 않는다", async () => {
    const result = await runCli(["--env-file", "isolated.env"]);
    assert.equal(result.code, 0);
    assert.equal(result.calls.length, 1);
    assert.equal(patchesOf(result.calls).length, 0);
    const [get] = result.calls;
    assert.equal(get.method, "GET");
    assert.equal(get.url.origin, API_URL);
    assert.equal(get.url.pathname, "/rest/v1/ingest_runs");
    assert.deepEqual(get.url.searchParams.getAll("source"), ["eq.g2b"]);
    assert.deepEqual(get.url.searchParams.getAll("status"), ["eq.RUNNING"]);
    for (const column of ["id", "started_at", "run_mode", "trigger"])
      assert.ok(get.url.searchParams.get("select").split(",").includes(column), column);
  });

  it("대상 목록에 id·started_at·경과 분을 적고, 마지막 줄에 집계를 적는다", async () => {
    const result = await runCli(["--env-file", "isolated.env"]);
    const listing = result.out.join("\n");
    assert.match(listing, new RegExp(`${OLD}.*2026-10-20T10:00:00\\+00:00.*120분`));
    assert.match(listing, new RegExp(`${MID}.*45분`));
    assert.ok(!listing.includes(FRESH), "30분이 안 된 run 은 목록에 없다");
    assert.equal(result.out.at(-1), "stale-runs: found=2 closed=0 apply=false");
  });

  it("--env-file 경로를 그대로 읽는다", async () => {
    const result = await runCli(["--env-file", "infra/env/isolated.env"]);
    assert.deepEqual(result.reads, [path.resolve("infra/env/isolated.env")]);
  });

  it("대상이 없으면 found=0 이다", async () => {
    const result = await runCli(["--env-file", "a.env", "--older-than-minutes", "180"]);
    assert.equal(result.code, 0);
    assert.equal(result.out.at(-1), "stale-runs: found=0 closed=0 apply=false");
  });
});

describe("close-stale-ingest-runs — --apply", () => {
  it("대상 행마다 id 와 status=RUNNING 조건으로 PATCH 해 FAILED·finished_at 을 쓴다", async () => {
    const result = await runCli(["--env-file", "a.env", "--apply"]);
    assert.equal(result.code, 0);
    const patches = patchesOf(result.calls);
    assert.deepEqual(
      patches.map((call) => call.url.searchParams.getAll("id")),
      [[`eq.${OLD}`], [`eq.${MID}`]],
    );
    for (const call of patches) {
      assert.equal(call.url.pathname, "/rest/v1/ingest_runs");
      assert.deepEqual(call.url.searchParams.getAll("status"), ["eq.RUNNING"]);
      assert.deepEqual(JSON.parse(call.body), {
        status: "FAILED",
        finished_at: NOW.toISOString(),
      });
      assert.match(call.headers.Prefer, /return=representation/);
    }
    assert.equal(result.out.at(-1), "stale-runs: found=2 closed=2 apply=true");
  });

  it("--older-than-minutes 로 기준을 바꾸면 그보다 오래된 run 만 닫는다", async () => {
    const result = await runCli(["--env-file", "a.env", "--apply", "--older-than-minutes", "60"]);
    assert.deepEqual(
      patchesOf(result.calls).map((call) => call.url.searchParams.get("id")),
      [`eq.${OLD}`],
    );
    assert.equal(result.out.at(-1), "stale-runs: found=1 closed=1 apply=true");
  });

  it("그 사이 끝난 run(PATCH 가 0행)은 닫은 것으로 세지 않는다", async () => {
    const result = await runCli(["--env-file", "a.env", "--apply"], {
      handler: (call) =>
        call.method === "PATCH" && call.url.searchParams.get("id") === `eq.${MID}`
          ? { status: 200, body: "[]" }
          : supabaseLike(call),
    });
    assert.equal(result.code, 0);
    assert.match(result.out.join("\n"), new RegExp(`${MID}.*건너뜀`));
    assert.equal(result.out.at(-1), "stale-runs: found=2 closed=1 apply=true");
  });
});

describe("close-stale-ingest-runs — 오류와 비밀값", () => {
  it("--env-file 이 없으면 아무것도 읽거나 요청하지 않고 exit 1 이다", async () => {
    const result = await runCli([]);
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    assert.equal(result.reads.length, 0);
    assert.match(result.err.join("\n"), /--env-file/);
  });

  it("env 파일이 없으면 exit 1 이다(다른 파일로 대신하지 않는다)", async () => {
    const result = await runCli(["--env-file", "missing.env"], { envText: null });
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    assert.match(result.err.join("\n"), /env 파일/);
  });

  it("키가 빠졌거나 URL 이 http(s) 가 아니면 요청 전에 exit 1 이다", async () => {
    const cases = [
      `NEXT_PUBLIC_SUPABASE_URL=${API_URL}\n`,
      `SUPABASE_SERVICE_ROLE_KEY=${TEST_KEY}\n`,
      `NEXT_PUBLIC_SUPABASE_URL=ftp://example.invalid\nSUPABASE_SERVICE_ROLE_KEY=${TEST_KEY}\n`,
      `NEXT_PUBLIC_SUPABASE_URL=not a url\nSUPABASE_SERVICE_ROLE_KEY=${TEST_KEY}\n`,
    ];
    for (const envText of cases) {
      const result = await runCli(["--env-file", "a.env"], { envText });
      assert.equal(result.code, 1, envText);
      assert.equal(result.calls.length, 0, envText);
      assert.ok(!result.all.includes(TEST_KEY), "키 값이 출력되면 안 된다");
    }
  });

  it("대상 호스트는 출력하고 키 값은 stdout·stderr·URL 어디에도 싣지 않는다", async () => {
    const result = await runCli(["--env-file", "a.env", "--apply"]);
    assert.match(result.out.join("\n"), /127\.0\.0\.1:59999/);
    assert.ok(!result.all.includes(TEST_KEY));
    for (const call of result.calls) {
      assert.ok(!call.url.href.includes(TEST_KEY));
      assert.equal(call.headers.apikey, TEST_KEY);
    }
  });

  it("서버 오류 사유가 키를 되돌려도 가리고 exit 1 이다", async () => {
    const result = await runCli(["--env-file", "a.env"], {
      handler: () => ({
        status: 500,
        body: JSON.stringify({ code: "XX000", message: `bad apikey ${TEST_KEY}` }),
      }),
    });
    assert.equal(result.code, 1);
    assert.match(result.err.join("\n"), /500/);
    assert.ok(!result.all.includes(TEST_KEY));
  });

  it("--apply 도중 PATCH 가 실패하면 exit 1 이고 남은 행은 건드리지 않는다", async () => {
    const result = await runCli(["--env-file", "a.env", "--apply"], {
      handler: (call) =>
        call.method === "PATCH" ? { status: 503, body: "{}" } : supabaseLike(call),
    });
    assert.equal(result.code, 1);
    assert.equal(patchesOf(result.calls).length, 1);
    assert.ok(!result.all.includes(TEST_KEY));
  });
});

describe("close-stale-ingest-runs — 프로세스", () => {
  const dirs = [];
  after(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // pnpm ops:close-stale-runs -- … 처럼 "--" 를 앞에 둔다. 그래야 Node 가 --env-file 을 자기 옵션으로 보지 않는다.
  const spawnCli = (args) =>
    spawnSync(process.execPath, [CLI, "--", ...args], { encoding: "utf8" });

  it("--env-file 없이 띄우면 exit 1 이다", () => {
    const result = spawnCli([]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--env-file/);
  });

  it("env 파일 오류로 끝나도 키 값을 출력하지 않는다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stale-runs-"));
    dirs.push(dir);
    const envFile = path.join(dir, "bad.env");
    await writeFile(
      envFile,
      `NEXT_PUBLIC_SUPABASE_URL=ftp://example.invalid\nSUPABASE_SERVICE_ROLE_KEY=${TEST_KEY}\n`,
    );
    const result = spawnCli(["--env-file", envFile, "--apply"]);
    assert.equal(result.status, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(TEST_KEY));
  });

  it("없는 env 파일이면 exit 1 이다", () => {
    const result = spawnCli(["--env-file", path.join(tmpdir(), "stale-runs-missing", "x.env")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /env 파일/);
  });

  it('"--" 없이 불러도 없는 env 파일이면 0 이 아닌 코드로 끝난다', () => {
    // Node 24 는 "--" 앞의 --env-file 을 스스로 확인해 파일이 없으면 스크립트 전에 exit 9 로 끝낸다(값은 읽지 않는다).
    const missing = path.join(tmpdir(), "stale-runs-missing", "x.env");
    const result = spawnSync(process.execPath, [CLI, "--env-file", missing], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /stale-runs: found=/);
  });
});
