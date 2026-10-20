"use client";

import {
  BellIcon,
  ChevronsUpDownIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  NetworkIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TopbarStatus, useTopbarStore, type TopbarStatusProps } from "@/components/topbar-status";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { initialOf } from "@/lib/utils";
import type { CurrentOrg, OrgSummary } from "@/server/organization";

// 화면을 더하면 여기에 한 줄 더한다 — 사이드바 항목과 위 막대의 화면 이름이 같이 생긴다.
// 주소는 조직 슬러그 없는 절대 경로다(D30). 템플릿의 작업·설정 줄은 뺐다 — 설정은 사용자 메뉴에 있다.
const NAV = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboardIcon },
  { href: "/bids", label: "입찰 공고", icon: FileTextIcon },
  { href: "/notifications", label: "알림", icon: BellIcon },
  { href: "/people", label: "조직·인력", icon: UsersIcon },
] as const;

// 사이드바에는 없지만 상단 막대가 화면 이름을 알아야 하는 템플릿 화면(D30). 조직 슬러그가 붙은 주소다.
// 이름을 모르면 조직 이름까지 막대에서 사라진다.
const TEMPLATE_SCREENS = [
  { segment: "settings", label: "설정" },
  { segment: "tasks", label: "작업" },
  { segment: "dashboard", label: "대시보드" },
] as const;

const templateScreenOf = (pathname: string) => {
  const [, , segment] = pathname.split("/");
  return TEMPLATE_SCREENS.find((screen) => screen.segment === segment);
};

const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

// isAdmin 은 서비스 운영자인지다(조직 역할이 아니다). 링크를 숨기는 것은 화면 요구일 뿐이고,
// 관리자 화면은 서버에서 다시 확인해 운영자가 아니면 404 다.
// email 은 이메일을 주지 않는 제공자(카카오 비즈 앱 아님·네이버)로 가입하면 없다. avatarUrl 은 제공자가 준 https 주소다.
type AppShellUser = {
  name: string;
  email: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};
type AppShellWorkspace = {
  current: CurrentOrg;
  orgs: OrgSummary[];
  pendingInvitationCount: number;
};

// 본문 랜드마크(main)는 그리지 않는다. 안에 들어오는 화면이 그린다.
export function AppShell({
  user,
  workspace,
  defaultSidebarOpen,
  status,
  children,
}: {
  user: AppShellUser;
  workspace: AppShellWorkspace;
  defaultSidebarOpen: boolean;
  // 있으면 위 막대 오른쪽에 상태 묶음(DEMO·실행 모드·AI·수집·알림)을 그린다.
  status?: TopbarStatusProps;
  children: React.ReactNode;
}) {
  return (
    // 부품의 기본 min-h-svh 를 푼다. 루트 layout 의 바깥 상자가 화면 높이를 이미 채운다.
    <SidebarProvider defaultOpen={defaultSidebarOpen} className="min-h-0 flex-1">
      <AppSidebar user={user} workspace={workspace} />
      {/* min-w-0 이 없으면 넓은 표·긴 글이 이 단을 밀어 화면이 가로로 넘친다. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar current={workspace.current} status={status} />
        {/* 1280 미만은 지원하지 않는다(D25). 레이아웃을 바꾸지 않고 한 줄로 알린다. */}
        <p
          data-slot="narrow-notice"
          className="flex items-center gap-2 border-b border-border bg-background px-4 py-2 type-label text-warning min-[1280px]:hidden"
        >
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
          데스크톱 화면에서 이용하세요
        </p>
        {children}
      </div>
    </SidebarProvider>
  );
}

function AppSidebar({ user, workspace }: { user: AppShellUser; workspace: AppShellWorkspace }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  // 서랍(좁은 폭)을 닫지 않으면 옮겨 간 화면을 서랍이 가린다.
  const closeDrawer = () => setOpenMobile(false);
  const base = `/${workspace.current.slug}`;
  const unread = useTopbarStore((s) => s.summary?.unreadNotifications);

  return (
    <Sidebar role="complementary" aria-label="앱 사이드바" data-type-scale="sidebar">
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <OrgMark name={workspace.current.name} />
          <span className="min-w-0 truncate font-medium">{workspace.current.name}</span>
        </div>
        {workspace.pendingInvitationCount > 0 ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/invitations" onClick={closeDrawer} />}>
                <MailIcon />
                <span>받은 초대</span>
              </SidebarMenuButton>
              <SidebarMenuBadge className="tabular-nums">
                {workspace.pendingInvitationCount}
                <span className="sr-only">개</span>
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="주요 메뉴">
            <SidebarMenu className="gap-0.5">
              {NAV.map((item) => {
                const { href } = item;
                const isActive = isCurrent(pathname, href);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      render={
                        <Link
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={closeDrawer}
                        />
                      }
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {href === "/notifications" && unread !== undefined && unread >= 1 ? (
                      <SidebarMenuBadge className="tabular-nums">
                        {unread}
                        <span className="sr-only">건</span>
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Separator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isCurrent(pathname, "/org-chart")}
              tooltip="조직도"
              render={
                <Link
                  href="/org-chart"
                  aria-label="조직도"
                  aria-current={isCurrent(pathname, "/org-chart") ? "page" : undefined}
                  onClick={closeDrawer}
                />
              }
            >
              <NetworkIcon aria-hidden />
              <span>조직도</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserMenu user={user} settingsHref={`${base}/settings`} onNavigate={closeDrawer} />
      </SidebarFooter>
    </Sidebar>
  );
}

// 사람(동그란 아바타)과 구분되게 둥근 사각형으로 둔다.
function OrgMark({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={
        size === "md"
          ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary type-label font-semibold text-sidebar-primary-foreground"
          : "flex size-5 shrink-0 items-center justify-center rounded-md bg-sidebar-primary type-caption font-semibold text-sidebar-primary-foreground"
      }
    >
      {initialOf(name)}
    </span>
  );
}

// 한 줄에 다 들어가지 않는 이메일은 @ 앞에서 먼저 줄을 바꾼다. 그래도 넘치면 감싼 칸의 wrap-anywhere 가 아무 데서나 바꾼다.
function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

function UserMenu({
  user,
  settingsHref,
  onNavigate,
}: {
  user: AppShellUser;
  settingsHref: string;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    setIsSigningOut(true);
    // 이 기기만 끊는다. 모든 기기는 설정의 "모든 기기에서 로그아웃"이 한다.
    const { error } = await getSupabaseBrowser().auth.signOut({ scope: "local" });
    if (error) {
      setIsSigningOut(false);
      toast.error(`로그아웃하지 못했습니다: ${error.message}`);
      return;
    }
    // 브라우저에 남은 로그인 뒤 화면(라우터 캐시)을 버린다.
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          {/* 이름·이메일을 줄이지 않고 줄을 바꿔 다 보인다. 높이는 글자에 맞춰 늘어난다(ADR-030 B26). 가장 낮을 때도 아바타+여백으로 48px 이다. */}
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="h-auto" />}>
            <span className="sr-only">사용자 메뉴</span>
            {/* 이름이 바로 옆에 글자로 있다. 사진을 못 불러오면 머리글자가 그 자리를 채운다(깨진 그림이 보이지 않는다). */}
            <Avatar aria-hidden>
              {user.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : null}
              <AvatarFallback>{initialOf(user.name)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 wrap-anywhere">
              <span className="font-medium text-sidebar-accent-foreground">{user.name}</span>
              {user.email ? (
                <span className="type-caption text-muted-foreground">
                  <EmailText email={user.email} />
                </span>
              ) : null}
            </span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="wrap-anywhere">
                {user.email ?? user.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLinkItem render={<Link href={settingsHref} />} onClick={onNavigate}>
                <SettingsIcon />
                설정
              </DropdownMenuLinkItem>
              {user.isAdmin ? (
                <DropdownMenuLinkItem render={<Link href="/admin" />} onClick={onNavigate}>
                  <ShieldCheckIcon />
                  관리자
                </DropdownMenuLinkItem>
              ) : null}
              <DropdownMenuItem onClick={signOut} disabled={isSigningOut}>
                <LogOutIcon />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function AppTopBar({ current, status }: { current: CurrentOrg; status?: TopbarStatusProps }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const screen =
    pathname === "/org-chart"
      ? { label: "조직도" }
      : (NAV.find((item) => isCurrent(pathname, item.href)) ?? templateScreenOf(pathname));

  return (
    // 높이를 고정하지 않는다. 글자를 키우면 막대도 커진다.
    <header className="sticky top-0 z-10 flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      {/* -ml-2 는 버튼 안쪽 여백만큼 당겨 아이콘을 본문 선에 맞춘다. */}
      <SidebarTrigger className="-ml-2" />
      {screen ? (
        <>
          <Separator orientation="vertical" className="my-3.5" />
          {/* 사이드바가 안 보이면(서랍, 접은 넓은 폭) 지금 조직을 알 수 없어 조직 이름을 앞에 붙인다 —
              다른 조직에 작업을 잘못 추가하지 않게. */}
          <p className="flex min-w-0 items-center gap-1.5 type-label">
            <span
              className={
                state === "collapsed"
                  ? "flex min-w-0 items-center gap-1.5"
                  : "flex min-w-0 items-center gap-1.5 md:hidden"
              }
            >
              <span className="min-w-0 truncate text-muted-foreground">{current.name}</span>
              <span aria-hidden className="text-muted-foreground">
                /
              </span>
            </span>
            <span className="shrink-0 font-medium text-foreground">{screen.label}</span>
          </p>
        </>
      ) : null}
      {status ? (
        <div className="ml-auto flex min-w-0 items-center">
          <TopbarStatus {...status} />
        </div>
      ) : null}
    </header>
  );
}
