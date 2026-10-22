import Link from "next/link";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import type { SolRole } from "@/server/organization";
import { FORBIDDEN_COPY, ORG_SETTINGS_TITLE } from "./org-settings-copy";

// 권한 없음(디자인 스펙 §4.9, D13). IngestionForbidden 과 같은 꼴이다(HTTP 200 + 안내). 데이터를 읽지 않는다.
// 하위 메뉴는 그리지 않는다 — ADMIN 이 아니면 "조직" 링크가 없어 지금 화면을 가리킬 항목이 없다.
export function OrgSettingsForbidden({ role }: { role: SolRole }) {
  return (
    <AppPage title={ORG_SETTINGS_TITLE}>
      <section
        role="alert"
        aria-labelledby="org-settings-forbidden-title"
        className="flex flex-col items-start gap-3 rounded-lg border border-border p-6"
      >
        <h2 id="org-settings-forbidden-title" className="type-heading text-foreground">
          {FORBIDDEN_COPY.title}
        </h2>
        <p className="type-body text-muted-foreground">{FORBIDDEN_COPY.body(role)}</p>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
          {FORBIDDEN_COPY.back}
        </Link>
      </section>
    </AppPage>
  );
}
