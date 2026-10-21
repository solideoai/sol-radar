import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountSettings, loadAccountSettings } from "@/app/account/account-settings";
import { AppPage } from "@/components/app-page";
import { requireWorkspace } from "@/app/(app)/[slug]/workspace";
import { loadMyKakaoNotify, toKakaoConnectOutcome } from "@/server/kakao-notify";
import { errorNameOf } from "@/server/shared";
import { SettingsNav } from "./settings-nav";
export const metadata: Metadata = { title: "설정" };

// 카카오 표가 아직 없는 DB(마이그레이션 적용 전)에서도 설정 화면의 나머지는 열린다. 칸만 숨기고 오류 이름을 남긴다.
const loadKakaoView = () =>
  loadMyKakaoNotify().catch((error: unknown) => {
    console.error(JSON.stringify({ event: "kakao_notify.load_failed", error: errorNameOf(error) }));
    return null;
  });
export default async function SettingsPage({
  params,
  searchParams,
}: PageProps<"/[slug]/settings">) {
  await connection();
  const { slug } = await params;
  const workspace = await requireWorkspace(slug, `/${slug}/settings`);
  const [{ me, login }, kakaoView] = await Promise.all([loadAccountSettings(), loadKakaoView()]);
  if (me.status !== "ready" || login.status !== "ready") redirect("/auth/login");
  const { link, kakao } = await searchParams;
  return (
    <AppPage title="설정" description="프로필과 로그인 정보를 관리합니다.">
      <div>
        <SettingsNav slug={workspace.current.slug} isTeam={!workspace.current.isPersonal} />
        <AccountSettings
          profile={me.profile}
          login={login}
          link={typeof link === "string" ? link : undefined}
          settingsPath={`/${workspace.current.slug}/settings`}
          kakao={
            kakaoView === null
              ? undefined
              : { view: kakaoView, outcome: toKakaoConnectOutcome(kakao) }
          }
        />
      </div>
    </AppPage>
  );
}
