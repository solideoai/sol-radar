import Link from "next/link";
import { LOGIN_HREF, SECTION_LINKS, SIGN_UP_HREF } from "@/components/landing/landing-links";
import { Logo } from "@/components/logo";
// 루트 layout 의 metadata 와 같은 글을 쓴다.
import project from "@/project.json";

// 실제로 있는 경로만 적는다 — 없는 주소나 바깥 주소를 넣지 않는다.
// 이용약관·개인정보처리방침 화면은 아직 없어 링크를 두지 않는다. 화면이 생기면 여기에 묶음을 더한다.
// 회사 주소·사업자번호·연락처·SNS 는 정해진 것이 없어 적지 않는다.
const GROUPS = [
  { id: "footer-sections", title: "둘러보기", links: SECTION_LINKS },
  {
    id: "footer-account",
    title: "계정",
    links: [
      { href: LOGIN_HREF, label: "로그인" },
      { href: SIGN_UP_HREF, label: "회원가입" },
      { href: "/auth/reset", label: "비밀번호 재설정" },
    ],
  },
] as const;

// 저작권 연도는 서비스를 처음 공개한 해다. 해마다 바꾸지 않는다.
const FIRST_PUBLISHED_YEAR = 2026;

// 로그인 상태를 읽지 않는 정적 부품이다. 바탕은 새 색을 만들지 않고 foreground·background 토큰을 맞바꿔 쓴다.
// 초점 링도 파란 ring 대신 밝은 색을 쓴다 — 어두운 바탕에서는 파랑이 잘 보이지 않는다.
export function SiteFooter() {
  return (
    <footer className="bg-foreground pt-16 pb-10 text-background break-keep">
      <div className="mx-auto flex w-full max-w-320 flex-col px-10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-5 flex flex-col items-start">
            <Link
              href="/"
              className="max-w-full rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-background/60"
            >
              <Logo inverted />
            </Link>
            {/* 폭을 줄이고 줄 길이를 고르게 해, 가운뎃점(기술·자격·) 뒤에서 줄이 끊기지 않게 한다. */}
            <p className="mt-4.5 max-w-110 type-ui-lg text-balance text-background/72">
              {project.description}
            </p>
          </div>
          <nav aria-label="바닥글 메뉴" className="col-span-6 col-start-7 grid grid-cols-2 gap-8">
            {GROUPS.map((group) => (
              <div key={group.id}>
                {/* 묶음 이름은 제목 요소로 쓰지 않는다. 첫 화면의 제목 차례(h1·h2·h3)에 끼어들지 않고 목록의 이름만 된다. */}
                <p id={group.id} className="type-ui-lg font-semibold text-background">
                  {group.title}
                </p>
                <ul aria-labelledby={group.id} className="mt-3 flex flex-col gap-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="inline-block rounded-sm type-ui-lg text-background/72 outline-none hover:text-background hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-background/60"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-14 border-t border-background/15 pt-6 type-body text-background/72">
          © {FIRST_PUBLISHED_YEAR} {project.title}
        </p>
      </div>
    </footer>
  );
}
