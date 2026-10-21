"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  MailIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  currentNavGroupId,
  isCurrentItem,
  ORG_CHART_ITEM,
  screenLabelOf,
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
  status?: TopbarStatusProps;
  children: React.ReactNode;
}) {
  return (
    // 부품의 기본 min-h-svh 를 푼다. 루트 layout 의 바깥 상자가 화면 높이를 이미 채운다.
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      className="min-h-0 flex-1"
      style={SIDEBAR_ICON_WIDTH}
    >
      <AppSidebar user={user} workspace={workspace} solRole={solRole} />
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
}: {
  user: AppShellUser;
  workspace: AppShellWorkspace;
  solRole: SolRole | null;
}) {
  const pathname = usePathname();
  const { setOpenMobile, state, isMobile } = useSidebar();
  // 서랍(좁은 폭)을 닫지 않으면 옮겨 간 화면을 서랍이 가린다.
  const closeDrawer = () => setOpenMobile(false);
  const orgSlug = workspace.current.slug;
  const unread = useTopbarStore((s) => s.summary?.unreadNotifications);
  const groups = visibleNavGroups(solRole);
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
    <Sidebar
      role="complementary"
      aria-label="앱 사이드바"
      data-type-scale="sidebar"
      collapsible="icon"
    >
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <OrgMark name={workspace.current.name} />
          <span className="min-w-0 truncate font-medium group-data-[collapsible=icon]:hidden">
            {workspace.current.name}
          </span>
        </div>
        {workspace.pendingInvitationCount > 0 ? (
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="받은 초대"
                render={<Link href="/invitations" onClick={closeDrawer} />}
              >
                <MailIcon aria-hidden />
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
        <nav aria-label="주요 메뉴" className="flex flex-col py-1">
          {groups.map((group, index) => (
            <NavGroupSection
              key={group.id}
              group={group}
              hasDivider={index > 0}
              isOpen={!hasGroupRows || !collapsedGroups.includes(group.id)}
              hasGroupRow={hasGroupRows}
              onToggle={() => toggleGroup(group.id)}
            >
              {group.items.map((item) => (
                <NavMenuItem
                  key={item.href}
                  item={item}
                  isActive={isCurrentItem(pathname, item, orgSlug)}
                  onNavigate={closeDrawer}
                  badge={item.href === "/notifications" ? unread : undefined}
                />
              ))}
            </NavGroupSection>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <Separator />
        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          <NavMenuItem
            item={ORG_CHART_ITEM}
            isActive={isCurrentItem(pathname, ORG_CHART_ITEM, orgSlug)}
            onNavigate={closeDrawer}
          />
        </SidebarMenu>
        <UserMenu user={user} settingsHref={`/${orgSlug}/settings`} onNavigate={closeDrawer} />
      </SidebarFooter>
    </Sidebar>
  );
}

// 묶음 줄은 접기 버튼이다: 화살표와 회색 굵은 글자만, 아이콘 없음(06 §4.1, 2026-10-18 사용자 결정 U4).
// 메뉴는 화살표 아래 1px 세로선 안쪽으로 들여 쓴다. 접은 사이드바(64px)에서는 묶음 줄 대신 묶음 사이에 짧은 선을 긋는다.
function NavGroupSection({
  group,
  hasDivider,
  isOpen,
  hasGroupRow,
  onToggle,
  children,
}: {
  group: NavGroup;
  hasDivider: boolean;
  isOpen: boolean;
  hasGroupRow: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const listId = `sidebar-group-${group.id}`;
  return (
    <SidebarGroup className="py-0.5">
      {hasDivider ? (
        <div
          aria-hidden
          data-slot="sidebar-group-divider"
          className="mx-auto my-1 hidden h-px w-6 bg-sidebar-border group-data-[collapsible=icon]:block"
        />
      ) : null}
      {hasGroupRow ? (
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={onToggle}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left type-caption font-semibold text-muted-foreground ring-sidebar-ring outline-hidden hover:text-sidebar-accent-foreground focus-visible:ring-2"
        >
          {isOpen ? (
            <ChevronDownIcon aria-hidden className="size-4 shrink-0" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-4 shrink-0" />
          )}
          <span className="truncate">{group.label}</span>
        </button>
      ) : null}
      {/* 세로선은 화살표 가운데(왼쪽에서 16px) 아래에 온다. 긴 메뉴 이름이 256px 폭에
          들어가도록 트리 안 메뉴의 왼쪽 여백을 6px 로 둔다(접은 사이드바는 부품의 p-2! 가 이긴다). */}
      <SidebarMenu
        id={listId}
        aria-label={group.label}
        hidden={!isOpen}
        className="ml-3.75 w-auto gap-0.5 border-l border-sidebar-border pl-1 group-data-[collapsible=icon]:ml-0 [&_[data-sidebar=menu-button]]:pl-1.5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:pl-0"
      >
        {children}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// 출시된 메뉴는 링크, 미출시 메뉴는 링크 없는 이름만 표시한다(초점도 받지 않는다).
// 활성 메뉴는 sidebar-accent 바탕 + 트리 세로선 자리의 3px brand 막대다(06 §4). 색만으로 알리지 않고 aria-current 를 단다.
function NavMenuItem({
  item,
  isActive,
  onNavigate,
  badge,
}: {
  item: NavItem;
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
          className="cursor-default pr-1.5 text-muted-foreground hover:bg-transparent hover:text-muted-foreground active:bg-transparent active:text-muted-foreground"
        >
          <item.icon aria-hidden />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem
      className={
        isActive
          ? "before:absolute before:inset-y-1 before:-left-1.5 before:w-0.75 before:rounded-full before:bg-brand group-data-[collapsible=icon]:before:hidden"
          : undefined
      }
    >
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.label}
        render={
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
          />
        }
      >
        <item.icon aria-hidden />
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
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
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
          <TopbarStatus {...status} />
        </div>
      ) : null}
    </header>
  );
}
