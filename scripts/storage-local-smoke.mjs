// Isolated real Storage HTTP smoke. No cloud target and no application DB changes.
// node scripts/storage-local-smoke.mjs (Supabase CLI's local stack must be running)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { ensureStorageBuckets, storageRoundTrip } from "./ops/ensure-storage-buckets.mjs";

const status = spawnSync("supabase", ["status", "--output", "env"], { encoding: "utf8" });
assert.equal(status.status, 0, "local Supabase must be running");
const values = parseEnv(status.stdout);
const target = new URL(values.API_URL);
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "cloud smoke is forbidden here");
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }) },
};
const admin = createClient(values.API_URL, values.SERVICE_ROLE_KEY, options);
const anon = createClient(values.API_URL, values.ANON_KEY, options);
const suffix = crypto.randomUUID();
const settings = {
  rawBucket: `sol-storage-raw-${suffix}`,
  parsedBucket: `sol-storage-parsed-${suffix}`,
};
const names = Object.values(settings);
const existing = await admin.storage.listBuckets();
assert.equal(existing.error, null);
assert.ok(names.every((name) => !existing.data.some((bucket) => bucket.name === name)));
try {
  const provisioned = await ensureStorageBuckets(admin, { ...settings, apply: true });
  assert.ok(provisioned.every((bucket) => bucket.status === "created"));
  assert.ok(
    (await ensureStorageBuckets(admin, settings)).every((bucket) => bucket.status === "ready"),
  );
  for (const bucket of names) {
    await storageRoundTrip(admin, bucket, { bytes: new Uint8Array(50 * 1024 * 1024).fill(32) });
    const denied = await anon.storage.from(bucket).download("_sol-radar/storage-owner.json");
    assert.ok(denied.error, "anonymous private reads must fail");
    const signed = await admin.storage
      .from(bucket)
      .createSignedUrl("_sol-radar/storage-owner.json", 1);
    assert.equal(signed.error, null);
    assert.equal((await fetch(signed.data.signedUrl, { cache: "no-store" })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    assert.equal((await fetch(signed.data.signedUrl, { cache: "no-store" })).ok, false);
  }
  console.log(
    "local Storage HTTP: private raw/parsed, 50MiB round trip, anonymous denial, signed URL expiry: PASS",
  );
} finally {
  // These UUID buckets were absent before this smoke. Application buckets/objects are untouched.
  for (const name of names) {
    const bucket = await admin.storage.getBucket(name);
    if (bucket.error) continue;
    const emptied = await admin.storage.emptyBucket(name);
    assert.equal(emptied.error, null, "own temporary bucket cleanup failed");
    const deleted = await admin.storage.deleteBucket(name);
    assert.equal(deleted.error, null, "own temporary bucket deletion failed");
  }
}
