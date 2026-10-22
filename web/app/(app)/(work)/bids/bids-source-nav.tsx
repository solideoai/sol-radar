import Link from "next/link";

// 공고 화면 위 "나라장터 공고 | 부처 지원사업" 링크 줄(디자인 스펙 §4.1). 모양은 설정 화면의 SettingsNav 와 같다.
// 경로를 옮기는 메뉴라서 탭(role="tablist")이 아니라 링크와 aria-current 다. 사이드바 NAV 에는 더하지 않는다.
// 서버 컴포넌트라 usePathname 대신 지금 화면을 current 로 받는다. 그래야 loading.tsx 도 같은 줄을 그린다.
// 주소는 쿼리 없이 경로만이다. 두 목록의 필터 키가 달라 서로 잇지 않는다.

const ITEMS = [
  { key: "g2b", href: "/bids", label: "공공 조달 공고" },
  { key: "programs", href: "/bids/programs", label: "부처 지원사업" },
] as const;

export type BidsSource = (typeof ITEMS)[number]["key"];

export function BidsSourceNav({ current }: { current: BidsSource }) {
  return (
    <nav aria-label="공고 종류" className="border-b border-border">
      {/* 막대가 아래 선 위에 겹치도록 한 픽셀 내린다. */}
      <ul className="-mb-px flex gap-6">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === current ? "page" : undefined}
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
