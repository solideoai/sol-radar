import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { companyProfileSchema, type CompanyProfile as ScoringProfile } from "@/server/scoring";
import type { SolRole } from "@/server/organization";
import { nameOf } from "@/server/shared";

// 05 §4.4 회사 프로필 조회 모양. JSONB 안쪽은 점수 엔진이 읽는 스키마(companyProfileSchema)로 검증한다 —
// 화면이 보여 주는 값과 점수가 쓰는 값이 같은 모양이어야 "이 프로필로 분석했다"가 참이다.
// pastProjects 는 08 §3.2 모양(id·name·domain·amountKrw·completedAt·evidenceRef)이고 05 의 title·startedAt 모양과 다르다(C4 결정).

// 회사 역량은 메뉴·페이지·API 에서 ADMIN·EXECUTIVE 만 연다(RLS 읽기는 조직 전원 그대로).
// components/app-nav.ts 의 /company roles 와 같은 값이다(클라이언트가 가져오는 파일이라 따로 적는다).
export const COMPANY_PROFILE_READ_ROLES: readonly SolRole[] = ["ADMIN", "EXECUTIVE"];
export const canReadCompanyProfile = (role: SolRole): boolean =>
  COMPANY_PROFILE_READ_ROLES.includes(role);

type ProfileTable = Database["public"]["Tables"]["company_profiles"]["Row"];

export const PROFILE_COLUMNS =
  "id,org_id,revision,name,technologies,technologies_complete,licenses,industry_codes,past_projects,financials,preferences,sources,public_history,is_demo,effective_at,created_by,note,created_at,creator:profiles!company_profiles_created_by_fkey(display_name,email)";
export const SUMMARY_COLUMNS =
  "id,revision,effective_at,created_by,note,created_at,creator:profiles!company_profiles_created_by_fkey(display_name,email)";

type Creator = { display_name: string | null; email: string | null } | null;

export type CompanyProfileRow = Pick<
  ProfileTable,
  | "id"
  | "org_id"
  | "revision"
  | "name"
  | "technologies"
  | "technologies_complete"
  | "licenses"
  | "industry_codes"
  | "past_projects"
  | "financials"
  | "preferences"
  | "sources"
  | "public_history"
  | "is_demo"
  | "effective_at"
  | "created_by"
  | "note"
  | "created_at"
> & { creator: Creator };

export type CompanyProfileSummaryRow = Pick<
  ProfileTable,
  "id" | "revision" | "effective_at" | "created_by" | "note" | "created_at"
> & { creator: Creator };

export type ProfileAuthor = { id: string; name: string };

// 만든 사람의 계정이 지워지면 created_by 가 null 이 된다(on delete set null). 05 의 createdBy 는 null 이 아니라서
// 결정한 사람과 같은 자리 표시로 내보낸다(05 Review.reviewer, ADR-032 D6. 값은 server/bids 의 DELETED_REVIEWER_* 와 같다).
export const DELETED_AUTHOR: ProfileAuthor = { id: "deleted-user", name: "탈퇴한 사용자" };

// 공개 자료 출처와 인증·등록 이력. 점수에는 쓰지 않고 화면에서 "어디서 나온 값인지"를 보이는 용도다.
// 날짜는 점수 스키마의 isoDate(모듈 비공개)와 같은 YYYY-MM-DD 로 따로 검증한다.
export const profileSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["PUBLIC", "COMPANY_CONFIRMED"]),
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/, message: "http·https 주소만 허용합니다" }).nullable(),
  retrievedAt: z.iso.date(),
  confirmedBy: z.string().optional(),
  quote: z.string().optional(),
});
export type ProfileSource = z.infer<typeof profileSourceSchema>;

export const publicHistoryEntrySchema = z.object({
  year: z.number().int(),
  kind: z.enum(["CERTIFICATION", "REGISTRATION", "AWARD"]),
  name: z.string().min(1),
  sourceIds: z.array(z.string().min(1)),
});
export type PublicHistoryEntry = z.infer<typeof publicHistoryEntrySchema>;

export type PastProject = ScoringProfile["pastProjects"][number];

export type CompanyProfile = Omit<ScoringProfile, "name"> & {
  sources: ProfileSource[];
  publicHistory: PublicHistoryEntry[];
  id: string;
  orgId: string;
  name: string;
  effectiveAt: string;
  createdBy: ProfileAuthor;
  createdAt: string;
  note: string | null;
};

export type CompanyProfileSummary = {
  id: string;
  revision: number;
  effectiveAt: string;
  createdBy: ProfileAuthor;
  createdAt: string;
  note: string | null;
};

// 점수 계산 대상 인력 요약(06 §5.6 인력 탭). 가용 FTE 는 공고 수행 기간마다 달라서 여기서 셈하지 않는다.
export type CompanyStaffing = { totalCount: number; scoringCount: number };

// 저장된 JSONB 가 점수 엔진 스키마와 맞지 않으면 분석도 같은 행에서 실패한다. 화면은 오류 경계로 보낸다.
export class CompanyProfileDataError extends Error {
  constructor(readonly profileId: string) {
    super(`company_profiles ${profileId} 의 저장 값이 프로필 스키마와 맞지 않습니다`);
    this.name = "CompanyProfileDataError";
  }
}

const authorOf = (createdBy: string | null, creator: Creator): ProfileAuthor =>
  createdBy === null
    ? DELETED_AUTHOR
    : { id: createdBy, name: nameOf(creator?.display_name ?? null, creator?.email ?? null) };

export function toCompanyProfile(row: CompanyProfileRow): CompanyProfile {
  const parsed = companyProfileSchema.safeParse({
    revision: row.revision,
    name: row.name,
    isDemo: row.is_demo,
    technologies: row.technologies,
    technologiesComplete: row.technologies_complete,
    licenses: row.licenses,
    industryCodes: row.industry_codes,
    pastProjects: row.past_projects,
    financials: row.financials,
    preferences: row.preferences,
  });
  const sources = z.array(profileSourceSchema).safeParse(row.sources);
  const publicHistory = z.array(publicHistoryEntrySchema).safeParse(row.public_history);
  if (!parsed.success || !sources.success || !publicHistory.success)
    throw new CompanyProfileDataError(row.id);
  return {
    ...parsed.data,
    sources: sources.data,
    publicHistory: publicHistory.data,
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    effectiveAt: row.effective_at,
    createdBy: authorOf(row.created_by, row.creator),
    createdAt: row.created_at,
    note: row.note,
  };
}

export const toCompanyProfileSummary = (row: CompanyProfileSummaryRow): CompanyProfileSummary => ({
  id: row.id,
  revision: row.revision,
  effectiveAt: row.effective_at,
  createdBy: authorOf(row.created_by, row.creator),
  createdAt: row.created_at,
  note: row.note,
});

// 수행 실적 표시 순서: 완료일 내림차순, 완료일을 모르는(null) 실적은 맨 아래, 그 안에서는 이름순.
export const sortProjectsForDisplay = (projects: PastProject[]): PastProject[] =>
  [...projects].sort((left, right) => {
    if (left.completedAt === null && right.completedAt === null)
      return left.name.localeCompare(right.name, "ko");
    if (left.completedAt === null) return 1;
    if (right.completedAt === null) return -1;
    return right.completedAt.localeCompare(left.completedAt);
  });

// 출처 확인일 중 가장 늦은 날(YYYY-MM-DD). 출처가 없으면 null.
export const latestRetrievedAt = (sources: ProfileSource[]): string | null =>
  sources.reduce<string | null>(
    (latest, source) =>
      latest === null || source.retrievedAt > latest ? source.retrievedAt : latest,
    null,
  );
