import "server-only";
import { employmentInputSchema } from "@/server/shared";
import { getSignupOptions } from "./profile.catalog";
import {
  type DeleteAccountResult,
  type DisplayNameResult,
  type MyProfile,
  type EmploymentResult,
  toEmploymentState,
  ownPhotoPathOf,
  parseDisplayName,
  toMyProfile,
} from "./profile.model";
import { InvalidEmploymentError, profileRepo, type ProfileRepo } from "./profile.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──
// 저장은 인자로 받는다. 운영은 기본값(Supabase), 시험은 같은 모양의 가짜 객체를 넘긴다.
export async function getMyProfile(repo: ProfileRepo = profileRepo): Promise<MyProfile> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const id = await repo.currentUserId();
  if (!id) return { status: "signed-out" };
  const row = await repo.findById(id);
  const photoPath = row?.status === "active" ? ownPhotoPathOf(row) : null;
  return toMyProfile(row, photoPath ? await repo.signPhoto(photoPath) : null);
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

export async function getMyEmployment(repo: ProfileRepo = profileRepo): Promise<EmploymentResult> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const id = await repo.currentUserId();
  if (!id) return { status: "signed-out" };
  const row = await repo.findById(id);
  if (!row) return { status: "missing" };
  if (row.status !== "active") return { status: "suspended" };
  return { status: "ready", state: toEmploymentState(row) };
}

export async function saveMyEmployment(
  input: unknown,
  repo: ProfileRepo = profileRepo,
): Promise<EmploymentResult> {
  const parsed = employmentInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: "invalid",
      fields: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message]),
      ),
    };
  const options = getSignupOptions();
  const fields: Record<string, string> = {};
  if (!options.departments.some((item) => item.id === parsed.data.departmentId))
    fields.departmentId = "유효한 부서를 선택하세요";
  if (!options.jobTitles.some((item) => item.id === parsed.data.jobTitleId))
    fields.jobTitleId = "유효한 직급/직책을 선택하세요";
  if (Object.keys(fields).length) return { status: "invalid", fields };
  if (!repo.isConfigured()) return { status: "no-database" };
  const id = await repo.currentUserId();
  if (!id) return { status: "signed-out" };
  const row = await repo.findById(id);
  if (!row) return { status: "missing" };
  if (row.status !== "active") return { status: "suspended" };
  try {
    if (!(await repo.updateEmployment(id, parsed.data)))
      throw new Error("본인 가입 정보를 저장하지 못했습니다");
  } catch (error) {
    if (error instanceof InvalidEmploymentError)
      return {
        status: "invalid",
        fields: {
          departmentId: "유효한 부서를 선택하세요",
          jobTitleId: "유효한 직급/직책을 선택하세요",
        },
      };
    throw error;
  }
  return getMyEmployment(repo);
}
