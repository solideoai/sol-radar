import { cn } from "cn";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { businessLayoutNext } from "@/app/auth/employment-routing";
import { AccountHeader, NoDatabase } from "@/app/auth/account-card";
import { AppShell } from "@/components/app-shell";
import { AuthFrame } from "@/components/auth-frame";
import { buttonVariants } from "@/components/ui/button";
import { nameOf } from "@/server/shared";
import { getMyProfile } from "@/server/profile";
import { loadWorkspace } from "./workspace";

// 로그인 전에는 없는 주소(/아무거나)도 안내(200)가 되므로 검색 로봇이 정상 페이지로 모으지 않게 막는다(soft 404).
// 화면(page)은 title 만 정하므로 이 값이 그대로 이어진다.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// children 을 그리지 않아도 그 화면(page)은 서버에서 실행된다 — layout 은 화면 실행을 막지 못한다.
// 그래서 이 폴더 아래의 화면은 저마다 requireWorkspace 로 다시 확인한다(workspace.ts).
// 여기서 막는 것은 화면 모양이지 권한이 아니다. 누가 무엇을 읽고 쓰는지는 RLS 가 정한다.
// layout 은 같은 조직 안에서 화면을 옮길 때 다시 그려지지 않는다. 그 사이 바뀐 상태는 각 화면과 서버 함수가 돌려준다.
export default async function OrgLayout({ children, params }: LayoutProps<"/[slug]">) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const { slug } = await params;
  const next = businessLayoutNext((await headers()).get("x-sol-radar-path"), slug);
  const [workspace, me] = await Promise.all([loadWorkspace(slug, next), getMyProfile()]);
  // 정지된 사람에게는 정책이 어느 조직도 열지 않아 아래에서 404 가 된다. 그 전에 계정 화면의 정지 안내로 보낸다.
  if (me.status === "suspended") redirect("/auth/login");

  switch (workspace.status) {
    case "no-database":
      return (
        <AuthFrame>
          <NoDatabase />
          {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
          <Link href="/auth/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            계정 화면으로 가기
          </Link>
        </AuthFrame>
      );
    case "signed-out":
      return (
        <AuthFrame>
          <AccountHeader title="로그인이 필요합니다">
            로그인한 사람만 볼 수 있는 화면입니다.
          </AccountHeader>
          <Link href="/auth/login" className={cn(buttonVariants(), "w-full")}>
            로그인하러 가기
          </Link>
        </AuthFrame>
      );
    case "not-found":
      // 조직이 없거나 내가 멤버가 아니다. 남의 조직이 있는지 알려 주지 않도록 둘 다 404 다.
      notFound();
    case "ready": {
      // 멤버라면 프로필이 있다(멤버십이 프로필을 가리킨다). 그래도 없으면 계정 화면이 안내한다.
      if (me.status !== "ready") redirect("/auth/login");
      // sidebar 부품이 여닫을 때 적는 쿠키다(components/ui/sidebar.tsx 의 SIDEBAR_COOKIE_NAME).
      const isSidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
      return (
        <AppShell
          user={{
            name: nameOf(me.profile.displayName, me.profile.email),
            email: me.profile.email,
            avatarUrl: me.profile.avatarUrl,
            isAdmin: me.profile.isAdmin,
          }}
          workspace={{
            current: workspace.current,
            orgs: workspace.orgs,
            pendingInvitationCount: workspace.pendingInvitationCount,
          }}
          defaultSidebarOpen={isSidebarOpen}
        >
          {children}
        </AppShell>
      );
    }
  }
}
