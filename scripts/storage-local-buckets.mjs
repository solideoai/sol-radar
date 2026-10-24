// 로컬 Supabase 에 앱이 쓰는 private 버킷 셋(bid-documents·bid-parsed·profile-photos)을 만든다.
// pnpm storage:local (Supabase CLI 로컬 스택이 켜져 있어야 한다). 키는 supabase status 에서 읽고 화면에 찍지 않는다.
// 격리 스택은 SOL_RADAR_TEST_SUPABASE_WORKDIR·SOL_RADAR_TEST_SUPABASE_API_URL 로 고른다(local-test-target.mjs).
// 로컬 주소가 아니면 readLocalStatus 가 거절한다. 클라우드 버킷은 사람이 scripts/ops/ensure-storage-buckets.mjs --apply 로 만든다.
import { createRequire } from "node:module";
import { readLocalStatus } from "./local-test-target.mjs";
import { ensureProfilePhotoBucket, ensureStorageBuckets } from "./ops/ensure-storage-buckets.mjs";

const status = readLocalStatus();
const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
if (!serviceKey) throw new Error("로컬 Supabase status 에 service role 값이 없다(pnpm db:start).");
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const admin = createClient(status.API_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log(`storage target: ${new URL(status.API_URL).host}`);
console.log(JSON.stringify(await ensureStorageBuckets(admin, { apply: true })));
console.log(JSON.stringify(await ensureProfilePhotoBucket(admin, { apply: true })));
