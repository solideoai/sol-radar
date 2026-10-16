import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { requireWorkspace } from "@/app/(app)/[slug]/workspace";
import { SettingsNav } from "@/app/(app)/[slug]/settings/settings-nav";
import { SettingsSection } from "@/app/(app)/[slug]/settings/settings-section";
import { DeleteTeam } from "./delete-team";
import { RenameTeamForm } from "./rename-team-form";

export const metadata: Metadata = { title: "팀" };

// owner 에게만 보이는 폼·버튼은 화면 요구일 뿐이고, 누가 이름을 바꾸고 팀을 지우는지는 DB 정책이 강제한다.
// 개인 조직에는 이 탭이 없다(이름을 바꾸거나 지우지 않는다). 주소로 직접 열면 없는 화면으로 다룬다.
export default async function TeamSettingsPage({ params }: PageProps<"/[slug]/settings/team">) {
  await connection();
  const { current, orgs } = await requireWorkspace((await params).slug);
  if (current.isPersonal) notFound();
  const isOwner = current.myRole === "owner";
  // 지운 뒤에는 개인 조직으로 간다. 가입하면 생기므로 보통 있고, 없으면 옛 주소가 개인 조직을 찾아 보낸다.
  const personalSlug = orgs.find((org) => org.isPersonal)?.slug;
  const homeHref = personalSlug ? `/${personalSlug}/dashboard` : "/dashboard";
  // 띄어쓰기 없는 긴 이름(40자)도 좁은 폭에서 줄을 바꾼다(본문은 break-keep 이라 그대로면 가로로 넘친다).
  const teamName = <span className="wrap-anywhere">{current.name}</span>;

  return (
    <AppPage
      title="설정"
      description={
        isOwner ? (
          <>{teamName}의 이름을 바꾸거나 팀을 지웁니다.</>
        ) : (
          <>{teamName}의 정보입니다. 이름 바꾸기와 삭제는 소유자만 합니다.</>
        )
      }
    >
      {/* AppPage 의 간격이 사이에 끼지 않게 하위 메뉴와 구역을 한 묶음으로 둔다. */}
      <div>
        <SettingsNav slug={current.slug} isTeam />
        <div className="@container">
          <div className="divide-y divide-border">
            {isOwner ? (
              <>
                <SettingsSection
                  id="settings-team-name"
                  title="팀 이름"
                  description="사이드바와 초대 메일에 보이는 이름입니다."
                >
                  <RenameTeamForm orgId={current.id} name={current.name} slug={current.slug} />
                </SettingsSection>
                <SettingsSection
                  id="settings-team-delete"
                  title="팀 삭제"
                  description="팀과 그 안의 작업·활동 기록·초대를 바로 지웁니다. 되돌릴 수 없습니다."
                >
                  <DeleteTeam
                    orgId={current.id}
                    teamName={current.name}
                    slug={current.slug}
                    homeHref={homeHref}
                  />
                </SettingsSection>
              </>
            ) : (
              <SettingsSection
                id="settings-team-name"
                title="팀 이름"
                description="팀 이름은 소유자만 바꿉니다."
              >
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 type-body">
                  <dt className="text-muted-foreground">팀 이름</dt>
                  {/* 40자 이름도 잘리지 않고 줄을 바꾼다. */}
                  <dd className="text-foreground wrap-anywhere">{current.name}</dd>
                  <dt className="text-muted-foreground">주소</dt>
                  <dd className="text-foreground">
                    <code className="font-mono">/{current.slug}</code>
                  </dd>
                </dl>
              </SettingsSection>
            )}
          </div>
        </div>
      </div>
    </AppPage>
  );
}
