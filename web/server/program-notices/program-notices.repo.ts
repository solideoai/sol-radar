import "server-only";
import { getSupabase } from "@/server/supabase";
import type { ProgramNoticeRow, ProgramNoticesRepo } from "./list.service";

// ── 부처 공고 읽기(화면 쪽). anon 키 + 로그인 세션이고, 누가 읽는지는 RLS 가 정한다(활동 중 회원, 마이그레이션 20261021000650) ──
// 요청마다 await getSupabase() 를 부른다. 모듈 변수에 담아 두면 다른 사람의 요청에 로그인이 섞인다.
// 쓰기는 worker 의 program-notices.store.ts(service role)만 한다.

const LIST_COLUMNS =
  "id, source, title, agency, source_url, published_at, apply_start_on, apply_end_on, summary, apply_method, target, tags, is_demo, dedupe_key";

export const programNoticesRepo: ProgramNoticesRepo = {
  async listRecent({ limit }) {
    const supabase = await getSupabase();
    const result = await supabase
      .from("program_notices")
      .select(LIST_COLUMNS)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit);
    // DB 오류 메시지에는 질의 값이 실릴 수 있다. 오류 코드만 남긴다.
    if (result.error) throw new Error(`program_notices select 실패(code=${result.error.code})`);
    return result.data satisfies ProgramNoticeRow[];
  },
};
