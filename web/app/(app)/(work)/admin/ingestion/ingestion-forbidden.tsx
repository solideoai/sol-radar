import Link from "next/link";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { SOL_ROLE_LABEL } from "@/components/bids/labels";
import { buttonVariants } from "@/components/ui/button";
import type { SolRole } from "@/server/organization";
import { INGESTION_TITLE } from "./ingestion-copy";

// 권한 없음(N8 스펙 §4.9, D10). PeopleForbidden 처럼 틀은 그대로 두고 본문만 안내한다(HTTP 200, API 는 403).
// 데이터를 읽지 않는다. 서비스 운영자(profiles.is_admin)라도 업무 역할이 ADMIN 이 아니면 이 화면이다.
export function IngestionForbidden({ role }: { role: SolRole }) {
  return (
    <AppPage title={INGESTION_TITLE} contentClassName="max-w-360">
      <section
        role="alert"
        aria-labelledby="ingestion-forbidden-title"
        className="flex flex-col items-start gap-3 rounded-lg border border-border p-6"
      >
        <h2 id="ingestion-forbidden-title" className="type-heading text-foreground">
          이 화면을 볼 권한이 없습니다
        </h2>
        <p className="type-body text-muted-foreground">
          데이터 수집 관리는 업무 역할이 {SOL_ROLE_LABEL.ADMIN}인 구성원만 볼 수 있습니다. 지금
          역할: {SOL_ROLE_LABEL[role]}
        </p>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
          대시보드로
        </Link>
      </section>
    </AppPage>
  );
}
