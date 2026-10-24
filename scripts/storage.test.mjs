import assert from "node:assert/strict";
import test from "node:test";
import { ensureProfilePhotoBucket, ensureStorageBuckets } from "./ops/ensure-storage-buckets.mjs";

test("bucket provisioning defaults to read-only and refuses public/foreign buckets", async () => {
  const storage = {
    listBuckets: async () => ({ data: [], error: null }),
    createBucket: async () => {
      throw new Error("dry-run must not create");
    },
  };
  assert.deepEqual(await ensureStorageBuckets({ storage }), [
    { name: "bid-documents", status: "missing" },
    { name: "bid-parsed", status: "missing" },
  ]);
  for (const bucket of [
    { name: "bid-documents", public: true },
    { name: "bid-documents", public: false },
  ]) {
    storage.listBuckets = async () => ({ data: [bucket], error: null });
    storage.from = () => ({ download: async () => ({ data: null, error: {} }) });
    await assert.rejects(
      ensureStorageBuckets({ storage }, { apply: true }),
      /storage_bucket_public|storage_bucket_owner/,
    );
  }
});

test("explicit provisioning creates only private, size-limited buckets and immutable owner sentinels", async () => {
  const created = new Map();
  const sentinels = new Map();
  const storage = {
    listBuckets: async () => ({
      data: [...created].map(([name, opts]) => ({
        name,
        public: opts.public,
        file_size_limit: opts.fileSizeLimit,
        allowed_mime_types: opts.allowedMimeTypes,
      })),
      error: null,
    }),
    createBucket: async (name, options) => {
      created.set(name, options);
      return { error: null };
    },
    from: (name) => ({
      upload: async (path, body, options) => {
        assert.equal(options.upsert, false);
        sentinels.set(name, new Blob([body]));
        return { error: null };
      },
      download: async () => ({ data: sentinels.get(name), error: null }),
    }),
  };
  assert.equal((await ensureStorageBuckets({ storage }, { apply: true })).length, 2);
  for (const options of created.values()) {
    assert.equal(options.public, false);
    assert.equal(options.fileSizeLimit, 50 * 1024 * 1024);
  }
  assert.deepEqual(
    (await ensureStorageBuckets({ storage })).map((row) => row.status),
    ["ready", "ready"],
  );
});

test("photo bucket is private, 2MB, image-only and refuses public or mismatched buckets", async () => {
  const PHOTO = {
    public: false,
    fileSizeLimit: 2_097_152,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  };
  const calls = [];
  const storage = {
    listBuckets: async () => ({ data: [], error: null }),
    createBucket: async (name, options) => {
      calls.push([name, options]);
      return { error: null };
    },
  };
  assert.deepEqual(await ensureProfilePhotoBucket({ storage }), {
    name: "profile-photos",
    status: "missing",
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(await ensureProfilePhotoBucket({ storage }, { apply: true }), {
    name: "profile-photos",
    status: "created",
  });
  assert.deepEqual(calls, [["profile-photos", PHOTO]]);
  const listed = (bucket) => async () => ({
    data: [
      {
        name: "profile-photos",
        public: false,
        file_size_limit: PHOTO.fileSizeLimit,
        allowed_mime_types: PHOTO.allowedMimeTypes,
        ...bucket,
      },
    ],
    error: null,
  });
  storage.listBuckets = listed({});
  assert.deepEqual(await ensureProfilePhotoBucket({ storage }, { apply: true }), {
    name: "profile-photos",
    status: "ready",
  });
  storage.listBuckets = listed({ public: true });
  await assert.rejects(ensureProfilePhotoBucket({ storage }), /storage_bucket_public/);
  storage.listBuckets = listed({ file_size_limit: 50 * 1024 * 1024 });
  await assert.rejects(ensureProfilePhotoBucket({ storage }), /storage_bucket_limits_mismatch/);
  storage.listBuckets = listed({ allowed_mime_types: ["image/jpeg", "image/gif"] });
  await assert.rejects(ensureProfilePhotoBucket({ storage }), /storage_bucket_limits_mismatch/);
});
