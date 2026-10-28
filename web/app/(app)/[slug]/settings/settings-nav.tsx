"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 경로를 옮기는 메뉴라서 탭(role="tablist")이 아니라 링크와 aria-current 다.
// "팀"은 팀 조직에서만 둔다(개인 조직은 이름을 바꾸거나 지우지 않는다). 맨 끝에 두어 "멤버" 자리가 두 조직에서 같다.
export function SettingsNav({
  slug,
  isTeam,
  showOrganization = false,
}: {
  slug: string;
  isTeam: boolean;
  showOrganization?: boolean;
}) {
  const pathname = usePathname();
  const items = [
    { href: `/${slug}/settings`, label: "계정" },
    { href: `/${slug}/settings/members`, label: "멤버" },
    ...(showOrganization ? [{ href: "/settings/organization", label: "조직" }] : []),
    ...(isTeam ? [{ href: `/${slug}/settings/team`, label: "팀" }] : []),
  ];

  return (
    // 지금 메뉴는 연한 파랑 알약이다(2026-10-28 화면 개편: 밑줄 탭·보기 전환 공통 규칙). 화면 머리 아래 구분선이 있어 밑줄 선은 두지 않는다.
    <nav aria-label="설정 메뉴">
      <ul className="flex gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className="inline-flex items-center rounded-md px-3 py-1.5 type-label text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-selected-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
