import "server-only";
import { PHOTO_BUCKET } from "@/server/shared";
import { getAuthClaims, getSupabase, isSupabaseConfigured } from "@/server/supabase";
import type { PhotoDbError } from "./photo.model";

// ── 저장: Storage 서명과 사진 포인터 RPC. 규칙은 두지 않는다 ──
// 요청마다 await getSupabase() 를 부른다(사용자 JWT). service role 을 쓰지 않는다 — 서명도 RLS(profile_photos_read)를 탄다.

/** signed URL 유효 시간(초). 지나면 화면은 머리글자로 바뀐다(PersonAvatar 의 오류 대체). */
const SIGNED_URL_SECONDS = 3600;

const asDbError = (error: { code?: string; hint?: string } | null): PhotoDbError | null =>
  error ? { code: error.code ?? "", hint: error.hint ?? "" } : null;

export const photoRepo = {
  isConfigured: isSupabaseConfigured,
  async currentUserId(): Promise<string | null> {
    return (await getAuthClaims())?.userId ?? null;
  },
  // 사진 지우기는 p_path 를 생략한다(DB 기본값 null, 20261024000210).
  async setMyPhoto(path: string | null): Promise<PhotoDbError | null> {
    const { error } = await (
      await getSupabase()
    ).rpc("set_my_photo", path === null ? {} : { p_path: path });
    return asDbError(error);
  },
  async setMemberPhoto(memberId: string, path: string | null): Promise<PhotoDbError | null> {
    const { error } = await (
      await getSupabase()
    ).rpc("set_member_photo", { p_member: memberId, ...(path === null ? {} : { p_path: path }) });
    return asDbError(error);
  },
  // 서명하지 못한 경로(지워진 객체·읽기 권한 없음)는 빠진다. 화면은 다음 순위의 사진을 그린다.
  async signPaths(paths: string[]): Promise<Map<string, string>> {
    const { data, error } = await (
      await getSupabase()
    ).storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) throw error;
    return new Map(
      (data ?? []).flatMap((row) =>
        row.path && row.signedUrl && !row.error ? [[row.path, row.signedUrl] as const] : [],
      ),
    );
  },
};

export type PhotoRepo = typeof photoRepo;
