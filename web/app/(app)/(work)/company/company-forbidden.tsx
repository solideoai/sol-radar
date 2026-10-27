import Link from "next/link";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { COMPANY_TITLE } from "@/components/company/company-tabs";
import { buttonVariants } from "@/components/ui/button";
import type { SolRole } from "@/server/organization";

// 권한 없음. IngestionForbidden 과 같은 틀이다(HTTP 200, API 는 403). 데이터를 읽지 않는다.
export function CompanyForbidden({ role }: { role: SolRole }) {
  return (
    <AppPage title={COMPANY_TITLE} contentClassName="max-w-360">
      <section
        role="alert"
        aria-labelledby="company-forbidden-title"
        className="flex flex-col items-start gap-3 rounded-lg border border-border p-6"
      >
        <h2 id="company-forbidden-title" className="type-heading text-foreground">
          이 화면을 볼 권한이 없습니다
        </h2>
        <p className="type-body text-muted-foreground">
          회사 역량은 업무 역할이 ADMIN 또는 EXECUTIVE인 구성원만 볼 수 있습니다. 지금 역할: {role}
        </p>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
          대시보드로
        </Link>
      </section>
    </AppPage>
  );
}
