import Link from "next/link";
import { LOGIN_HREF, SECTION_LINKS } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 메뉴는 버튼 모양이 아닌 링크다. 17px 글자에 누르는 높이 46px.
const MENU_LINK_CLASS =
  "inline-flex items-center rounded-lg px-3.5 py-2.5 type-ui-lg font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

// 첫 화면의 마케팅 머리말. 화면 위에 붙어 따라온다(sticky) — 구역은 scroll-mt-24(96px)로 머리말 높이(72px)보다 더 내려앉는다.
// 시작하기의 목적지는 로그인 상태를 읽는 app/page.tsx 가 정해 내려 준다. 이 부품은 로그인 상태를 읽지 않는다.
// 데스크톱 전용(docs/16-DECISIONS.md ADR-007)이라 좁은 폭용 메뉴를 두지 않는다. 현재 위치 표시는 하지 않는다.
export function SiteHeader({ startHref }: { startHref: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background break-keep">
      {/* 가운데 칸이 메뉴다. 양쪽 칸을 같은 비율(1fr)로 두어 메뉴가 화면 가운데에 온다. */}
      <div className="mx-auto grid min-h-18 w-full max-w-320 grid-cols-[1fr_auto_1fr] items-center gap-6 px-10">
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
        <div className="flex items-center gap-1 justify-self-end">
          <Link href={LOGIN_HREF} className={buttonVariants({ variant: "ghost", size: "lg" })}>
            로그인
          </Link>
          {/* 주요 버튼은 히어로의 시작하기 하나라, 여기는 테두리 버튼이다. 흰 바탕에서 기본 테두리는 흐려 foreground 로 진하게 한다. */}
          <Link
            href={startHref}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-foreground")}
          >
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
