"use client";

import { createContext, useContext } from "react";
import { breadcrumbOf, isMenuPage } from "@/components/app-nav";

// 지금 주소. 앱 틀(AppShell)이 usePathname 으로 읽어 넣는다. 앱 틀 밖(로그인 화면·화면 부품 시험)에서는 null 이고 경로를 그리지 않는다.
// AppPage 가 next/navigation 을 직접 부르지 않게 하려는 것이다 — 화면 부품 시험이 주소 흉내 없이 AppPage 를 그린다.
const PathnameContext = createContext<string | null>(null);

export function AppPathnameProvider({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  return <PathnameContext.Provider value={pathname}>{children}</PathnameContext.Provider>;
}

// 화면 머리의 경로(묶음 / 화면). 사이드바 메뉴 정의(app-nav)에서 찾고, 묶음이 없는 화면(설정 등)은 그리지 않는다.
// 둘 다 링크가 아니다. 묶음은 화면이 없고, 화면 이름은 지금 화면이다(2026-10-28 화면 개편).
// 상세 화면(/bids/123)의 화면 이름은 그 메뉴일 뿐 지금 쪽이 아니라 aria-current 를 달지 않는다. 글자색은 같다.
export function AppBreadcrumb() {
  const pathname = useContext(PathnameContext);
  if (pathname === null) return null;
  const crumb = breadcrumbOf(pathname);
  if (crumb === null) return null;
  return (
    <nav aria-label="경로" className="mb-2 type-label text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>{crumb.group}</li>
        <li aria-hidden>/</li>
        <li aria-current={isMenuPage(pathname) ? "page" : undefined} className="text-foreground">
          {crumb.screen}
        </li>
      </ol>
    </nav>
  );
}
