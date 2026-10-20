import "server-only";
import type { Database } from "@/lib/database.types";
import { companyProfileSchema, type CompanyProfile as ScoringProfile } from "@/server/scoring";
import { nameOf } from "@/server/shared";

// 05 §4.4 회사 프로필 조회 모양. JSONB 안쪽은 점수 엔진이 읽는 스키마(companyProfileSchema)로 검증한다 —
// 화면이 보여 주는 값과 점수가 쓰는 값이 같은 모양이어야 "이 프로필로 분석했다"가 참이다.
// pastProjects 는 08 §3.2 모양(id·name·domain·amountKrw·completedAt·evidenceRef)이고 05 의 title·startedAt 모양과 다르다(C4 결정).

type ProfileTable = Database["public"]["Tables"]["company_profiles"]["Row"];

export const PROFILE_COLUMNS =
  "id,org_id,revision,name,technologies,technologies_complete,licenses,industry_codes,past_projects,financials,preferences,is_demo,effective_at,created_by,note,created_at,creator:profiles!company_profiles_created_by_fkey(display_name,email)";
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

export type ProfileAuthor = { id: string; name: string } | null;

export type CompanyProfile = Omit<ScoringProfile, "name"> & {
  id: string;
  orgId: string;
  name: string;
  effectiveAt: string;
  // 만든 사람의 계정이 지워지면 created_by 가 null 이 된다(on delete set null).
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
    ? null
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
  if (!parsed.success) throw new CompanyProfileDataError(row.id);
  return {
    ...parsed.data,
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
