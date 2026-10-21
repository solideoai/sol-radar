import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { DETAIL_CONTENT_CLASS } from "@/app/(app)/(work)/bids/[id]/detail-copy";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { REVISIONS_NOT_FOUND_DESCRIPTION, REVISIONS_NOT_FOUND_TITLE } from "./revisions-copy";

// 없는 공고·잘못된 revision 번호(스펙 §5.2 S11).
export default function RevisionsNotFound() {
  return (
    <AppPage
      title={REVISIONS_NOT_FOUND_TITLE}
      description={REVISIONS_NOT_FOUND_DESCRIPTION}
      contentClassName={DETAIL_CONTENT_CLASS}
    >
      <div>
        <Link href="/bids" className={cn(buttonVariants({ variant: "outline" }))}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          공고 목록으로
        </Link>
      </div>
    </AppPage>
  );
}
