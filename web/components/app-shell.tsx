"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  LogOutIcon,
  MailIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  currentNavGroupId,
  isCurrentItem,
  screenLabelOf,
  visibleFooterNavItems,
  visibleNavGroups,
  type NavGroup,
  type NavItem,
} from "@/components/app-nav";
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
import type { ViewOrigin } from "@/components/bids/notice-origin";
import { Logo } from "@/components/logo";
import { navHrefOf, useNavOriginStore } from "@/components/nav-origin";
import { TopbarDemoIndicator } from "@/components/topbar-demo-indicator";
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
import { useSidebarGroupsStore } from "@/lib/stores/sidebar-groups";
import { initialOf } from "@/lib/utils";
import type { CurrentOrg, OrgSummary, SolRole } from "@/server/organization";

// 접은 사이드바는 아이콘만 남긴 64px 다(06 §4·§4.1). 부품 기본값(3rem)을 이 틀에서만 바꾼다.
const SIDEBAR_ICON_WIDTH = { "--sidebar-width-icon": "4rem" } as React.CSSProperties;

// hover 는 활성 바탕(sidebar-accent)보다 옅게 칠한다. 같은 색이면 활성 메뉴 옆에서 선택이 둘로 보인다.
// 활성 메뉴는 마우스를 올려도 활성 바탕 그대로다.
const MENU_HOVER = "hover:bg-sidebar-accent/50 data-active:hover:bg-sidebar-accent";

// 메뉴 아이콘은 글자보다 옅은 회색이고, 지금 화면과 마우스를 올린 메뉴만 글자색이다(2026-10-28 사용자 결정 A안).
// 아이콘이 글자와 같은 검정이면 아이콘 줄이 글자보다 먼저 눈에 든다.
const MENU_ICON =
  "text-muted-foreground/70 group-hover/menu-button:text-sidebar-accent-foreground group-data-active/menu-button:text-sidebar-accent-foreground";

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
  solRole,
  defaultSidebarOpen,
  status,
  children,
}: {
  user: AppShellUser;
  workspace: AppShellWorkspace;
  // 지금 업무 조직의 역할(sol_role). 모르면 null 이고, 역할을 요구하는 메뉴(데이터 수집 관리)를 숨긴다.
  solRole: SolRole | null;
  defaultSidebarOpen: boolean;
  // 있으면 위 막대 오른쪽에 상태 묶음(DEMO·실행 모드·AI·수집·알림)을 그린다.
  status?: ShellStatus;
  children: React.ReactNode;
}) {
  return (
    // 부품의 기본 min-h-svh 를 푼다. 루트 layout 의 바깥 상자가 화면 높이를 이미 채운다.
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      className="min-h-0 flex-1"
      style={SIDEBAR_ICON_WIDTH}
    >
      <AppSidebar
        user={user}
        workspace={workspace}
        solRole={solRole}
        defaultOrigin={status?.defaultOrigin ?? null}
      />
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

function AppSidebar({
  user,
  workspace,
  solRole,
  defaultOrigin,
}: {
  user: AppShellUser;
  workspace: AppShellWorkspace;
  solRole: SolRole | null;
  // 화면 기본 데이터 출처. 모르면(상태 묶음이 없는 틀) null 이고, 기억한 출처를 그대로 링크에 붙인다.
  defaultOrigin: ViewOrigin | null;
}) {
  const pathname = usePathname();
  const navOrigin = useNavOriginStore((s) => s.origin);
  const { setOpenMobile, state, isMobile } = useSidebar();
  // 서랍(좁은 폭)을 닫지 않으면 옮겨 간 화면을 서랍이 가린다.
  const closeDrawer = () => setOpenMobile(false);
  const orgSlug = workspace.current.slug;
  const unread = useTopbarStore((s) => s.summary?.unreadNotifications);
  const groups = visibleNavGroups(solRole);
  const footerItems = visibleFooterNavItems(solRole);
  const currentGroupId = currentNavGroupId(groups, pathname, orgSlug);
  const collapsedGroups = useSidebarGroupsStore((s) => s.collapsed);
  const enterGroup = useSidebarGroupsStore((s) => s.enter);
  const toggleGroup = useSidebarGroupsStore((s) => s.toggle);
  // 아이콘만 남긴 접힘(64px)에서는 묶음 줄이 없다. 접어 둔 묶음의 메뉴도 아이콘으로 다 보인다.
  const hasGroupRows = isMobile || state === "expanded";

  // 저장된 접힘은 마운트 뒤에 읽는다. 지금 화면의 묶음은 들어올 때 펼친다.
  useEffect(() => {
    enterGroup(currentGroupId);
  }, [currentGroupId, enterGroup]);

  return (
    // 메뉴 글자는 본문 색이다. 묶음 이름만 회색으로 낮춘다(2026-10-26 사용자 결정).
    <Sidebar
      role="complementary"
      aria-label="앱 사이드바"
      data-type-scale="sidebar"
      collapsible="icon"
      className="text-foreground"
    >
      <SidebarHeader>
        {/* 왼쪽 끝을 아래 묶음 이름·메뉴 아이콘·받은 초대·아래 고정 칸 아이콘과 맞춘다. 접으면(64px) 로고 마크만 가운데에 남는다.
            로고는 대시보드 링크다. 사이드바 메뉴처럼 보던 출처를 이어 간다. 조직 이름 줄은 2026-10-28 사용자 결정으로 뺐다.
            접으면 글자가 숨어 이름이 없어지므로 aria-label 을 단다. */}
        <div className="flex flex-col px-2 pt-1 pb-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <Link
            href={navHrefOf("/dashboard", navOrigin, defaultOrigin)}
            aria-label="대시보드로 이동"
            onClick={closeDrawer}
            className="flex min-w-0 rounded-md ring-sidebar-ring outline-hidden focus-visible:ring-2"
          >
            <Logo wordmarkClassName="group-data-[collapsible=icon]:hidden" />
          </Link>
        </div>
        {workspace.pendingInvitationCount > 0 ? (
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="받은 초대"
                className={MENU_HOVER}
                render={<Link href="/invitations" onClick={closeDrawer} />}
              >
                <MailIcon aria-hidden className={MENU_ICON} />
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
        <Suspense fallback={null}>
          <NavOriginWatcher />
        </Suspense>
        <nav aria-label="주요 메뉴" className="flex flex-col pt-1 pb-2">
          {groups.map((group, index) => (
            <NavGroupSection
              key={group.id}
              group={group}
              isFirst={index === 0}
              isOpen={!hasGroupRows || !collapsedGroups.includes(group.id)}
              hasGroupRow={hasGroupRows}
              onToggle={() => toggleGroup(group.id)}
            >
              {group.items.map((item) => (
                <NavMenuItem
                  key={item.href}
                  item={item}
                  href={navHrefOf(item.href, navOrigin, defaultOrigin)}
                  isActive={isCurrentItem(pathname, item, orgSlug)}
                  onNavigate={closeDrawer}
                  badge={item.href === "/notifications" ? unread : undefined}
                />
              ))}
            </NavGroupSection>
          ))}
        </nav>
      </SidebarContent>
      {/* 아래 고정 칸: 위쪽 1px 선으로 메뉴와 나눈다. 메뉴가 길어져도 이 칸은 바닥에 남는다. */}
      <SidebarFooter className="border-t border-sidebar-border">
        <nav aria-label="보조 메뉴">
          <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:items-center">
            {footerItems.map((item) => (
              <NavMenuItem
                key={item.href}
                item={item}
                isActive={isCurrentItem(pathname, item, orgSlug)}
                onNavigate={closeDrawer}
              />
            ))}
          </SidebarMenu>
        </nav>
        <UserMenu user={user} settingsHref={`/${orgSlug}/settings`} onNavigate={closeDrawer} />
      </SidebarFooter>
    </Sidebar>
  );
}

// 주소의 출처(?origin=)를 사이드바 기억에 옮긴다. 아무것도 그리지 않는다.
// 주소 읽기(useSearchParams)는 Suspense 안에서만 한다(topbar-demo-indicator 와 같다).
function NavOriginWatcher() {
  const pathname = usePathname();
  const param = useSearchParams().get("origin");
  const see = useNavOriginStore((s) => s.see);
  useEffect(() => {
    see(pathname, param);
  }, [pathname, param, see]);
  return null;
}

// 묶음 줄은 접기 버튼이다: 작은 회색 묶음 이름이고 접기 화살표는 오른쪽 끝에 둔다(2026-10-28 사용자 결정 A안, design.actibooky.com 사이드바 참고).
// 펼친 묶음의 화살표는 마우스를 올리거나 키보드 초점이 올 때만 보이고, 접은 묶음의 화살표는 늘 보여 숨은 메뉴가 있음을 알린다.
// 트리 세로선과 들여쓰기는 없다. 메뉴는 묶음 이름·아래 고정 칸과 같은 왼쪽 선에 서고, 묶음 사이는 16px 띄워 나눈다.
// 접은 사이드바(64px)에서는 묶음 줄을 숨기고 묶음 사이에 짧은 선을 긋는다. 묶음 줄이 없어도 목록 이름(aria-label)은 남는다.
function NavGroupSection({
  group,
  isFirst,
  isOpen,
  hasGroupRow,
  onToggle,
  children,
}: {
  group: NavGroup;
  isFirst: boolean;
  isOpen: boolean;
  hasGroupRow: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  // 묶음 줄(버튼)에는 id 를 두지 않는다. 목록만 id 를 갖고 버튼의 aria-controls 가 가리킨다.
  const listId = `sidebar-group-${group.id}-menu`;
  return (
    <SidebarGroup
      className={cn(
        "py-0.5 group-data-[collapsible=icon]:py-0",
        !isFirst && "mt-4 group-data-[collapsible=icon]:mt-0",
      )}
    >
      {isFirst ? null : (
        <div
          aria-hidden
          data-slot="sidebar-group-divider"
          className="mx-auto my-2 hidden h-px w-6 bg-sidebar-border group-data-[collapsible=icon]:block"
        />
      )}
      {hasGroupRow ? (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={onToggle}
          className="group/group-row flex h-7 w-full items-center gap-2 rounded-md px-2 text-left type-caption font-medium text-muted-foreground ring-sidebar-ring outline-hidden hover:text-sidebar-accent-foreground focus-visible:ring-2"
        >
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {isOpen ? (
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 shrink-0 opacity-0 group-hover/group-row:opacity-100 group-focus-visible/group-row:opacity-100"
            />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
          )}
        </button>
      ) : null}
      {/* 접은 사이드바에서는 부품의 p-2! 가 이겨 아이콘이 32px 칸 가운데에 온다. */}
      <SidebarMenu
        id={listId}
        aria-label={group.label}
        hidden={!isOpen}
        className="gap-0.5 group-data-[collapsible=icon]:items-center"
      >
        {children}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// 출시된 메뉴는 링크, 미출시 메뉴는 링크 없는 이름만 표시한다(초점도 받지 않는다).
// 아이콘은 펼친 사이드바에서도 글자 왼쪽에 둔다(2026-10-26 사용자 결정: 트리·아이콘 되돌림). 색은 MENU_ICON 이다.
// 활성 표시는 하나다: sidebar-accent 바탕 + 굵기 500(부품 기본값). 색만으로 알리지 않고 aria-current 를 단다.
function NavMenuItem({
  item,
  href = item.href,
  isActive,
  onNavigate,
  badge,
}: {
  item: NavItem;
  // 링크 주소. 출처를 읽는 화면은 보던 출처(?origin=)를 붙인 주소다(nav-origin).
  href?: string;
  isActive: boolean;
  onNavigate: () => void;
  badge?: number;
}) {
  if (item.status === "planned") {
    return (
      <SidebarMenuItem data-planned="">
        <SidebarMenuButton
          tooltip={item.label}
          render={<span />}
          className="cursor-default text-muted-foreground hover:bg-transparent hover:text-muted-foreground active:bg-transparent active:text-muted-foreground"
        >
          <item.icon aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.label}
        className={MENU_HOVER}
        render={
          <Link
            href={href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
          />
        }
      >
        <item.icon aria-hidden className={MENU_ICON} />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {badge !== undefined && badge >= 1 ? (
        <SidebarMenuBadge className="tabular-nums">
          {badge}
          <span className="sr-only">건</span>
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
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
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
      <SidebarMenuItem>
        <DropdownMenu>
          {/* 한 줄: 작은 아바타 + 이름 + 메뉴 표시. 이메일은 열린 메뉴의 첫 줄에만 둔다(2026-10-26 사용자 결정).
              접은 사이드바(64px)에서는 32px 칸에 24px 아바타만 남도록 안쪽 여백을 4px 로 줄인다. */}
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                className={cn(MENU_HOVER, "h-10 group-data-[collapsible=icon]:p-1!")}
              />
            }
          >
            <span className="sr-only">사용자 메뉴</span>
            {/* 이름이 바로 옆에 글자로 있다. 사진을 못 불러오면 머리글자가 그 자리를 채운다(깨진 그림이 보이지 않는다). */}
            <Avatar size="sm" aria-hidden>
              {user.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : null}
              <AvatarFallback>{initialOf(user.name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
              {user.name}
            </span>
            <EllipsisIcon
              aria-hidden
              className="text-muted-foreground group-data-[collapsible=icon]:hidden"
            />
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

// 상단바 상태 값. defaultOrigin 은 화면 기본 데이터 출처로, DEMO 배지가 주소에 ?origin= 이 없을 때 따른다.
type ShellStatus = Omit<TopbarStatusProps, "demoIndicator"> & { defaultOrigin: ViewOrigin };

function AppTopBar({ current, status }: { current: CurrentOrg; status?: ShellStatus }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const screenLabel = screenLabelOf(pathname, current.slug);

  return (
    // 높이를 고정하지 않는다. 글자를 키우면 막대도 커진다.
    <header className="sticky top-0 z-10 flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      {/* -ml-2 는 버튼 안쪽 여백만큼 당겨 아이콘을 본문 선에 맞춘다. */}
      <SidebarTrigger className="-ml-2" />
      {screenLabel ? (
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
            <span className="shrink-0 font-medium text-foreground">{screenLabel}</span>
          </p>
        </>
      ) : null}
      {status ? (
        <div className="ml-auto flex min-w-0 items-center">
          <TopbarStatus
            {...status}
            demoIndicator={<TopbarDemoIndicator defaultOrigin={status.defaultOrigin} />}
          />
        </div>
      ) : null}
    </header>
  );
}
