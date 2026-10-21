import "server-only";

export type StorageSettings = { rawBucket: string; parsedBucket: string };
export const STORAGE_MAX_BYTES = 50 * 1024 * 1024;
export const STORAGE_SENTINEL = "_sol-radar/storage-owner.json";
export const STORAGE_OWNER = "sol-radar/document-storage/v1";

export function readStorageSettings(
  env: Record<string, string | undefined> = process.env,
): StorageSettings {
  const rawBucket = env.SUPABASE_STORAGE_RAW_BUCKET?.trim() || "bid-documents";
  const parsedBucket = env.SUPABASE_STORAGE_PARSED_BUCKET?.trim() || "bid-parsed";
  if (
    ![rawBucket, parsedBucket].every((value) => /^[a-z][a-z0-9-]{2,62}$/.test(value)) ||
    rawBucket === parsedBucket
  )
    throw new Error("Supabase Storage bucket 설정 오류");
  return { rawBucket, parsedBucket };
}

export type DownloadDocument = {
  id: string;
  bidId: string;
  bucket: string | null;
  path: string | null;
  name: string;
  downloadStatus: string;
};
export type DownloadRepo = {
  find(bidId: string, documentId: string): Promise<DownloadDocument | null>;
  sign(bucket: string, path: string, name: string, expiresIn: number): Promise<string>;
};
