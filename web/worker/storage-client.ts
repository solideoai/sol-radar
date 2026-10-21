import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Only Worker imports this client. Uploads and health probes have real network deadlines.
export function createWorkerStorageClient(
  env: Record<string, string | undefined>,
  timeoutMs = 60_000,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("storage_worker_credentials_required");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const deadline = AbortSignal.timeout(timeoutMs);
        const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        return fetch(input, { ...init, signal });
      },
    },
  });
}
