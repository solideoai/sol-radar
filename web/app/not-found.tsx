import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame, AuthHeader } from "@/components/auth-frame";
import { buttonVariants } from "@/components/ui/button";

// 이 파일이 없으면 Next 기본 영어 화면이 나온다. 루트 layout 안에서 그려지므로 lang="ko"·글꼴·토큰은 layout 에서 온다.
export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
};

export default function NotFound() {
  return (
    <AuthFrame>
      {/* 404 는 오류 화면의 오류 번호와 같은 자리·같은 모양으로 둔다. */}
      <AuthHeader title="페이지를 찾을 수 없습니다" note={<code className="font-mono">404</code>}>
        주소가 바뀌었거나 없는 페이지입니다. 주소를 다시 확인해 주세요.
      </AuthHeader>
      <Link href="/" className={cn(buttonVariants(), "w-full")}>
        처음 화면으로
      </Link>
    </AuthFrame>
  );
}
