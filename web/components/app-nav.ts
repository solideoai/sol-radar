import {
  AwardIcon,
  BellIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ChartNoAxesColumnIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  RadarIcon,
  SettingsIcon,
  StarIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { SolRole } from "@/server/organization";

// 사이드바 메뉴 정의는 이 파일 한 곳이다(ADR-021 §2.1, 06 §4.1). 화면을 더하면 여기에 한 줄 더한다 —
// 사이드바 항목과 화면 머리의 경로(묶음 / 화면)가 같이 생긴다. 주소는 조직 슬러그 없는 절대 경로다(D30).
//
// released: 노출 조건 5개(구현·API·권한·시험·완료 기준)를 채운 메뉴. 링크로 보인다.
// planned: 아직 화면이 없는 메뉴. 링크 없이 메뉴 이름만 보인다(사용자 결정 2026-10-21, 설계 §4.1).
// 메뉴를 보이거나 숨기는 것은 화면 편의일 뿐이다. 경로 접근은 서버 가드와 RLS 가 정하고, 미출시 경로는 404 다.
// planned 를 released 로 바꾸는 일은 사람이 코드 리뷰로 한다.
export type NavStatus = "released" | "planned";

export type NavItem = {
  href: string;
  label: string;
  // 묶음 안 메뉴는 접은 사이드바(64px)에서만 아이콘이 혼자 보이고, 펼치면 글자만 묶음 아이콘 폭만큼 들여 쓴다
  // (2026-10-28 사용자 결정 시안 A). 아래 고정 칸 메뉴는 펼친 상태에도 아이콘을 글자 왼쪽에 둔다.
  icon: LucideIcon;
  status: NavStatus;
  // 있으면 이 업무 역할만 메뉴를 본다. 다른 역할이 주소로 들어오면 화면이 권한 없음 안내를 그린다.
  roles?: readonly SolRole[];
  // 조직 주소가 붙은 템플릿 화면(/{slug}/<segment>)도 이 메뉴의 화면으로 본다. 조직 주소 정리(N1) 전까지만 쓴다.
  legacySegment?: string;
};

export type NavGroup = {
  id: string;
  label: string;
  // 펼친 사이드바의 묶음 줄에만 보인다. 접은 사이드바(64px)에는 묶음 줄이 없다.
  icon: LucideIcon;
  items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "work",
    label: "업무",
    icon: BriefcaseIcon,
    items: [
      { href: "/dashboard", label: "대시보드", icon: LayoutDashboardIcon, status: "released" },
      { href: "/bids", label: "입찰 공고", icon: FileTextIcon, status: "released" },
      { href: "/watchlist", label: "관심 공고", icon: StarIcon, status: "released" },
      { href: "/projects", label: "입찰 프로젝트", icon: FolderKanbanIcon, status: "released" },
      { href: "/calendar", label: "입찰 일정", icon: CalendarDaysIcon, status: "released" },
      { href: "/notifications", label: "알림", icon: BellIcon, status: "released" },
    ],
  },
  {
    id: "analysis",
    label: "분석",
    icon: ChartNoAxesColumnIcon,
    items: [
      { href: "/gaps", label: "자격 갭 레이더", icon: RadarIcon, status: "released" },
      { href: "/market", label: "발주 현황", icon: ChartColumnIcon, status: "released" },
      {
        href: "/analysis",
        label: "분석 결과 비교",
        icon: GitCompareArrowsIcon,
        status: "released",
      },
      {
        href: "/workforce",
        label: "인력 배치 시뮬레이션",
        icon: UsersRoundIcon,
        status: "released",
      },
    ],
  },
  {
    id: "company",
    label: "회사",
    icon: Building2Icon,
    items: [
      {
        href: "/company",
        label: "회사 역량",
        icon: AwardIcon,
        status: "released",
        roles: ["ADMIN", "EXECUTIVE"],
      },
      { href: "/people", label: "조직·인력", icon: UsersIcon, status: "released" },
      { href: "/org-chart", label: "조직도", icon: NetworkIcon, status: "released" },
    ],
  },
];

// 묶음 밖, 사이드바 맨 아래 고정 칸의 메뉴(사용자 칸 바로 위). 묶음 이름 없이 둔다(2026-10-26 사용자 결정).
export const FOOTER_NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/settings",
    label: "설정",
    icon: SettingsIcon,
    status: "released",
    legacySegment: "settings",
  },
  {
    href: "/admin/ingestion",
    label: "데이터 수집 관리",
    icon: DatabaseIcon,
    status: "released",
    roles: ["ADMIN"],
  },
];

const isUnder = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

export const isCurrentItem = (pathname: string, item: NavItem, orgSlug: string) =>
  isUnder(pathname, item.href) ||
  (item.legacySegment !== undefined && isUnder(pathname, `/${orgSlug}/${item.legacySegment}`));

const canSee = (item: NavItem, role: SolRole | null) =>
  item.roles === undefined || (role !== null && item.roles.includes(role));

// 역할로 거른 메뉴. 메뉴가 하나도 남지 않은 묶음은 묶음 이름까지 뺀다.
export const visibleNavGroups = (role: SolRole | null): NavGroup[] =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(item, role)),
  })).filter((group) => group.items.length > 0);

export const visibleFooterNavItems = (role: SolRole | null): NavItem[] =>
  FOOTER_NAV_ITEMS.filter((item) => canSee(item, role));

// 지금 화면이 속한 묶음. 들어올 때 이 묶음은 접혀 있어도 펼친다(06 §4.1).
// 아래 고정 칸 메뉴(설정 등)는 묶음이 없어 null 이다.
export const currentNavGroupId = (
  groups: readonly NavGroup[],
  pathname: string,
  orgSlug: string,
): string | null =>
  groups.find((group) =>
    group.items.some(
      (item) => item.status === "released" && isCurrentItem(pathname, item, orgSlug),
    ),
  )?.id ?? null;

// 화면 머리의 경로(묶음 / 화면). 역할과 상관없이 출시된 묶음 메뉴에서 찾는다 — 주소로 들어온 사람도 어느 화면인지 알아야 한다.
// 상세 화면(/bids/123)은 그 메뉴의 경로다. 묶음이 없는 아래 고정 칸·조직 주소 템플릿 화면은 null 이다.
export const breadcrumbOf = (pathname: string): { group: string; screen: string } | null =>
  NAV_GROUPS.flatMap((group) =>
    group.items
      .filter((item) => item.status === "released" && isUnder(pathname, item.href))
      .map((item) => ({ group: group.label, screen: item.label })),
  )[0] ?? null;

// 경로의 화면 이름이 지금 화면 그 자체인지 — 주소가 메뉴 주소와 정확히 같을 때만이다. 상세 화면(/bids/123)은 아니다.
export const isMenuPage = (pathname: string) =>
  NAV_GROUPS.some((group) => group.items.some((item) => item.href === pathname));
