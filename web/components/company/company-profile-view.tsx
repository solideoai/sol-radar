import Link from "next/link";
import type {
  CompanyProfile,
  CompanyProfileSummary,
  CompanyStaffing,
} from "@/server/company-profile";
import { Card, CardContent } from "@/components/ui/card";
import {
  FinancialsPanel,
  HistoryPanel,
  kstDate,
  LicensesPanel,
  PeoplePanel,
  PreferencesPanel,
  ProjectsPanel,
  TechPanel,
} from "./company-panels";
import { COMPANY_TABS, companyTabHref, type CompanyTab } from "./company-tabs";

// 06 §5.6 /company. 조회 전용이다 — ADMIN 의 새 revision 저장(PUT /company-profile)은 이번 화면에 없다.
// 데이터는 서버 컴포넌트가 읽어 넘긴다(props 만 받는다).

const LINK_CLASS =
  "relative inline-flex h-10 items-center gap-1.5 rounded-md type-label font-medium text-muted-foreground outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground aria-[current=page]:after:bg-foreground";
const CHIP =
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-foreground";

const countOf = (tab: CompanyTab, profile: CompanyProfile, revisions: number): number | null => {
  switch (tab) {
    case "tech":
      return profile.technologies.length;
    case "licenses":
      return profile.licenses.length;
    case "projects":
      return profile.pastProjects.length;
    case "history":
      return revisions;
    default:
      return null;
  }
};

function TabNav({
  current,
  profile,
  revisions,
}: {
  current: CompanyTab;
  profile: CompanyProfile;
  revisions: number;
}) {
  return (
    <nav aria-label="회사 역량 항목" className="border-b border-border">
      {/* 막대가 아래 선 위에 겹치도록 한 픽셀 내린다. */}
      <ul className="-mb-px flex gap-6">
        {COMPANY_TABS.map((tab) => {
          const count = countOf(tab.id, profile, revisions);
          return (
            <li key={tab.id}>
              <Link
                href={companyTabHref(tab.id)}
                aria-current={tab.id === current ? "page" : undefined}
                className={LINK_CLASS}
              >
                {tab.label}
                {count === null ? null : (
                  <span className="type-caption tabular-nums text-muted-foreground">{count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ProfileMeta({ profile }: { profile: CompanyProfile }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {profile.isDemo ? <span className={CHIP}>가상 회사 프로필</span> : null}
      <span className="type-body font-medium text-foreground">{profile.name}</span>
      <span className="type-body tabular-nums text-muted-foreground">
        rev {profile.revision} · {kstDate(profile.effectiveAt)} 적용
      </span>
      {profile.note ? (
        <span className="type-body wrap-anywhere text-muted-foreground">{profile.note}</span>
      ) : null}
    </div>
  );
}

function TabBody({
  tab,
  profile,
  revisions,
  staffing,
}: {
  tab: CompanyTab;
  profile: CompanyProfile;
  revisions: CompanyProfileSummary[];
  staffing: CompanyStaffing;
}) {
  switch (tab) {
    case "tech":
      return <TechPanel profile={profile} />;
    case "licenses":
      return <LicensesPanel profile={profile} />;
    case "projects":
      return <ProjectsPanel profile={profile} />;
    case "people":
      return <PeoplePanel staffing={staffing} />;
    case "preferences":
      return <PreferencesPanel profile={profile} />;
    case "financials":
      return <FinancialsPanel profile={profile} />;
    case "history":
      return <HistoryPanel revisions={revisions} currentRevision={profile.revision} />;
  }
}

export function CompanyProfileView({
  tab,
  profile,
  revisions,
  staffing,
}: {
  tab: CompanyTab;
  profile: CompanyProfile | null;
  revisions: CompanyProfileSummary[];
  staffing: CompanyStaffing;
}) {
  if (profile === null)
    return (
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="type-heading text-foreground">등록된 회사 프로필이 없습니다</p>
          <p className="type-body text-muted-foreground">
            회사 프로필이 있어야 공고를 분석할 수 있습니다. ADMIN 에게 프로필 등록을 요청하세요.
          </p>
        </CardContent>
      </Card>
    );
  return (
    <div className="flex flex-col gap-6">
      <ProfileMeta profile={profile} />
      <TabNav current={tab} profile={profile} revisions={revisions.length} />
      <TabBody tab={tab} profile={profile} revisions={revisions} staffing={staffing} />
    </div>
  );
}
