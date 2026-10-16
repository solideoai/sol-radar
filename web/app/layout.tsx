import type { Metadata } from "next";
import { connection } from "next/server";
// 통째(약 2MB)로 받지 않고 화면에 쓰인 글자 범위의 조각만 받는다. 글꼴 이름('Pretendard Variable')은
// design/tokens.json 의 fonts.sans 첫 후보와 같아야 한다. global-error.tsx 도 같이 불러온다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Providers } from "@/components/providers";
// `pnpm bootstrap` 이 새 프로젝트를 만들 때 이 파일의 title 만 바꾼다.
import project from "@/project.json";

export const metadata: Metadata = {
  title: project.title,
  description: project.description,
  // metadataBase 는 아직 두지 않는다 — 배포 주소를 받는 env 도, 절대 주소가 필요한 칸도 없다. og 이미지·canonical 을
  // 상대 경로로 쓰기 시작하면 넣는다. 없으면 Next 가 http://localhost:3000 을 붙인다(Vercel 은 og 이미지만 운영 주소로 채운다).
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 모든 화면(랜딩·404 포함)을 요청마다 그린다. proxy.ts 가 요청마다 만든 CSP nonce 를 Next 가 스크립트에 붙이는데,
  // 빌드 때 미리 그린 정적 HTML 에는 nonce 가 없어 스크립트가 막히고 화면이 동작하지 않는다.
  await connection();
  // break-keep: 한글이 낱말 중간에서 줄바꿈되지 않게 한다. antialiased 는 두지 않는다 — macOS 에서 글자가 한 단계
  // 가늘게 그려져 굵기(400·500·700)가 다르게 보인다. global-error.tsx 도 같이 맞춘다.
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col break-keep">
        <Providers>
          {/* #main-content 는 각 틀의 main 이 갖는다(app/page.tsx·components/auth-frame.tsx·components/app-page.tsx).
              바깥 상자에 두면 머리말·사이드바가 그 안에 들어가, 건너뛴 뒤의 Tab 이 다시 틀의 링크부터 지난다. */}
          <a
            href="#main-content"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:h-10 focus-visible:px-4 focus-visible:whitespace-nowrap",
            )}
          >
            본문으로 건너뛰기
          </a>
          {/* 머리말은 여기 두지 않는다 — 틀이 화면 종류마다 다르다(마케팅·앱 틀·인증 틀). */}
          {/* flex-1 이 빠지면 각 화면의 틀(사이드바 옆 본문 등)이 화면 아래까지 차지 않는다. */}
          <div className="flex flex-1 flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
