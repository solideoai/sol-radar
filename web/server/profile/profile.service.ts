import "server-only";
import {
  type DeleteAccountResult,
  type DisplayNameResult,
  type MyProfile,
  parseDisplayName,
  toMyProfile,
} from "./profile.model";
import { profileRepo, type ProfileRepo } from "./profile.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──
// 저장은 인자로 받는다. 운영은 기본값(Supabase), 시험은 같은 모양의 가짜 객체를 넘긴다.
export async function getMyProfile(repo: ProfileRepo = profileRepo): Promise<MyProfile> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const id = await repo.currentUserId();
  if (!id) return { status: "signed-out" };
  return toMyProfile(await repo.findById(id));
}

// 누구의 행인지는 입력이 아니라 로그인에서 읽는다 — 서버 함수는 화면 밖에서 직접 POST 로도 불린다.
export async function updateMyDisplayName(
  input: unknown,
  repo: ProfileRepo = profileRepo,
): Promise<DisplayNameResult> {
  const parsed = parseDisplayName(input);
  if (!parsed.ok) return { status: "invalid", message: parsed.message };
  const id = repo.isConfigured() ? await repo.currentUserId() : null;
  if (!id) return { status: "signed-out" };
  // 로그인한 본인 행인데 고친 행이 없으면 프로필 행이 없거나(가입 트리거보다 먼저 만든 계정) 정지된 것이다.
  if (!(await repo.updateDisplayName(id, parsed.displayName)))
    throw new Error("profiles 행이 없거나 정지된 계정이라 표시 이름을 저장하지 못했습니다");
  return { status: "saved" };
}

// 즉시 삭제라 되돌릴 수 없다. 화면은 확인을 받은 뒤에만 부른다.
export async function deleteMyAccount(
  repo: ProfileRepo = profileRepo,
): Promise<DeleteAccountResult> {
  const id = repo.isConfigured() ? await repo.currentUserId() : null;
  if (!id) return { status: "signed-out" };
  return { status: await repo.deleteAccount() };
}
