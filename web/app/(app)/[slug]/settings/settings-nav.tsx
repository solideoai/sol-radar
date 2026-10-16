"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 경로를 옮기는 메뉴라서 탭(role="tablist")이 아니라 링크와 aria-current 다.
// "팀"은 팀 조직에서만 둔다(개인 조직은 이름을 바꾸거나 지우지 않는다). 맨 끝에 두어 "멤버" 자리가 두 조직에서 같다.
export function SettingsNav({ slug, isTeam }: { slug: string; isTeam: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: `/${slug}/settings`, label: "계정" },
    { href: `/${slug}/settings/members`, label: "멤버" },
    ...(isTeam ? [{ href: `/${slug}/settings/team`, label: "팀" }] : []),
  ];

  return (
    <nav aria-label="설정 메뉴" className="border-b border-border">
      {/* 막대가 아래 선 위에 겹치도록 한 픽셀 내린다. */}
      <ul className="-mb-px flex gap-6">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className="relative inline-flex h-10 items-center rounded-md type-label font-medium text-muted-foreground outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground aria-[current=page]:after:bg-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
