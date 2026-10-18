import "server-only";
import type { Authentication } from "@/server/auth";
import type { EmploymentResult } from "@/server/profile";
import type { MyBusinessAccess } from "@/server/organization";
import { peopleRepo, type PeopleRepo } from "./people.repo";
import {
  assertPeopleCursorConfigured,
  createPeopleCursor,
  readPeopleCursor,
} from "./people.cursor";
import {
  buildPeopleDirectory,
  comparePeople,
  filterTeamMembers,
  isPeopleId,
  parsePeopleQuery,
  PeopleReadError,
  requireEmptyPeopleQuery,
  toTeamMemberDetail,
  type Department,
  type JobTitle,
  type PeopleDirectory,
  type PeoplePage,
  type PeopleResult,
  type TeamMemberDetail,
} from "./people.model";
export type PeopleAccess = {
  authenticate: () => Promise<Authentication>;
  getMyEmployment: () => Promise<EmploymentResult>;
  getMyBusinessAccess: () => Promise<MyBusinessAccess>;
};
const unavailable = () =>
  new PeopleReadError(503, "SERVICE_UNAVAILABLE", "DB가 연결되지 않았습니다.", { component: "db" });
const signedOut = () => new PeopleReadError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
const disabled = () => new PeopleReadError(403, "ACCOUNT_DISABLED", "정지된 계정입니다.");
async function currentPeopleOrganization(access: PeopleAccess): Promise<string> {
  const auth = await access.authenticate();
  if (auth.status === "no-database") throw unavailable();
  if (auth.status === "unauthenticated") throw signedOut();
  if (auth.status === "suspended") throw disabled();
  const employment = await access.getMyEmployment();
  if (employment.status === "no-database") throw unavailable();
  if (employment.status === "signed-out") throw signedOut();
  if (employment.status === "suspended") throw disabled();
  if (employment.status !== "ready" || !employment.state.profileComplete)
    throw new PeopleReadError(403, "PROFILE_INCOMPLETE", "가입 정보를 보완하세요.", {
      completionPath: "/auth/complete-profile",
    });
  const business = await access.getMyBusinessAccess();
  switch (business.status) {
    case "no-database":
      throw unavailable();
    case "signed-out":
      throw signedOut();
    case "no-org":
      throw new PeopleReadError(403, "FORBIDDEN", "업무 조직에 가입해야 합니다.", {
        reason: "ORGANIZATION_REQUIRED",
        organizationStatePath: "/auth/organization-state",
      });
    case "multiple-orgs":
      throw new PeopleReadError(403, "UNSUPPORTED_ACCOUNT_STATE", "업무 조직 하나만 지원합니다.");
    case "forbidden":
      throw new PeopleReadError(403, "FORBIDDEN", "조회 권한이 없습니다.");
    case "ready":
      if (
        business.userId !== auth.user.id ||
        business.current.isPersonal ||
        !["VIEWER", "ANALYST", "SALES", "ADMIN"].includes(business.current.solRole)
      )
        throw new PeopleReadError(403, "FORBIDDEN", "조회 권한이 없습니다.");
      return business.current.id;
  }
}
async function read<T>(
  access: PeopleAccess,
  work: (orgId: string) => Promise<T>,
): Promise<PeopleResult<T>> {
  try {
    return { status: "ready", data: await work(await currentPeopleOrganization(access)) };
  } catch (error) {
    if (error instanceof PeopleReadError) return { status: "error", error };
    throw error;
  }
}
async function directoryFor(orgId: string, repo: PeopleRepo): Promise<PeopleDirectory> {
  const [departments, jobTitles, members, scoring] = await Promise.all([
    repo.listDepartments(orgId),
    repo.listJobTitles(orgId),
    repo.listMembers(orgId),
    repo.listScoring(orgId),
  ]);
  return buildPeopleDirectory({ departments, jobTitles, members, scoring });
}
export async function getPeopleDirectory(
  access: PeopleAccess,
  repo: PeopleRepo = peopleRepo,
): Promise<PeopleResult<PeopleDirectory>> {
  return read(access, (orgId) => directoryFor(orgId, repo));
}
export async function getDepartments(
  access: PeopleAccess,
  params: URLSearchParams = new URLSearchParams(),
  repo: PeopleRepo = peopleRepo,
): Promise<PeopleResult<Department[]>> {
  return read(access, async (orgId) => {
    requireEmptyPeopleQuery(params);
    return (await directoryFor(orgId, repo)).departments;
  });
}
export async function getJobTitles(
  access: PeopleAccess,
  params: URLSearchParams = new URLSearchParams(),
  repo: PeopleRepo = peopleRepo,
): Promise<PeopleResult<JobTitle[]>> {
  return read(access, async (orgId) => {
    requireEmptyPeopleQuery(params);
    return (await directoryFor(orgId, repo)).jobTitles;
  });
}
export async function listTeamMembers(
  access: PeopleAccess,
  params: URLSearchParams = new URLSearchParams(),
  repo: PeopleRepo = peopleRepo,
): Promise<PeopleResult<PeoplePage>> {
  return read(access, async (orgId) => {
    const query = parsePeopleQuery(params);
    assertPeopleCursorConfigured();
    const binding = { orgId, query };
    const position = query.cursor ? readPeopleCursor(query.cursor, binding) : null;
    const directory = await directoryFor(orgId, repo);
    if (query.departmentId) {
      const department = directory.departments.find((row) => row.id === query.departmentId);
      if (!department) throw new PeopleReadError(404, "NOT_FOUND", "부서를 찾을 수 없습니다.");
      if (department.kind !== null && department.kind !== "TEAM")
        throw new PeopleReadError(400, "VALIDATION_ERROR", "팀 부서를 선택하세요.", {
          issues: [{ path: "departmentId", message: "팀만 조회할 수 있습니다." }],
        });
    }
    if (query.jobTitleId && !directory.jobTitles.some((row) => row.id === query.jobTitleId))
      throw new PeopleReadError(404, "NOT_FOUND", "직급을 찾을 수 없습니다.");
    const filtered = filterTeamMembers(directory.members, query);
    const after = position ? filtered.findIndex((row) => comparePeople(row, position) > 0) : 0;
    const startIndex = after === -1 ? filtered.length : after;
    const items = filtered.slice(startIndex, startIndex + query.limit);
    const hasNext = startIndex + items.length < filtered.length;
    const previousStart = Math.max(0, startIndex - query.limit);
    return {
      items,
      totalCount: filtered.length,
      summary: directory.summary,
      pageInfo: {
        cursor: query.cursor ?? null,
        nextCursor: hasNext ? createPeopleCursor(binding, items[items.length - 1]) : null,
        previousCursor:
          previousStart > 0 ? createPeopleCursor(binding, filtered[previousStart - 1]) : null,
        hasNext,
        startIndex,
      },
    };
  });
}
export async function getTeamMember(
  access: PeopleAccess,
  id: string,
  params: URLSearchParams = new URLSearchParams(),
  repo: PeopleRepo = peopleRepo,
): Promise<PeopleResult<TeamMemberDetail>> {
  return read(access, async (orgId) => {
    requireEmptyPeopleQuery(params);
    if (!isPeopleId(id))
      throw new PeopleReadError(400, "VALIDATION_ERROR", "직원 ID를 확인하세요.", {
        issues: [{ path: "id", message: "UUID가 필요합니다." }],
      });
    const member = await repo.findMember(orgId, id);
    if (!member) throw new PeopleReadError(404, "NOT_FOUND", "직원을 찾을 수 없습니다.");
    return toTeamMemberDetail(member, await repo.findScoring(orgId, id));
  });
}
