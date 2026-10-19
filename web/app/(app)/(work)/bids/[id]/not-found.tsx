import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { DETAIL_CONTENT_CLASS, NOT_FOUND_DESCRIPTION, NOT_FOUND_TITLE } from "./detail-copy";

// 없는 공고 ID·잘못된 UUID(스펙 §3.5 없음). 같은 구간의 loading·error 경계 안, 앱 틀 안에서 그려진다.
export default function BidNotFound() {
  return (
    <AppPage
      title={NOT_FOUND_TITLE}
      description={NOT_FOUND_DESCRIPTION}
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
