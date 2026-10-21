import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { STORAGE_MAX_BYTES, type StorageSettings } from "@/server/documents";
import {
  attachmentObjectKey,
  detectDocumentFormat,
  DOCUMENT_FORMAT_MIME,
} from "@/server/ingestion";

type UploadBase = { documentId: string; bidId: string; revisionId: string; bytes: Uint8Array };
type UploadInput = UploadBase &
  (
    | { kind: "raw" }
    | {
        kind: "parsed";
        rawSha256: string;
        parserId: string;
        parseStatus: "PARSED" | "PARTIAL";
        pageCount: number;
        parseQuality?: Json;
      }
  );
export type StoredObject = {
  id: string;
  bucket: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
};
const claimSchema = z.object({
  id: z.guid(),
  path: z.string().min(1),
  status: z.enum(["UPLOADING", "STORED", "ERROR"]),
});
const deleteSchema = z.object({ id: z.guid(), bucket: z.string(), path: z.string() });
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function describeUpload(input: UploadInput, settings: StorageSettings) {
  if (!input.bytes.byteLength || input.bytes.byteLength > STORAGE_MAX_BYTES)
    throw new Error("storage_invalid_size");
  for (const value of [input.documentId, input.bidId, input.revisionId])
    if (!z.guid().safeParse(value).success) throw new Error("storage_invalid_id");
  const sha256 = checksum(input.bytes);
  const format = detectDocumentFormat(input.bytes);
  if (input.kind === "raw")
    return {
      bucket: settings.rawBucket,
      path: attachmentObjectKey({ ...input, sha256, format }),
      sha256,
      sizeBytes: input.bytes.byteLength,
      mimeType: DOCUMENT_FORMAT_MIME[format],
      format,
    };
  if (
    !/^[a-f0-9]{64}$/.test(input.rawSha256) ||
    !input.parserId.trim() ||
    !Number.isInteger(input.pageCount) ||
    input.pageCount < 0
  )
    throw new Error("storage_invalid_parse");
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes));
  const version = createHash("sha256").update(input.parserId).digest("hex");
  return {
    bucket: settings.parsedBucket,
    path: `parsed/bids/${input.bidId}/${input.revisionId}/${input.rawSha256}/${version}/result.json`,
    sha256,
    sizeBytes: input.bytes.byteLength,
    mimeType: "application/json",
    format,
  };
}

function isDuplicate(error: { statusCode?: string | number; message: string }): boolean {
  return (
    String(error.statusCode) === "409" ||
    (String(error.statusCode) === "400" && /already exists|duplicate/i.test(error.message))
  );
}

export function createDocumentStorage(client: SupabaseClient<Database>, settings: StorageSettings) {
  async function uploadImmutable(input: UploadInput): Promise<StoredObject> {
    const logicalObject = describeUpload(input, settings);
    const leaseToken = randomUUID();
    const { data, error } = await client.rpc("claim_document_storage", {
      p: { ...logicalObject, leaseToken },
    });
    const claimed = claimSchema.safeParse(data);
    if (error || !claimed.success) throw new Error("storage_claim_failed");
    const expectedPath = logicalObject.path.replace(/\/([^/]+)$/, `/${claimed.data.id}/$1`);
    if (claimed.data.path !== expectedPath) throw new Error("storage_claim_path_mismatch");
    const object = { ...logicalObject, path: claimed.data.path };
    const bucket = client.storage.from(object.bucket);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const uploaded = await bucket.upload(object.path, input.bytes, {
        contentType: object.mimeType,
        upsert: false,
        cacheControl: "0",
      });
      if (!uploaded.error || isDuplicate(uploaded.error)) break;
      const status = Number(uploaded.error.statusCode ?? uploaded.error.status ?? 0);
      if ((status > 0 && status < 500 && status !== 429) || attempt === 2)
        throw new Error("storage_upload_failed");
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
    // A collision or a lost upload response is never accepted from metadata alone.
    const downloaded = await bucket.download(
      object.path,
      {},
      { signal: AbortSignal.timeout(60_000) },
    );
    if (downloaded.error || !downloaded.data) throw new Error("storage_verify_failed");
    const verified = new Uint8Array(await downloaded.data.arrayBuffer());
    if (verified.byteLength !== object.sizeBytes || checksum(verified) !== object.sha256)
      throw new Error("storage_checksum_mismatch");
    const finalized = await client.rpc("finish_document_storage", {
      p: {
        objectId: claimed.data.id,
        leaseToken,
        documentId: input.documentId,
        kind: input.kind,
        ...(input.kind === "raw"
          ? { format: object.format }
          : {
              parserId: input.parserId,
              parseStatus: input.parseStatus,
              pageCount: input.pageCount,
              parseQuality: input.parseQuality ?? null,
            }),
      },
    });
    // Retain the uploaded object and its intent after any DB error. Never delete in this catch path.
    if (finalized.error) throw new Error("storage_finalize_failed");
    return {
      id: claimed.data.id,
      bucket: object.bucket,
      path: object.path,
      sha256: object.sha256,
      sizeBytes: object.sizeBytes,
      mimeType: object.mimeType,
    };
  }

  async function reconcile(): Promise<number> {
    const candidates = await client.rpc("document_storage_candidates", { p_limit: 100 });
    if (candidates.error) throw new Error("storage_reconcile_failed");
    let removed = 0;
    for (const candidate of candidates.data) {
      // Only SOL buckets and generated document paths can reach object deletion.
      if (
        ![settings.rawBucket, settings.parsedBucket].includes(candidate.bucket) ||
        !/^(raw|parsed)\/bids\//.test(candidate.path)
      )
        continue;
      const token = randomUUID();
      const claim = await client.rpc("claim_document_storage_delete", {
        p_id: candidate.id,
        p_token: token,
      });
      if (claim.error) throw new Error("storage_delete_claim_failed");
      if (claim.data === null) continue;
      const object = deleteSchema.parse(claim.data);
      if (object.bucket !== candidate.bucket || object.path !== candidate.path)
        throw new Error("storage_delete_mismatch");
      const deleted = await client.storage.from(object.bucket).remove([object.path]);
      if (deleted.error) continue;
      const finished = await client.rpc("finish_document_storage_delete", {
        p_id: object.id,
        p_token: token,
      });
      if (finished.error) throw new Error("storage_delete_finalize_failed");
      removed += 1;
    }
    return removed;
  }
  return { uploadImmutable, reconcile };
}
