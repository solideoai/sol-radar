import { cn } from "cn";
import Link from "next/link";

// 그 자리 실패 문단(§4.8·§4.10·§4.11). 로그인이 풀렸으면 문장 뒤에 로그인 링크를 붙인다.
export type ShownError = { message: string; isSignedOut: boolean };

export function ErrorParagraph({ error, className }: { error: ShownError; className?: string }) {
  return (
    <p role="alert" className={cn("type-label text-destructive", className)}>
      {error.message}
      {error.isSignedOut ? (
        <>
          {" "}
          <Link
            href="/auth/login"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            로그인
          </Link>
        </>
      ) : null}
    </p>
  );
}
