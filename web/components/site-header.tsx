import Link from "next/link";
import { LOGIN_HREF, SECTION_LINKS } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 로고와 메뉴를 가까이 두고 계정 동작은 오른쪽으로 분리한다.
const MENU_LINK_CLASS =
  "inline-flex items-center rounded-lg px-3.5 py-2.5 type-ui-lg font-medium text-muted-foreground outline-none hover:bg-brand/5 hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50";

// 첫 화면의 마케팅 머리말. 화면 위에 붙어 따라온다(sticky) — 구역은 scroll-mt-24(96px)로 머리말 높이(72px)보다 더 내려앉는다.
// 시작하기의 목적지는 로그인 상태를 읽는 app/page.tsx 가 정해 내려 준다. 이 부품은 로그인 상태를 읽지 않는다.
// 데스크톱 전용(docs/16-DECISIONS.md ADR-007)이라 좁은 폭용 메뉴를 두지 않는다. 현재 위치 표시는 하지 않는다.
export function SiteHeader({ startHref }: { startHref: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background break-keep">
      <div className="mx-auto flex min-h-18 w-full max-w-300 items-center gap-10 px-10">
        <Link
          href="/"
          className="min-w-0 justify-self-start rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <nav aria-label="주요 메뉴">
          <ul className="flex items-center gap-1">
            {SECTION_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={MENU_LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href={LOGIN_HREF} className={buttonVariants({ variant: "ghost", size: "lg" })}>
            로그인
          </Link>
          {/* 머리말의 보조 진입점은 테두리 버튼으로 둔다. */}
          <Link
            href={startHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "border-brand/25 text-brand hover:bg-brand/5 hover:text-brand",
            )}
          >
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
