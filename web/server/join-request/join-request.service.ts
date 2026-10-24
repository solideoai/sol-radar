import "server-only";
import { getMyBusinessAccess, type MyBusinessAccess } from "@/server/organization";
import { signPhotoPaths } from "@/server/photos";
import {
  decideJoinInput,
  type DecideJoinResult,
  type FindMemberResult,
  findMemberInput,
  type JoinRequestView,
  type MyJoinRequest,
  submitJoinInput,
  type SubmitJoinResult,
  toDecideJoinResult,
  toJoinRequestView,
  toMyJoinRequest,
  toSubmitJoinResult,
} from "./join-request.model";
import { joinRequestRepo, type JoinRequestRepo } from "./join-request.repo";

// ── 서비스: 입력 검사 → 로그인 확인 → DB 함수. 최종 판정(ADMIN·대상 직원·경쟁)은 DB 함수가 한다 ──
// 저장은 인자로 받는다. 운영은 기본값(Supabase), 시험은 같은 모양의 가짜 객체를 넘긴다.

export type JoinRequestDeps = {
  repo: JoinRequestRepo;
  access: () => Promise<MyBusinessAccess>;
};

const defaultDeps: JoinRequestDeps = { repo: joinRequestRepo, access: getMyBusinessAccess };

const signedIn = async (repo: JoinRequestRepo): Promise<string | null> =>
  repo.isConfigured() ? repo.currentUserId() : null;

/** 내 가장 최근 신청. 신청한 적이 없으면 none 이다. */
export async function getMyJoinRequest(
  repo: JoinRequestRepo = joinRequestRepo,
): Promise<MyJoinRequest> {
  const userId = await signedIn(repo);
  if (!userId) return { status: "signed-out" };
  return toMyJoinRequest(await repo.myLatestRequest(userId));
}

/** 가입 신청을 낸다. 대기 중인 신청이 있으면 DB 함수가 그 행을 고친다. */
export async function submitMyJoinRequest(
  input: unknown,
  repo: JoinRequestRepo = joinRequestRepo,
): Promise<SubmitJoinResult> {
  const parsed = submitJoinInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  if (!(await signedIn(repo))) return { status: "signed-out" };
  return toSubmitJoinResult((await repo.submit(parsed.data)).error);
}

/** 부서·이름이 정확히 맞는 미연결 가상 직원 하나를 찾는다. 부서 명부 전체는 보여 주지 않는다(설계 C3). */
export async function findUnlinkedMember(
  input: unknown,
  repo: JoinRequestRepo = joinRequestRepo,
): Promise<FindMemberResult> {
  const parsed = findMemberInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  if (!(await signedIn(repo))) return { status: "signed-out" };
  const { rows, error } = await repo.findUnlinked(parsed.data.departmentId, parsed.data.name);
  if (error?.hint === "not_active") return { status: "signed-out" };
  if (error) throw Object.assign(new Error("직원 찾기 DB 함수 오류"), { cause: error });
  const [row] = rows;
  return row
    ? {
        status: "found",
        member: {
          id: row.id,
          personCode: row.person_code,
          name: row.name,
          jobTitleLabel: row.job_title_label,
        },
      }
    : { status: "not-found" };
}

/** 조직의 대기 신청. 화면(page.tsx)이 ADMIN 을 확인한 뒤 부른다. 신청자 사진은 서명해 돌려준다. */
export async function listPendingJoinRequests(
  orgId: string,
  repo: JoinRequestRepo = joinRequestRepo,
): Promise<JoinRequestView[]> {
  const rows = await repo.listPending(orgId);
  const photoUrls = await signPhotoPaths(
    rows.flatMap((row) => (row.applicant_photo_path ? [row.applicant_photo_path] : [])),
  );
  return rows.map((row) => toJoinRequestView(row, photoUrls));
}

/** 관리자가 신청을 승인·거절한다. 업무 역할을 고르지 않으면 VIEWER 다(설계 C7). */
export async function decideOrgJoinRequest(
  input: unknown,
  deps: JoinRequestDeps = defaultDeps,
): Promise<DecideJoinResult> {
  const parsed = decideJoinInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const access = await deps.access();
  if (access.status === "signed-out" || access.status === "no-database")
    return { status: "signed-out" };
  if (access.status !== "ready" || access.current.solRole !== "ADMIN")
    return { status: "forbidden" };
  const { requestId, approve, solRole } = parsed.data;
  const { result, error } = await deps.repo.decide(requestId, approve, solRole);
  return toDecideJoinResult(result, error);
}
