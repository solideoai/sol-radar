import {
  AwardIcon,
  BellIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  SettingsIcon,
  StarIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { SolRole } from "@/server/organization";

// 사이드바 메뉴 정의는 이 파일 한 곳이다(ADR-021 §2.1, 06 §4.1). 화면을 더하면 여기에 한 줄 더한다 —
// 사이드바 항목과 위 막대의 화면 이름이 같이 생긴다. 주소는 조직 슬러그 없는 절대 경로다(D30).
//
// released: 노출 조건 5개(구현·API·권한·시험·완료 기준)를 채운 메뉴. 링크로 보인다.
// planned: 아직 화면이 없는 메뉴. 링크 없이 메뉴 이름만 보인다(사용자 결정 2026-10-21, 설계 §4.1).
// 메뉴를 보이거나 숨기는 것은 화면 편의일 뿐이다. 경로 접근은 서버 가드와 RLS 가 정하고, 미출시 경로는 404 다.
// planned 를 released 로 바꾸는 일은 사람이 코드 리뷰로 한다.
export type NavStatus = "released" | "planned";

export type NavItem = {
  href: string;
  label: string;
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
  items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "work",
    label: "업무",
    items: [
      { href: "/dashboard", label: "대시보드", icon: LayoutDashboardIcon, status: "released" },
      { href: "/bids", label: "입찰 공고", icon: FileTextIcon, status: "released" },
      { href: "/watchlist", label: "관심 공고", icon: StarIcon, status: "released" },
      { href: "/notifications", label: "알림", icon: BellIcon, status: "released" },
    ],
  },
  {
    id: "analysis",
    label: "AI 분석",
    items: [
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
    id: "bid-management",
    label: "입찰 관리",
    items: [
      { href: "/projects", label: "입찰 프로젝트", icon: FolderKanbanIcon, status: "released" },
    ],
  },
  {
    id: "organization",
    label: "조직",
    items: [
      { href: "/company", label: "회사 역량", icon: AwardIcon, status: "released" },
      { href: "/people", label: "조직·인력", icon: UsersIcon, status: "released" },
    ],
  },
  {
    id: "system",
    label: "시스템",
    items: [
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
    ],
  },
];

// 묶음 밖, 사이드바 맨 아래 고정 칸의 메뉴(2026-10-18 사용자 결정).
export const ORG_CHART_ITEM: NavItem = {
  href: "/org-chart",
  label: "조직도",
  icon: NetworkIcon,
  status: "released",
};

// 사이드바에는 없지만 위 막대가 화면 이름을 알아야 하는 템플릿 화면(D30). 조직 슬러그가 붙은 주소다.
// 이름을 모르면 조직 이름까지 막대에서 사라진다.
const TEMPLATE_SCREENS = [
  { segment: "settings", label: "설정" },
  { segment: "tasks", label: "작업" },
  { segment: "dashboard", label: "대시보드" },
] as const;

const isUnder = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

export const isCurrentItem = (pathname: string, item: NavItem, orgSlug: string) =>
  isUnder(pathname, item.href) ||
  (item.legacySegment !== undefined && isUnder(pathname, `/${orgSlug}/${item.legacySegment}`));

const canSee = (item: NavItem, role: SolRole | null) =>
  item.roles === undefined || (role !== null && item.roles.includes(role));

// 역할로 거른 메뉴. 메뉴가 하나도 남지 않은 묶음은 묶음 줄까지 뺀다.
export const visibleNavGroups = (role: SolRole | null): NavGroup[] =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(item, role)),
  })).filter((group) => group.items.length > 0);

// 지금 화면이 속한 묶음. 들어올 때 이 묶음은 접혀 있어도 펼친다(06 §4.1).
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

// 위 막대의 화면 이름. 역할과 상관없이 출시된 메뉴에서 찾는다 — 주소로 들어온 사람도 어느 화면인지 알아야 한다.
export const screenLabelOf = (pathname: string, orgSlug: string): string | null => {
  const released = [...NAV_GROUPS.flatMap((group) => group.items), ORG_CHART_ITEM].filter(
    (item) => item.status === "released",
  );
  const item = released.find((candidate) => isCurrentItem(pathname, candidate, orgSlug));
  if (item) return item.label;
  const [, , segment] = pathname.split("/");
  return TEMPLATE_SCREENS.find((screen) => screen.segment === segment)?.label ?? null;
};
