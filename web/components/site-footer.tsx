import Link from "next/link";
import { Logo } from "@/components/logo";
// 루트 layout 의 metadata 와 같은 글을 쓴다.
import project from "@/project.json";

// 실제로 있는 경로만 적는다 — 없는 주소나 바깥 주소를 넣지 않는다. 구역의 id(features·start)는 app/page.tsx 가 갖는다.
const GROUPS = [
  {
    id: "footer-sections",
    title: "둘러보기",
    links: [
      { href: "/#features", label: "기능" },
      { href: "/#start", label: "시작 방법" },
    ],
  },
  {
    id: "footer-account",
    title: "계정",
    links: [
      { href: "/auth/login", label: "로그인" },
      { href: "/auth/sign-up", label: "회원가입" },
      { href: "/auth/reset", label: "비밀번호 재설정" },
    ],
  },
] as const;

// 로그인 상태를 읽지 않는 정적 부품이다. 바탕은 새 색을 만들지 않고 foreground·background 토큰을 맞바꿔 쓴다.
// 초점 링도 파란 ring 대신 밝은 색을 쓴다 — 어두운 바탕에서는 파랑이 잘 보이지 않는다.
export function SiteFooter() {
  return (
    <footer className="bg-foreground px-4 py-10 text-background sm:px-6 md:py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        {/* 묶음은 왼쪽 칸부터 차고, 묶음을 더하면 오른쪽으로 이어진다. */}
        <nav aria-label="바닥글 메뉴" className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {GROUPS.map((group) => (
            <div key={group.id}>
              {/* 묶음 이름은 제목 요소로 쓰지 않는다. 첫 화면의 제목 차례(h1·h2·h3)에 끼어들지 않고 목록의 이름만 된다. */}
              <p id={group.id} className="type-label font-medium text-background">
                {group.title}
              </p>
              <ul aria-labelledby={group.id} className="mt-3 flex flex-col">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {/* 위아래 여백(py-1)은 손가락으로 누를 자리다. 글자 높이만으로는 줄 사이가 붙는다. */}
                    <Link
                      href={link.href}
                      className="inline-block rounded-sm py-1 type-label text-background/70 outline-none hover:text-background focus-visible:ring-3 focus-visible:ring-background/60"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex flex-col items-center gap-4 border-t border-background/15 pt-8 md:flex-row md:justify-between">
          {/* max-w-full 이 없으면 긴 프로젝트 이름이 단을 넘긴다. */}
          <Link
            href="/"
            className="max-w-full rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-background/60"
          >
            <Logo inverted />
          </Link>
          <p className="text-center type-label text-balance text-background/70 md:text-right">
            {project.description}
          </p>
        </div>
      </div>
    </footer>
  );
}
