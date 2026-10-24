import "server-only";
import { z } from "zod";
import { isMemberPhotoPath, isOwnPhotoPath } from "@/server/shared";
import { toPhotoSaveResult, type PhotoSaveResult } from "./photo.model";
import { photoRepo, type PhotoRepo } from "./photo.repo";

// ── 서비스: 입력 검사 → RPC. 경로 규칙은 DB 함수가 한 번 더 지킨다 ──
// 저장은 인자로 받는다. 운영은 기본값(Supabase), 시험은 같은 모양의 가짜 객체를 넘긴다.

const pathInput = z.string().max(200).nullable();
const memberIdInput = z.uuid();

/** 같은 경로는 한 번만 서명한다. 경로가 없으면 Storage 를 부르지 않는다. */
export async function signPhotoPaths(
  paths: readonly string[],
  repo: PhotoRepo = photoRepo,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  return unique.length ? repo.signPaths(unique) : new Map();
}

/** 내 사진 포인터를 바꾼다. null 은 사진 지우기다. 누구의 사진인지는 로그인에서 읽는다. */
export async function saveMyPhoto(
  input: unknown,
  repo: PhotoRepo = photoRepo,
): Promise<PhotoSaveResult> {
  const parsed = pathInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const userId = repo.isConfigured() ? await repo.currentUserId() : null;
  if (!userId) return { status: "signed-out" };
  if (parsed.data !== null && !isOwnPhotoPath(parsed.data, userId)) return { status: "invalid" };
  return toPhotoSaveResult(await repo.setMyPhoto(parsed.data));
}

/** 관리자가 직원 사진 포인터를 바꾼다. ADMIN 인지는 DB 함수가 본다. */
export async function saveMemberPhoto(
  memberInput: unknown,
  input: unknown,
  repo: PhotoRepo = photoRepo,
): Promise<PhotoSaveResult> {
  const member = memberIdInput.safeParse(memberInput);
  const parsed = pathInput.safeParse(input);
  if (!member.success || !parsed.success) return { status: "invalid" };
  if (parsed.data !== null && !isMemberPhotoPath(parsed.data, member.data))
    return { status: "invalid" };
  if (!repo.isConfigured() || !(await repo.currentUserId())) return { status: "signed-out" };
  return toPhotoSaveResult(await repo.setMemberPhoto(member.data, parsed.data));
}
