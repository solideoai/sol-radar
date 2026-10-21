import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { createDocumentStorage } from "@/worker/document-storage";

const bidId = "b1d00000-0000-0000-0000-000000000011";
const revisionId = "be500000-0000-0000-0000-000000000011";
const documentId = "d0c00000-0000-0000-0000-000000000011";
const bytes = new TextEncoder().encode("%PDF-1.7\n");
const settings = { rawBucket: "bid-documents", parsedBucket: "bid-parsed" };

function harness() {
  const objects = new Map<string, Uint8Array>();
  const commits: Record<string, unknown>[] = [];
  let rejectCommit = false;
  let deletes = 0;
  let loseResponse = false;
  let legacyPath = false;
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/rest/v1/rpc/")) {
      const { p } = await request.json();
      if (pathname.endsWith("claim_document_storage")) {
        const id = "0b1ec000-0000-0000-0000-000000000011";
        return Response.json({
          id,
          path: legacyPath ? String(p.path) : String(p.path).replace(/\/([^/]+)$/, `/${id}/$1`),
          status: legacyPath ? "STORED" : "UPLOADING",
        });
      }
      if (rejectCommit) return Response.json({ message: "db unavailable" }, { status: 503 });
      commits.push(p);
      return Response.json(null);
    }
    const key = decodeURIComponent(pathname.replace("/storage/v1/object/", ""));
    if (request.method === "POST") {
      if (objects.has(key))
        return Response.json(
          { statusCode: "409", error: "Duplicate", message: "already exists" },
          { status: 409 },
        );
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("connection lost after upload");
      }
      return Response.json({ Key: key });
    }
    if (request.method === "GET") {
      const body = objects.get(key);
      return body
        ? new Response(Buffer.from(body))
        : Response.json({ message: "not found" }, { status: 404 });
    }
    deletes += 1;
    return Response.json([]);
  };
  const client = createClient<Database>("http://storage.test", "worker-test-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    storage: createDocumentStorage(client, settings),
    objects,
    commits,
    failCommit: () => {
      rejectCommit = true;
    },
    loseResponse: () => {
      loseResponse = true;
    },
    useLegacyPath: () => {
      legacyPath = true;
    },
    deletes: () => deletes,
  };
}

describe("immutable document Storage (real Supabase SDK transport)", () => {
  it("reuses legacy bytes at the unchanged physical path returned by the upgraded ledger", async () => {
    const h = harness();
    h.useLegacyPath();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const path = `raw/bids/${bidId}/${revisionId}/${sha}.pdf`;
    h.objects.set(`${settings.rawBucket}/${path}`, bytes);
    const stored = await h.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId,
      revisionId,
      bytes,
    });
    expect(stored.path).toBe(path);
    expect(h.objects.size).toBe(1);
    expect(h.objects.get(`${settings.rawBucket}/${path}`)).toEqual(bytes);
  });
  it("uploads and verifies the physical incarnation returned by the ledger, not the logical deduplication path", async () => {
    const h = harness();
    const stored = await h.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId,
      revisionId,
      bytes,
    });
    expect(stored.path).toContain("/0b1ec000-0000-0000-0000-000000000011/");
    expect(h.objects.get(`${stored.bucket}/${stored.path}`)).toEqual(bytes);
  });
  it("recovers an upload response lost after the server stored the bytes", async () => {
    const h = harness();
    h.loseResponse();
    await h.storage.uploadImmutable({ kind: "raw", documentId, bidId, revisionId, bytes });
    expect(h.objects.size).toBe(1);
    expect(h.commits).toHaveLength(1);
  });
  it("preserves bytes and two logical references while reusing an immutable raw object", async () => {
    const h = harness();
    const first = await h.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId,
      revisionId,
      bytes,
    });
    const second = await h.storage.uploadImmutable({
      kind: "raw",
      documentId: "d0c00000-0000-0000-0000-000000000012",
      bidId,
      revisionId,
      bytes,
    });
    expect(second.path).toBe(first.path);
    expect(first.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(h.objects.get(`${first.bucket}/${first.path}`)).toEqual(bytes);
    expect(h.objects.size).toBe(1);
    expect(h.commits.map((row) => row.documentId)).toEqual([
      documentId,
      "d0c00000-0000-0000-0000-000000000012",
    ]);
  });

  it("does not attach an existing object whose real checksum differs", async () => {
    const h = harness();
    const first = await h.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId,
      revisionId,
      bytes,
    });
    h.objects.set(`${first.bucket}/${first.path}`, new TextEncoder().encode("corrupted"));
    await expect(
      h.storage.uploadImmutable({ kind: "raw", documentId, bidId, revisionId, bytes }),
    ).rejects.toThrow("storage_checksum_mismatch");
    expect(h.commits).toHaveLength(1);
  });

  it("retains uploaded bytes when DB finalization fails, so a later lease can recover", async () => {
    const h = harness();
    h.failCommit();
    await expect(
      h.storage.uploadImmutable({ kind: "raw", documentId, bidId, revisionId, bytes }),
    ).rejects.toThrow("storage_finalize_failed");
    expect(h.objects.size).toBe(1);
    expect(h.deletes()).toBe(0);
  });

  it("rejects empty/oversized bytes and unsafe path segments before uploading", async () => {
    const h = harness();
    for (const data of [new Uint8Array(), new Uint8Array(50 * 1024 * 1024 + 1)])
      await expect(
        h.storage.uploadImmutable({ kind: "raw", documentId, bidId, revisionId, bytes: data }),
      ).rejects.toThrow("storage_invalid_size");
    await expect(
      h.storage.uploadImmutable({ kind: "raw", documentId, bidId: "../other", revisionId, bytes }),
    ).rejects.toThrow();
    expect(h.objects.size).toBe(0);
  });

  it("supports the 50MiB boundary and records actual parsed JSON bytes with a versioned key", async () => {
    const h = harness();
    const large = new Uint8Array(50 * 1024 * 1024);
    large.set(bytes);
    const raw = await h.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId,
      revisionId,
      bytes: large,
    });
    expect(raw.sizeBytes).toBe(50 * 1024 * 1024);
    const parsedBytes = new TextEncoder().encode(JSON.stringify({ text: "요구사항", pages: [] }));
    const parsed = await h.storage.uploadImmutable({
      kind: "parsed",
      documentId,
      bidId,
      revisionId,
      bytes: parsedBytes,
      rawSha256: raw.sha256,
      parserId: "pdf/v1",
      parseStatus: "PARSED",
      pageCount: 1,
    });
    expect(parsed.bucket).toBe("bid-parsed");
    expect(parsed.path).toContain(`/${raw.sha256}/`);
    expect(h.objects.get(`${parsed.bucket}/${parsed.path}`)).toEqual(parsedBytes);
  });
});
