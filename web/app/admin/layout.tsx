import { cn } from "cn";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getAdminAccess } from "@/server/admin";

// 관리자 화면은 검색에 올리지 않는다. 화면(page)은 title 만 정하므로 이 값이 그대로 이어진다.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// 운영자가 아니거나 로그인 전·DB 없음이면 404 다. 안내를 그리지 않는다 — 관리자 화면이 있는지 알리지 않는다.
// 404 는 이 틀에서 낸다: 화면의 loading.tsx 가 스트리밍을 시작하면 응답 상태가 200 으로 굳는다.
// 틀은 화면 실행을 막지 못하고 검색·쪽 이동에서 다시 그려지지 않는다. 그래서 화면(getUserList)이 다시 확인한다.
// 누가 모든 프로필을 읽는지는 RLS 정책 "운영자는 전체 프로필 읽기"가 정한다. 여기서 막는 것은 화면이다.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const access = await getAdminAccess();
  if (access.status !== "ready") notFound();
  // 개인 조직이 없으면(가입 트리거보다 먼저 만든 계정) 계정 화면이 안내한다.
  const backHref = "/dashboard";

  return (
    <>
      {/* 높이를 고정하지 않는다(글자를 키우면 막대도 커진다). 안쪽 단은 본문(AppPage)과 같은 폭·여백이다. */}
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-12 w-full max-w-5xl items-center gap-3">
          {/* min-w-0 이 없으면 긴 프로젝트 이름이 오른쪽 링크를 밀어 가로로 넘친다. */}
          <Logo className="min-w-0" />
          <Separator orientation="vertical" className="my-3.5" />
          <p className="shrink-0 type-label font-medium text-foreground">관리자</p>
          {/* -mr-3 은 버튼 안쪽 여백만큼 당겨 글자를 본문의 오른쪽 선에 맞춘다. */}
          <Link
            href={backHref}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-3 ml-auto")}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            앱으로 돌아가기
          </Link>
        </div>
      </header>
      {children}
    </>
  );
}
