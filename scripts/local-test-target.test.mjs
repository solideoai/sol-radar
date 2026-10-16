import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readLocalStatus } from "./local-test-target.mjs";
const target = {
  SOL_RADAR_TEST_SUPABASE_WORKDIR: "/tmp/isolated/project",
  SOL_RADAR_TEST_SUPABASE_API_URL: "http://127.0.0.1:65421",
};
const output =
  'API_URL="http://127.0.0.1:65421"\nANON_KEY="public-test"\nSERVICE_ROLE_KEY="private-sentinel"';
test("explicit target uses exact workdir and matching origin", () => {
  const status = readLocalStatus({
    env: target,
    run: (command, args, options) => {
      assert.equal(command, "supabase");
      assert.equal(options.cwd, fileURLToPath(new URL("../", import.meta.url)));
      assert.deepEqual(args, [
        "status",
        "-o",
        "env",
        "--workdir",
        target.SOL_RADAR_TEST_SUPABASE_WORKDIR,
      ]);
      return { status: 0, stdout: output };
    },
  });
  assert.equal(status.API_URL, target.SOL_RADAR_TEST_SUPABASE_API_URL);
});
test("ordinary local command unchanged", () => {
  readLocalStatus({
    env: {},
    run: (command, args, options) => {
      assert.equal(command, "supabase");
      assert.equal(options.cwd, fileURLToPath(new URL("../", import.meta.url)));
      assert.deepEqual(args, ["status", "-o", "env"]);
      return { status: 0, stdout: output };
    },
  });
});
for (const env of [
  { SOL_RADAR_TEST_SUPABASE_WORKDIR: target.SOL_RADAR_TEST_SUPABASE_WORKDIR },
  { SOL_RADAR_TEST_SUPABASE_API_URL: target.SOL_RADAR_TEST_SUPABASE_API_URL },
  { ...target, SOL_RADAR_TEST_SUPABASE_WORKDIR: "relative" },
  { ...target, SOL_RADAR_TEST_SUPABASE_WORKDIR: "/tmp/one/../two" },
  { ...target, SOL_RADAR_TEST_SUPABASE_API_URL: "https://remote.test" },
  { ...target, SOL_RADAR_TEST_SUPABASE_API_URL: "http://secret@127.0.0.1:65421" },
  { ...target, SOL_RADAR_TEST_SUPABASE_API_URL: "http://127.0.0.1:65421/path" },
  { ...target, SOL_RADAR_TEST_SUPABASE_API_URL: "" },
])
  test("invalid isolated context fails before CLI", () => {
    let calls = 0;
    assert.throws(
      () =>
        readLocalStatus({
          env,
          run: () => {
            calls++;
          },
        }),
      /격리/,
    );
    assert.equal(calls, 0);
  });
test("wrong returned origin refuses without fallback or secret leak", () => {
  let calls = 0;
  assert.throws(
    () =>
      readLocalStatus({
        env: target,
        run: () => {
          calls++;
          return { status: 0, stdout: output.replace("65421", "54321") };
        },
      }),
    /일치/,
  );
  assert.equal(calls, 1);
});
for (const run of [
  () => {
    throw Object.assign(new Error("private-sentinel", { cause: new Error("private-sentinel") }), {
      stdout: output,
      stderr: output,
    });
  },
  () => ({ status: 1, stdout: output, stderr: output }),
  () => ({ status: 0, error: new Error("private-sentinel"), stdout: output }),
  () => ({ status: 0, stdout: { key: "private-sentinel" } }),
  () => ({ status: 0, stdout: 'API_URL="private-sentinel"' }),
])
  test("CLI errors never expose raw message stdout stderr or cause", () => {
    assert.throws(
      () => readLocalStatus({ env: target, run }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(JSON.stringify(error) + error.stack, /private-sentinel/);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });

// Exercise both real CLI entry functions with only the process/network boundary replaced.
for (const [name, entry] of [
  ["root db-seed", (await import("./db-seed.mjs")).seedSelectedLocal],
  ["people seed", (await import("./people/seed.mjs")).seedSelectedPeople],
]) {
  test(`${name}: selected project validated before any seed writes`, async () => {
    let writes = 0;
    await entry({
      env: target,
      run: (_, args) => {
        assert.deepEqual(args.slice(-2), ["--workdir", target.SOL_RADAR_TEST_SUPABASE_WORKDIR]);
        return { status: 0, stdout: output };
      },
      write: async ({ apiUrl }) => {
        writes++;
        assert.equal(apiUrl, target.SOL_RADAR_TEST_SUPABASE_API_URL);
      },
    });
    assert.equal(writes, 1);
    for (const env of [{ SOL_RADAR_TEST_SUPABASE_WORKDIR: "/tmp/isolated/project" }, target]) {
      await assert.rejects(
        entry({
          env,
          run: () => ({ status: 0, stdout: output.replace("65421", "54321") }),
          write: async () => {
            writes++;
          },
        }),
      );
    }
    assert.equal(writes, 1);
  });
}
