import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

// 로그인 상태를 읽지 않는다 — cookies()·headers()·connection() 을 부르면 `/` 가 동적 렌더링으로 바뀐다.
// 현재 위치 표시는 하지 않는다. 화면마다 title 과 h1 이 위치를 알린다. 구역의 id 는 app/page.tsx 가 갖는다.
const LINKS = [
  { href: "/#features", label: "기능" },
  { href: "/#start", label: "시작 방법" },
] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background px-4 sm:px-6">
      {/* 높이를 고정하지 않는다(글자를 키우면 같이 커진다). 줄은 바뀌지 않고 좁으면 워드마크가 줄어든다. */}
      <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center gap-4">
        {/* min-w-0 이 없으면 긴 프로젝트 이름이 버튼을 밀어 가로로 넘친다. */}
        <Link
          href="/"
          className="min-w-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        {/* 좁은 폭에서는 구역 링크를 숨긴다. 구역은 화면을 내리면 차례로 나온다. */}
        <nav aria-label="주요 메뉴" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Link href="/auth/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            로그인
          </Link>
          <Link href="/auth/sign-up" className={buttonVariants({ size: "sm" })}>
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
