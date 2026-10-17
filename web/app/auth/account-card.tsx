import Link from "next/link";
import { AuthFrame, AuthHeader } from "@/components/auth-frame";

export function AccountCard({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}

export function AccountHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return <AuthHeader title={title}>{children}</AuthHeader>;
}

// 폼 아래의 글자 링크다. 문장 속 링크에는 쓰지 않는다 — 본문과 색이 같아 밑줄이 없으면 링크인지 알 수 없다.
export function AccountLink({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate?: React.ComponentProps<typeof Link>["onNavigate"];
}) {
  return (
    <Link
      href={href}
      onNavigate={onNavigate}
      className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}

export function NoDatabase() {
  return (
    <AccountHeader title="DB 가 연결되지 않았습니다">
      로컬은 <code className="font-mono">pnpm db:start</code>, 클라우드는{" "}
      <code className="font-mono">web/.env.local</code> 을 채우면 로그인 견본이 동작합니다.
    </AccountHeader>
  );
}
