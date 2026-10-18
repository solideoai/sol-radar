import "server-only";
import { z } from "zod";

export type PeopleErrorCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_DISABLED"
  | "PROFILE_INCOMPLETE"
  | "FORBIDDEN"
  | "UNSUPPORTED_ACCOUNT_STATE"
  | "VALIDATION_ERROR"
  | "INVALID_CURSOR"
  | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE";
export class PeopleReadError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: PeopleErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export type PeopleResult<T> =
  { status: "ready"; data: T } | { status: "error"; error: PeopleReadError };
export type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  parent_id: string | null;
  target_count: number | null;
};
export type MemberRow = {
  id: string;
  person_code: string;
  name: string;
  department_id: string;
  job_title_id: string;
  portrait_path: string | null;
  is_demo: boolean;
};
export type ScoringRow = {
  member_id: string;
  role: string;
  grade: string | null;
  skills: unknown;
  availability: unknown;
};
const departmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(["DIVISION", "GROUP", "TEAM"]).nullable(),
  parentId: z.uuid().nullable(),
  targetCount: z.number().int().nonnegative().nullable(),
  memberCount: z.number().int().nonnegative(),
});
const jobTitleSchema = z.object({ id: z.uuid(), code: z.string(), label: z.string() });
const memberSchema = z.object({
  id: z.uuid(),
  personCode: z.string(),
  name: z.string(),
  departmentId: z.uuid(),
  jobTitleId: z.uuid(),
  portraitUrl: z.string().nullable(),
  scoringEligible: z.boolean(),
  isDemo: z.literal(true),
});
const capacitySchema = z
  .object({ startsAt: z.iso.date(), endsAt: z.iso.date(), fte: z.number().min(0).max(1) })
  .refine((value) => value.startsAt < value.endsAt);
const scoringSchema = z.object({
  role: z.string().trim().min(1),
  grade: z.string().nullable(),
  skills: z.array(z.string()),
  availability: z.array(capacitySchema),
});
export type Department = z.infer<typeof departmentSchema>;
export type JobTitle = z.infer<typeof jobTitleSchema>;
export type TeamMemberListItem = z.infer<typeof memberSchema>;
export type TeamMemberDetail = TeamMemberListItem & {
  scoring: z.infer<typeof scoringSchema> | null;
};
export type PeopleSummary = { totalCount: number; scoringCount: number };
export type PeopleDirectory = {
  departments: Department[];
  jobTitles: JobTitle[];
  members: TeamMemberListItem[];
  summary: PeopleSummary;
};
export type PeopleRows = {
  departments: DepartmentRow[];
  jobTitles: JobTitle[];
  members: MemberRow[];
  scoring: ScoringRow[];
};
export type PeoplePage = {
  items: TeamMemberListItem[];
  pageInfo: {
    cursor: string | null;
    nextCursor: string | null;
    previousCursor: string | null;
    hasNext: boolean;
    startIndex: number;
  };
  totalCount: number;
  summary: PeopleSummary;
};
const querySchema = z.strictObject({
  q: z.string().trim().max(40).optional(),
  departmentId: z.uuid().optional(),
  jobTitleId: z.uuid().optional(),
  scoring: z.enum(["1", "0"]).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
});
export type PeopleQuery = Omit<z.infer<typeof querySchema>, "limit"> & { limit: number };
export function parsePeopleQuery(params: URLSearchParams): PeopleQuery {
  const duplicate = [...params.keys()].find((key) => params.getAll(key).length !== 1);
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (duplicate || !parsed.success)
    throw new PeopleReadError(400, "VALIDATION_ERROR", "조회 조건을 확인하세요.", {
      issues: duplicate
        ? [{ path: duplicate, message: "중복 조건은 허용하지 않습니다." }]
        : parsed.error?.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
    });
  const { q, ...query } = parsed.data;
  return { ...query, ...(q ? { q } : {}), limit: query.limit ?? 20 };
}
export function requireEmptyPeopleQuery(params: URLSearchParams): void {
  if (params.size)
    throw new PeopleReadError(400, "VALIDATION_ERROR", "지원하지 않는 조회 조건입니다.", {
      issues: [...params.keys()].map((path) => ({ path, message: "허용하지 않는 조건입니다." })),
    });
}
export const isPeopleId = (id: string): boolean => z.uuid().safeParse(id).success;
export function toTeamMemberListItem(row: MemberRow, scoringEligible: boolean): TeamMemberListItem {
  const portraitUrl =
    /^SOL-P\d{4}$/.test(row.person_code) &&
    row.portrait_path === `/demo/people/${row.person_code}.png`
      ? row.portrait_path
      : null;
  return memberSchema.parse({
    id: row.id,
    personCode: row.person_code,
    name: row.name,
    departmentId: row.department_id,
    jobTitleId: row.job_title_id,
    portraitUrl,
    scoringEligible,
    isDemo: row.is_demo,
  });
}
export function toTeamMemberDetail(row: MemberRow, scoring: ScoringRow | null): TeamMemberDetail {
  return {
    ...toTeamMemberListItem(row, scoring !== null),
    scoring: scoring ? scoringSchema.parse(scoring) : null,
  };
}
export function buildPeopleDirectory(rows: PeopleRows): PeopleDirectory {
  const unique = [...new Map(rows.members.map((row) => [row.id, row])).values()];
  const scoringIds = new Set(rows.scoring.map((row) => row.member_id));
  const members = unique
    .map((row) => toTeamMemberListItem(row, scoringIds.has(row.id)))
    .toSorted(comparePeople);
  const departments = rows.departments.map((row) => {
    const descendants = new Set([row.id]);
    // The catalog is shallow, but a visited set also prevents malformed cycles from hanging a read.
    for (let previous = 0; previous !== descendants.size;) {
      previous = descendants.size;
      rows.departments
        .filter((child) => child.parent_id !== null && descendants.has(child.parent_id))
        .forEach((child) => descendants.add(child.id));
    }
    return departmentSchema.parse({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      parentId: row.parent_id,
      targetCount: row.kind === null || row.kind === "TEAM" ? row.target_count : null,
      memberCount: members.filter((member) => descendants.has(member.departmentId)).length,
    });
  });
  return {
    departments,
    jobTitles: rows.jobTitles.map((row) => jobTitleSchema.parse(row)),
    members,
    summary: {
      totalCount: members.length,
      scoringCount: members.filter((member) => member.scoringEligible).length,
    },
  };
}
export function comparePeople(
  a: Pick<TeamMemberListItem, "personCode" | "id">,
  b: Pick<TeamMemberListItem, "personCode" | "id">,
): number {
  return a.personCode < b.personCode
    ? -1
    : a.personCode > b.personCode
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}
export function filterTeamMembers(
  members: readonly TeamMemberListItem[],
  query: PeopleQuery,
): TeamMemberListItem[] {
  const search = query.q?.toLocaleLowerCase();
  return members
    .filter(
      (member) =>
        (!search ||
          member.name.toLocaleLowerCase().includes(search) ||
          member.personCode.toLocaleLowerCase().includes(search)) &&
        (!query.departmentId || member.departmentId === query.departmentId) &&
        (!query.jobTitleId || member.jobTitleId === query.jobTitleId) &&
        (!query.scoring || member.scoringEligible === (query.scoring === "1")),
    )
    .toSorted(comparePeople);
}
