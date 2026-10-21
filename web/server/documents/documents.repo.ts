import "server-only";
import { getSupabase } from "@/server/supabase";
import type { DownloadRepo } from "./documents.model";

// Both metadata and signed URL use this request's JWT. No service role in the web runtime.
export const documentsRepo: DownloadRepo = {
  async find(bidId, documentId) {
    const { data, error } = await (
      await getSupabase()
    )
      .from("bid_documents")
      .select("id,bid_id,storage_bucket,object_key,name,download_status,raw_storage_id")
      .eq("id", documentId)
      .eq("bid_id", bidId)
      .maybeSingle();
    if (error) throw new Error("document_lookup_failed");
    return data && data.raw_storage_id
      ? {
          id: data.id,
          bidId: data.bid_id,
          bucket: data.storage_bucket,
          path: data.object_key,
          name: data.name,
          downloadStatus: data.download_status,
        }
      : null;
  },
  async sign(bucket, path, name, expiresIn) {
    const { data, error } = await (
      await getSupabase()
    ).storage
      .from(bucket)
      .createSignedUrl(path, expiresIn, { download: name });
    if (error || !data?.signedUrl) throw new Error("document_sign_failed");
    return data.signedUrl;
  },
};
