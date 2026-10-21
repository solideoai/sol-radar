#!/usr/bin/env node
// Default: read-only inventory. --apply explicitly provisions missing private buckets.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "sol-radar/document-storage/v1";
const SENTINEL = "_sol-radar/storage-owner.json";
const LIMIT = 50 * 1024 * 1024;
const RAW_MIME = [
  "application/pdf",
  "application/x-hwp",
  "application/hwp+zip",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/json",
];

export async function ensureStorageBuckets(
  client,
  { apply = false, rawBucket = "bid-documents", parsedBucket = "bid-parsed" } = {},
) {
  if (
    rawBucket === parsedBucket ||
    ![rawBucket, parsedBucket].every((name) => /^[a-z][a-z0-9-]{2,62}$/.test(name))
  )
    throw new Error("storage_bucket_names_invalid");
  const listed = await client.storage.listBuckets();
  if (listed.error) throw new Error("storage_bucket_inventory_failed");
  const result = [];
  for (const [kind, name] of [
    ["raw", rawBucket],
    ["parsed", parsedBucket],
  ]) {
    const existing = listed.data.find((bucket) => bucket.name === name);
    const mime = kind === "raw" ? RAW_MIME : ["application/json"];
    const api = client.storage.from?.(name);
    if (existing) {
      if (existing.public) throw new Error("storage_bucket_public");
      const sentinel = await api.download(SENTINEL);
      if (sentinel.error || !sentinel.data) throw new Error("storage_bucket_owner_unknown");
      const owner = JSON.parse(await sentinel.data.text());
      if (owner.owner !== OWNER || owner.bucket !== name || owner.kind !== kind)
        throw new Error("storage_bucket_owner_mismatch");
      if (
        Number(existing.file_size_limit) !== LIMIT ||
        !Array.isArray(existing.allowed_mime_types) ||
        mime.some((value) => !existing.allowed_mime_types.includes(value)) ||
        existing.allowed_mime_types.some((value) => !mime.includes(value))
      )
        throw new Error("storage_bucket_limits_mismatch");
      result.push({ name, status: "ready" });
      continue;
    }
    if (!apply) {
      result.push({ name, status: "missing" });
      continue;
    }
    const created = await client.storage.createBucket(name, {
      public: false,
      fileSizeLimit: LIMIT,
      allowedMimeTypes: mime,
    });
    if (created.error) throw new Error("storage_bucket_create_failed");
    const marker = new TextEncoder().encode(JSON.stringify({ owner: OWNER, bucket: name, kind }));
    const uploaded = await api.upload(SENTINEL, marker, {
      contentType: "application/json",
      upsert: false,
    });
    if (uploaded.error) throw new Error("storage_bucket_owner_write_failed");
    result.push({ name, status: "created" });
  }
  return result;
}

export async function storageRoundTrip(
  client,
  bucket,
  { bytes = new TextEncoder().encode('{"sol-radar":"storage-smoke"}') } = {},
) {
  const key = `_sol-radar/smoke/${crypto.randomUUID()}.json`;
  const api = client.storage.from(bucket);
  const uploaded = await api.upload(key, bytes, { upsert: false, contentType: "application/json" });
  if (uploaded.error) throw new Error("storage_smoke_upload_failed");
  try {
    const result = await api.download(key);
    if (result.error || !result.data) throw new Error("storage_smoke_download_failed");
    const actual = new Uint8Array(await result.data.arrayBuffer());
    if (actual.length !== bytes.length || actual.some((value, index) => value !== bytes[index]))
      throw new Error("storage_smoke_bytes_mismatch");
  } finally {
    const deleted = await api.remove([key]);
    if (deleted.error) throw new Error("storage_smoke_cleanup_failed");
  }
}

async function run() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--smoke", "--large", "--inventory"].includes(arg)))
    throw new Error("storage_unknown_argument");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("storage_worker_credentials_required");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
  )
    throw new Error("storage_https_required");
  const require = createRequire(new URL("../../web/package.json", import.meta.url));
  const { createClient } = require("@supabase/supabase-js");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    },
  });
  const settings = {
    rawBucket: process.env.SUPABASE_STORAGE_RAW_BUCKET || "bid-documents",
    parsedBucket: process.env.SUPABASE_STORAGE_PARSED_BUCKET || "bid-parsed",
  };
  console.log(`storage target: ${parsed.host}; apply=${args.includes("--apply")}`);
  if (args.includes("--inventory")) {
    const list = await client.storage.listBuckets();
    if (list.error) throw new Error("storage_bucket_inventory_failed");
    console.log(
      JSON.stringify({
        buckets: list.data
          .filter((bucket) => Object.values(settings).includes(bucket.name))
          .map(({ name, public: isPublic, file_size_limit }) => ({
            name,
            public: isPublic,
            file_size_limit,
          })),
      }),
    );
    const docs = await client
      .from("bid_documents")
      .select("id", { count: "exact", head: true })
      .not("object_key", "is", null);
    if (docs.error) throw new Error("storage_document_inventory_failed");
    console.log(JSON.stringify({ documentReferences: docs.count }));
    return;
  }
  console.log(
    JSON.stringify(
      await ensureStorageBuckets(client, { ...settings, apply: args.includes("--apply") }),
    ),
  );
  if (args.includes("--smoke")) {
    if (!args.includes("--apply")) throw new Error("storage_smoke_requires_apply");
    const bytes = args.includes("--large") ? new Uint8Array(LIMIT).fill(32) : undefined;
    for (const bucket of Object.values(settings))
      await storageRoundTrip(client, bucket, bytes ? { bytes } : {});
    console.log(`storage round trip: ok (${bytes?.length ?? "small"} bytes)`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(
      /^storage_[a-z_]+$/.test(error?.message ?? "") ? error.message : "storage_operation_failed",
    );
    process.exitCode = 1;
  });
}
