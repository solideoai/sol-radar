import "server-only";
import { companyProfileRepo, type CompanyProfileRepo } from "@/server/company-profile";
import { companyProfileSchema, type CompanyProfile } from "@/server/scoring";
import {
  assumeGapRadar,
  bucketByBid,
  buildGapRadar,
  inScope,
  latestSyncedAt,
  toGapNotice,
  toKstDate,
  type GapBucketsView,
  type GapNoticeRow,
  type GapQuery,
  type GapRadarView,
} from "./gaps.model";
import { gapsRepo } from "./gaps.repo";

type ProfileRow = Awaited<ReturnType<CompanyProfileRepo["latest"]>>;

/** 자격 갭 레이더 화면 데이터(§5). 읽기만 한다. 가정(query.assume)은 프로필 사본으로 다시 계산하고 저장하지 않는다. */
export async function getGapRadar(
  orgId: string,
  query: GapQuery,
  now: Date = new Date(),
): Promise<GapRadarView> {
  // 프로필이 없으면 공고(1,000건 넘게)를 읽지 않는다.
  const profileRow = await companyProfileRepo.latest(orgId);
  if (profileRow === null) return { kind: "NO_PROFILE" };
  const rows = await gapsRepo.liveNotices(now.toISOString());
  return toGapRadarView(profileRow, rows, query, now);
}

/** /market 겹쳐 보기(§6 B2)용 공고별 판정 묶음. 관련성 거르기 없이 마감 전 live 공고 전부를 판정한다. 읽기만 한다. */
export async function getGapBuckets(
  orgId: string,
  now: Date = new Date(),
): Promise<GapBucketsView> {
  // 프로필이 없으면 공고를 읽지 않는다(getGapRadar 와 같은 순서).
  const profileRow = await companyProfileRepo.latest(orgId);
  if (profileRow === null) return { kind: "NO_PROFILE" };
  const rows = await gapsRepo.liveNotices(now.toISOString());
  const profile = parseProfile(profileRow);
  return {
    kind: "READY",
    profile: profileSummary(profile),
    buckets: bucketByBid(rows.map(toGapNotice), profile, toKstDate(now)),
  };
}

// 분석 입력 조립(analysis-store.model toProfile)과 같은 열 → 같은 스키마. 틀리면 화면 오류로 보인다.
function parseProfile(profileRow: NonNullable<ProfileRow>): CompanyProfile {
  return companyProfileSchema.parse({
    revision: profileRow.revision,
    name: profileRow.name,
    isDemo: profileRow.is_demo,
    technologies: profileRow.technologies,
    technologiesComplete: profileRow.technologies_complete,
    licenses: profileRow.licenses,
    industryCodes: profileRow.industry_codes,
    pastProjects: profileRow.past_projects,
    financials: profileRow.financials,
    preferences: profileRow.preferences,
  });
}

function profileSummary(profile: CompanyProfile) {
  return { revision: profile.revision, isDemo: profile.isDemo, name: profile.name ?? null };
}

/** 읽은 행 → 화면 데이터. 저장소를 부르지 않는다. */
export function toGapRadarView(
  profileRow: ProfileRow,
  rows: GapNoticeRow[],
  query: GapQuery,
  now: Date,
): GapRadarView {
  if (profileRow === null) return { kind: "NO_PROFILE" };
  const profile = parseProfile(profileRow);

  const notices = rows.map(toGapNotice);
  const scoped = inScope(notices, query.scope);
  const today = toKstDate(now);
  return {
    kind: "READY",
    profile: profileSummary(profile),
    asOf: latestSyncedAt(rows),
    today,
    query,
    scopeCounts: { relevant: inScope(notices, "relevant").length, all: notices.length },
    radar: buildGapRadar(scoped, profile, today),
    assumption:
      query.assume.length === 0 ? null : assumeGapRadar(scoped, profile, today, query.assume),
  };
}
